import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatLocal } from '../src/shared/tz';

/**
 * End-to-end check against a deployed (or mock) server.
 * Soft-passes ONLY when the server answers with a Google sign-in/authorization page, which is the
 * state before the owner has approved the script once. Any other failure is a failure.
 */
const file = join(process.env.RUNNER_TEMP ?? tmpdir(), 'server-test.json');
const url = process.env.LIVE_URL ?? (JSON.parse(readFileSync(file, 'utf8')) as { url: string }).url;
const key = process.env.LIVE_KEY ?? process.env.FIXED_KEY ?? '';
if (!key) throw new Error('no key for the live test');

type R = Record<string, any>;
const TIMEOUT_MS = Number(process.env.LIVE_TIMEOUT_MS ?? 90_000);
const ATTEMPTS = 3;

/**
 * One request. Google sometimes does not answer one request at all (seen once: a header timeout failed the pipeline and the
 * production server was not deployed). A request that times out or loses its connection is sent again; that is safe because
 * every write carries an id and is recorded only once.
 */
async function call(body: Record<string, unknown>, k = key): Promise<{ status: number; raw: string; json?: R }> {
  let res: Response | undefined;
  let started = Date.now();
  for (let attempt = 1; ; attempt++) {
    started = Date.now();
    try {
      res = await fetch(url, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ key: k, debug: true, ...body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      break;
    } catch (e) {
      if (attempt >= ATTEMPTS) throw e;
      console.log(`RETRY  ${String(body.action)} (attempt ${attempt} failed: ${e instanceof Error ? e.name : 'error'})`);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  const raw = await res.text();
  try {
    const json = JSON.parse(raw) as R;
    record(body, Date.now() - started, json);
    return { status: res.status, raw, json };
  } catch {
    return { status: res.status, raw };
  }
}

/** Timings of every call (the whole trip, and the server's own share), printed as a table at the end. Numbers only. */
const timings: { what: string; total: number; server: number | null; t?: Record<string, number> }[] = [];
let label = '';
function record(body: Record<string, unknown>, total: number, json: R): void {
  const ops = Array.isArray(body.ops) ? ` ops=${body.ops.length}` : '';
  const kind = body.action === 'sync' ? (json.unchanged ? ' unchanged' : json.changes ? ' changes' : ' list') : '';
  timings.push({ what: `${label || String(body.action)}${label ? '' : ops + kind}`, total, server: typeof json.ms === 'number' ? json.ms : null, t: json.t });
  label = '';
}
/** Names the next call in the timing table. */
const as = (name: string) => void (label = name);

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` ${detail}`}`);
  if (!cond) failures++;
};

async function redirectTrace(method: 'GET' | 'POST'): Promise<string> {
  // follow redirects by hand and describe each hop without printing ids
  const hops: string[] = [];
  let target = url;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(target, { method: i === 0 ? method : 'GET', redirect: 'manual', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: i === 0 && method === 'POST' ? JSON.stringify({ key, action: 'ping' }) : undefined });
    const loc = res.headers.get('location');
    const where = loc ? `${new URL(loc, target).host}${new URL(loc, target).pathname.replace(/\/s\/[\w-]+/, '/s/[id]').replace(/\/macros\/echo.*/, '/macros/echo')}` : '';
    hops.push(`${res.status}${where ? ` -> ${where}` : ''}`);
    if (!loc) break;
    target = new URL(loc, target).toString();
  }
  return `${method}: ${hops.join(' | ')}`;
}

const first = await call({ action: 'ping' });
if (!first.json) {
  const looksLikeAuth = /accounts\.google\.com|authorization|sign in|ServiceLogin|Google Accounts|script\.google\.com\/macros\/(?:d|s)/i.test(first.raw);
  if (looksLikeAuth || first.status === 401 || first.status === 403 || first.status === 404) {
    const title = /<title>([^<]*)<\/title>/i.exec(first.raw)?.[1]?.trim().slice(0, 80) ?? '(no title)';
    const text = first.raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    console.log(`PENDING  server answered with a non-API page (HTTP ${first.status}, page title: "${title}"). The owner has probably not approved the script yet (run setup once). Live test skipped.`);
    console.log(`page text: ${text}`);
    console.log(await redirectTrace('POST'));
    console.log(await redirectTrace('GET'));
    process.exit(0);
  }
  console.log(`FAIL  ping returned a non-JSON answer (HTTP ${first.status}, ${first.raw.length} chars)`);
  process.exit(1);
}
check('ping ok', first.json.ok === true, JSON.stringify(first.json));

// Right after a deploy Google can still answer from the previous version for a while (seen: a check of a new feature failed
// on the first deploy of a commit and passed on the second). Wait until three answers in a row come from this commit's build.
const expected = (process.env.GITHUB_SHA ?? '').slice(0, 7);
if (expected && first.json.build !== undefined) {
  const t0 = Date.now();
  let inARow = 0;
  while (inARow < 3) {
    const p = (await call({ action: 'ping' })).json;
    inARow = p?.build === expected ? inARow + 1 : 0;
    if (inARow < 3) {
      if (Date.now() - t0 > 180_000) {
        console.log(`FAIL  the server still answers from another build after 3 minutes (${String(p?.build)})`);
        process.exit(1);
      }
      if (inARow === 0) await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  console.log(`PASS  the server answers from this build (after ${Math.round((Date.now() - t0) / 1000)} s)`);
}

const run = Date.now();
const id = (n: string) => `live-${run}-${n}`;
const now = () => formatLocal(Date.now());
const base = { user: 'LiveTest', source: 'app' };

check('wrong key rejected', (await call({ action: 'ping' }, 'wrong-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).json?.error === 'unauthorized');
check('settings readable', (await call({ action: 'settings' })).json?.settings?.mergeWindowMin >= 0);

const rev0 = (await call({ action: 'poll' })).json?.rev;
check('poll returns a data revision', typeof rev0 === 'string', JSON.stringify(rev0));
const feed = await call({ action: 'log', id: id('feed'), type: 'feed', detail: 'left', start: now(), ...base });
check('feed logged with speech', feed.json?.ok === true && /^Logged left, \d{1,2}:\d{2}\./.test(feed.json?.speech ?? ''), JSON.stringify(feed.json));
check('the revision changed after a write', (await call({ action: 'poll' })).json?.rev !== rev0);
check('duplicate id is not written twice', (await call({ action: 'log', id: id('feed'), type: 'feed', detail: 'left', start: now(), ...base })).json?.duplicate === true);

const today = now().slice(0, 10);
const list = await call({ action: 'list', from: today, to: today });
check('list contains the feed', (list.json?.events ?? []).some((e: R) => e.id === id('feed')));
check('list returns settings and server time', Boolean(list.json?.settings) && Boolean(list.json?.serverNow));

const upd = await call({ action: 'update', id: id('feed'), patch: { note: 'live' } });
check('update works', upd.json?.event?.note === 'live');
check('an edit keeps the version before it (prev, its own sheet column)', JSON.parse(upd.json?.event?.prev || '{}').note === '' && JSON.parse(upd.json?.event?.prev || '{}').detail === 'left', JSON.stringify(upd.json?.event ?? {}).slice(0, 300));
check('invalid event rejected', (await call({ action: 'log', id: id('bad'), type: 'feed', detail: 'up', start: now(), ...base })).json?.error === 'invalid_event');

const sleepA = await call({ action: 'asleep', id: id('asleep'), start: now(), ...base });
check('asleep ok', sleepA.json?.ok === true && !sleepA.json?.noop, JSON.stringify(sleepA.json));
check('second asleep is a no-op', (await call({ action: 'asleep', id: id('asleep2'), start: now(), ...base })).json?.noop === true);
const wake = await call({ action: 'awake', id: id('awake'), end: now(), ...base });
check('awake closes the sleep', /^Awake\. /.test(wake.json?.speech ?? ''), JSON.stringify(wake.json));

check('status sentence', /ago, left side/.test((await call({ action: 'status' })).json?.speech ?? ''));

// medicines (API 0.3.0): a "Medicines" sheet tab, saved one by one; a dose is an event of type medicine
const med = { id: id('med'), name: 'LiveTest', dose: '1', schedule: 'prn', minGapHours: 4, maxPerDay: 4 };
const savedMed = await call({ action: 'settings', set: { medicines: [med] } });
check('medicine saved in the sheet', (savedMed.json?.settings?.medicines ?? []).some((m: R) => m.id === med.id && m.minGapHours === 4 && m.status === 'active'), JSON.stringify(savedMed.json));
const dose = await call({ action: 'log', id: id('dose'), type: 'medicine', detail: med.id, start: now(), ...base });
check('medicine dose logged', dose.json?.ok === true, JSON.stringify(dose.json));
check('a medicine with a dose cannot be removed', (await call({ action: 'settings', set: { medicines: [{ id: med.id, remove: true }] } })).json?.error === 'bad_request');

// sync (API 0.4.0): a phone's whole exchange in one request
const range = { from: today, to: today };
as('sync: first (list)');
const s0 = await call({ action: 'sync', ...range, debug: true });
check('sync without a revision returns the list', Array.isArray(s0.json?.events) && typeof s0.json?.rev === 'string', JSON.stringify(s0.json).slice(0, 200));
as('sync: nothing new');
const s1 = await call({ action: 'sync', ...range, rev: s0.json?.rev, debug: true });
check('sync with the current revision says unchanged and carries no list', s1.json?.unchanged === true && s1.json?.events === undefined, JSON.stringify(s1.json).slice(0, 200));
as('sync: one tap');
const s2 = await call({ action: 'sync', ...range, rev: s1.json?.rev, debug: true, ops: [{ action: 'log', id: id('sync1'), type: 'diaper', detail: 'wet', start: now(), ...base, fresh: true }] }); // as the app sends a first attempt
check('sync applies an operation and stays "unchanged" for an up-to-date phone', s2.json?.unchanged === true && s2.json?.results?.[0]?.ok === true && s2.json?.rev !== s1.json?.rev, JSON.stringify(s2.json).slice(0, 300));
as('sync: three taps');
const s3 = await call({
  action: 'sync',
  ...range,
  rev: s2.json?.rev,
  debug: true,
  ops: [
    { action: 'log', id: id('sync2'), type: 'feed', detail: 'right', start: now(), ...base },
    { action: 'update', id: id('sync2'), patch: { note: 'live' } },
    { action: 'log', id: id('sync1'), type: 'diaper', detail: 'wet', start: now(), ...base },
  ],
});
check('sync answers every operation in order (the repeated one as a duplicate)', s3.json?.results?.length === 3 && s3.json?.results?.[1]?.event?.note === 'live' && s3.json?.results?.[2]?.duplicate === true, JSON.stringify(s3.json).slice(0, 400));
as('sync: after a foreign write (list)');
const s4 = await call({ action: 'sync', ...range, rev: s1.json?.rev, debug: true });
check('sync with an older revision brings the list', (s4.json?.events ?? []).some((e: R) => e.id === id('sync2')), JSON.stringify(s4.json).slice(0, 200));
// (API 0.5.0, owner) a phone a little behind gets only what changed since its revision, without the sheet being opened
as('sync: after a foreign write (changes)');
const s5 = await call({ action: 'sync', ...range, rev: s1.json?.rev, delta: true, debug: true });
const s5ids = (s5.json?.changes ?? []).map((e: R) => e.id);
check(
  'sync with "delta" brings only the changes since that revision, in their newest state, and no list',
  s5.json?.events === undefined && s5ids.includes(id('sync1')) && s5ids.includes(id('sync2')) && (s5.json?.changes ?? []).find((e: R) => e.id === id('sync2'))?.note === 'live' && s5.json?.rev === s4.json?.rev,
  JSON.stringify(s5.json).slice(0, 300),
);
check('...and opens no sheet for it', !s5.json?.t?.['read#'] && !s5.json?.t?.['find#'], JSON.stringify(s5.json?.t ?? {}));
// What a browser beacon does when the app is being left: it posts and does not wait for, or follow, the answer.
// Apps Script answers a POST with a redirect to the stored output, so the write must already have happened by then.
const beacon = await fetch(url, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ key, action: 'sync', ...range, ops: [{ action: 'log', id: id('beacon'), type: 'diaper', detail: 'poop', start: now(), ...base, fresh: true }] }),
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
await beacon.body?.cancel();
const afterBeacon = await call({ action: 'list', ...range });
check('a write is recorded even when its answer is never fetched (what a beacon does)', (afterBeacon.json?.events ?? []).some((e: R) => e.id === id('beacon')), `HTTP ${beacon.status}`);
for (const n of ['sync1', 'sync2', 'beacon']) await call({ action: 'delete', id: id(n) });

// clean up what this run created (soft delete; the test medicine is removed once its dose is deleted)
for (const n of ['feed', 'asleep', 'awake', 'dose']) await call({ action: 'delete', id: id(n) });
const after = await call({ action: 'list', from: today, to: today });
check('cleanup removed this run from the list', !(after.json?.events ?? []).some((e: R) => String(e.id).startsWith(`live-${run}-`)));
const removed = await call({ action: 'settings', set: { medicines: [{ id: med.id, remove: true }] } });
check('cleanup removed the test medicine', removed.json?.ok === true && !(removed.json?.settings?.medicines ?? []).some((m: R) => m.id === med.id), JSON.stringify(removed.json));

// The timing table: "total" is the whole trip as a client sees it, "server" the part spent in our code.
console.log('TIMING  call | total ms | server ms | where the server time went (ms, and #calls)');
for (const x of timings) {
  const where = x.t ? Object.entries(x.t).map(([k, v]) => `${k}=${v}`).join(' ') : '';
  console.log(`TIMING  ${x.what} | ${x.total} | ${x.server ?? '?'} | ${where}`);
}
const med50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
console.log(`TIMING  median of ${timings.length} calls: total ${med50(timings.map((x) => x.total))} ms, server ${med50(timings.filter((x) => x.server !== null).map((x) => x.server as number))} ms`);

console.log(failures === 0 ? 'LIVE TEST PASSED' : `LIVE TEST FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
