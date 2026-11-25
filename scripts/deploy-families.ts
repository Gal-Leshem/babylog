import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { familyEnv, readFamilies } from './families';

/**
 * Creates or updates the server of every family in families.json, one after the other (runs after production, in a job of its
 * own, so a family's deploy can never delay or break the owner's). Each deploy runs in its own process. Then checks that each
 * server answers from this build. One line per family:
 *   FAMILY <id>: deployed, answers from this build
 *   FAMILY <id>: deployed, waiting for the owner's setup     (a new script answers only after the owner ran setup() once)
 *   FAMILY <id>: FAILED (<reason>)
 * Exits 1 when any family FAILED (after trying all of them). Needs CLASP_AUTH_DIR, like deploy-server.ts.
 */
const build = (process.env.GITHUB_SHA ?? 'local').slice(0, 7);
const outDir = process.env.RUNNER_TEMP ?? tmpdir();
const WAIT_MS = Number(process.env.FAMILY_WAIT_MS ?? 90_000);

export type Answer = { kind: 'build'; build: string } | { kind: 'signin'; detail: string } | { kind: 'other'; detail: string };

/** What a server's answer to an anonymous ping says: our JSON with its build, Google's sign-in / approval page, or something else. */
export function classify(status: number, raw: string): Answer {
  try {
    const j = JSON.parse(raw) as { build?: unknown };
    if (typeof j.build === 'string') return { kind: 'build', build: j.build };
    return { kind: 'other', detail: `HTTP ${status}, JSON without build` };
  } catch {
    const title = /<title>([^<]{0,80})/i.exec(raw)?.[1]?.trim();
    const detail = `HTTP ${status}${title ? `, page "${title}"` : ', not JSON'}`;
    // the page Google shows until the owner has approved the new script once: a sign-in / authorization page (the live test's
    // test), or a plain 401 / 403 page (seen for the first family: HTTP 403 right after the script was created)
    if (status === 401 || status === 403 || /accounts\.google\.com|authorization|sign in|ServiceLogin|Google Accounts|script\.google\.com\/macros\/(?:d|s)/i.test(raw)) return { kind: 'signin', detail };
    return { kind: 'other', detail };
  }
}

async function ping(url: string): Promise<Answer> {
  try {
    // no key: the answer is "unauthorized", which still carries the build; nothing is read or written
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ping' }),
      signal: AbortSignal.timeout(30_000),
    });
    return classify(res.status, await res.text());
  } catch (e) {
    return { kind: 'other', detail: e instanceof Error ? e.name : 'error' };
  }
}

/** Waits until the server answers from this build (right after a deploy Google can still answer from the previous version). */
async function check(url: string): Promise<string> {
  const until = Date.now() + WAIT_MS;
  let last: Answer = { kind: 'other', detail: 'no answer' };
  while (Date.now() < until) {
    last = await ping(url);
    if (last.kind === 'signin') return `deployed, waiting for the owner's setup (${last.detail})`;
    if (last.kind === 'build' && last.build === build) return 'deployed, answers from this build';
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(last.kind === 'build' ? `still answers from build ${last.build}` : last.kind === 'other' ? last.detail : 'sign-in page');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

async function main(): Promise<void> {
  const ids = readFamilies();
  if (ids.length === 0) {
    console.log('no family servers (families.json is empty)');
    process.exit(0);
  }
  let failed = 0;
  for (const id of ids) {
    const { env } = familyEnv(id);
    try {
      execFileSync('npx', ['tsx', 'scripts/deploy-server.ts', 'family', id], {
        stdio: 'inherit',
      });
      const { url } = JSON.parse(readFileSync(join(outDir, `server-${env}.json`), 'utf8')) as { url: string };
      console.log(`FAMILY ${id}: ${await check(url)}`);
    } catch (e) {
      failed += 1;
      console.log(`FAMILY ${id}: FAILED (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`);
    }
  }
  console.log(failed ? `${failed} of ${ids.length} family servers FAILED` : `all ${ids.length} family servers deployed`);
  process.exit(failed ? 1 : 0);
}
