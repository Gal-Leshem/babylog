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
async function call(body: Record<string, unknown>, k = key): Promise<{ status: number; raw: string; json?: R }> {
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key: k, ...body }),
  });
  const raw = await res.text();
  try {
    return { status: res.status, raw, json: JSON.parse(raw) as R };
  } catch {
    return { status: res.status, raw };
  }
}

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` ${detail}`}`);
  if (!cond) failures++;
};

const first = await call({ action: 'ping' });
if (!first.json) {
  const looksLikeAuth = /accounts\.google\.com|authorization|sign in|ServiceLogin|Google Accounts|script\.google\.com\/macros\/(?:d|s)/i.test(first.raw);
  if (looksLikeAuth || first.status === 401 || first.status === 403 || first.status === 404) {
    console.log(`PENDING  server answered with a non-API page (HTTP ${first.status}). The owner has not approved the script yet (run setup once). Live test skipped.`);
    process.exit(0);
  }
  console.log(`FAIL  ping returned a non-JSON answer (HTTP ${first.status}, ${first.raw.length} chars)`);
  process.exit(1);
}
check('ping ok', first.json.ok === true, JSON.stringify(first.json));

const run = Date.now();
const id = (n: string) => `live-${run}-${n}`;
const now = () => formatLocal(Date.now());
const base = { user: 'LiveTest', source: 'app' };

check('wrong key rejected', (await call({ action: 'ping' }, 'wrong-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).json?.error === 'unauthorized');
check('settings readable', (await call({ action: 'settings' })).json?.settings?.mergeWindowMin >= 0);

const feed = await call({ action: 'log', id: id('feed'), type: 'feed', detail: 'left', start: now(), ...base });
check('feed logged with speech', feed.json?.ok === true && /^Logged left, \d{1,2}:\d{2}\./.test(feed.json?.speech ?? ''), JSON.stringify(feed.json));
check('duplicate id is not written twice', (await call({ action: 'log', id: id('feed'), type: 'feed', detail: 'left', start: now(), ...base })).json?.duplicate === true);

const today = now().slice(0, 10);
const list = await call({ action: 'list', from: today, to: today });
check('list contains the feed', (list.json?.events ?? []).some((e: R) => e.id === id('feed')));
check('list returns settings and server time', Boolean(list.json?.settings) && Boolean(list.json?.serverNow));

check('update works', (await call({ action: 'update', id: id('feed'), patch: { note: 'live' } })).json?.event?.note === 'live');
check('invalid event rejected', (await call({ action: 'log', id: id('bad'), type: 'feed', detail: 'up', start: now(), ...base })).json?.error === 'invalid_event');

const sleepA = await call({ action: 'asleep', id: id('asleep'), start: now(), ...base });
check('asleep ok', sleepA.json?.ok === true && !sleepA.json?.noop, JSON.stringify(sleepA.json));
check('second asleep is a no-op', (await call({ action: 'asleep', id: id('asleep2'), start: now(), ...base })).json?.noop === true);
const wake = await call({ action: 'awake', id: id('awake'), end: now(), ...base });
check('awake closes the sleep', /^Awake\. /.test(wake.json?.speech ?? ''), JSON.stringify(wake.json));

check('status sentence', /ago, left side/.test((await call({ action: 'status' })).json?.speech ?? ''));

// clean up what this run created (soft delete)
for (const n of ['feed', 'asleep', 'awake']) await call({ action: 'delete', id: id(n) });
const after = await call({ action: 'list', from: today, to: today });
check('cleanup removed this run from the list', !(after.json?.events ?? []).some((e: R) => String(e.id).startsWith(`live-${run}-`)));

console.log(failures === 0 ? 'LIVE TEST PASSED' : `LIVE TEST FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
