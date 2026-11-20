import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeSetupCode } from '../src/app/config';
import { startMockServer } from '../scripts/mock-server';

let mock: ReturnType<typeof startMockServer>;
let site: Server;
let siteUrl = '';
let mockUrl = '';
let work = '';
let bin = '';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as { port: number }).port;
}

beforeAll(async () => {
  execFileSync('npx', ['tsx', 'scripts/build-shortcuts.ts'], { stdio: 'pipe' });
  work = mkdtempSync(join(tmpdir(), 'bl-sign-'));
  bin = join(work, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  // stand-ins for Apple's tools: "plutil" does nothing, "shortcuts sign" copies the input
  writeFileSync(join(bin, 'plutil'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(bin, 'shortcuts'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in --input) i="$2"; shift;; --output) o="$2"; shift;; esac; shift; done\ncp "$i" "$o"\n');
  chmodSync(join(bin, 'plutil'), 0o755);
  chmodSync(join(bin, 'shortcuts'), 0o755);

  mock = startMockServer(0);
  await mock.listen();
  mockUrl = `http://127.0.0.1:${mock.port()}/`;
  await fetch(mockUrl, { method: 'POST', body: JSON.stringify({ key: 'test-key', action: 'settings', set: { parents: ['Tom & Jerry', 'Ann <B>'] } }) });

  site = createServer((req, res) => {
    try {
      const file = join(process.cwd(), 'dist', decodeURIComponent(new URL(req.url!, 'http://x').pathname));
      res.writeHead(200).end(readFileSync(file));
    } catch {
      res.writeHead(404).end('nope');
    }
  });
  siteUrl = `http://127.0.0.1:${await listen(site)}`;
});

afterAll(async () => {
  await mock.close();
  site.close();
});

// Asynchronous on purpose: the script talks to servers hosted by this very process.
function sign(env: Record<string, string>, outName: string): Promise<{ status: number; stdout: string; stderr: string; out: string }> {
  const out = join(work, outName);
  return new Promise((resolve) => {
    execFile(
      'bash',
      ['scripts/shortcuts/sign.sh'],
      { env: { ...process.env, BABYLOG_SITE: siteUrl, BABYLOG_OUT: out, BABYLOG_SIGN_CMD: join(bin, 'shortcuts'), BABYLOG_PLUTIL_CMD: join(bin, 'plutil'), BABYLOG_ALLOW_NON_MAC: '1', BABYLOG_NO_OPEN: '1', ...env }, encoding: 'utf8', timeout: 60_000 },
      (err, stdout, stderr) => resolve({ status: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr, out }),
    );
  });
}

describe('Mac signing script', () => {
  it('creates, for each parent, an English and a Hebrew folder of signed shortcuts with the secrets filled in', async () => {
    const r = await sign({ BABYLOG_CODE: encodeSetupCode(mockUrl, 'test-key') }, 'ok');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('50 signed shortcuts');
    const folders = readdirSync(r.out).sort();
    expect(folders).toEqual(['Ann <B>', 'Tom & Jerry']);
    for (const f of folders) {
      expect(readdirSync(join(r.out, f)).sort()).toEqual(['English', 'עברית']);
      expect(readdirSync(join(r.out, f, 'English'))).toHaveLength(13);
      expect(readdirSync(join(r.out, f, 'עברית')).sort()).toEqual(
        ['הנקה ימין', 'הנקה שמאל', 'התינוק התעורר', 'התינוק נרדם', 'ויטמין די', 'חיתול מלא', 'חיתול פיפי', 'חיתול קקי', 'יומן תינוק', 'מתי הנקה אחרונה', 'תסמני הנקה ימין', 'תסמני הנקה שמאל'].map((n) => `${n}.shortcut`).sort(),
      );
    }
    const left = readFileSync(join(r.out, 'Tom & Jerry', 'English', 'Left feed.shortcut'), 'utf8');
    expect(left).not.toContain('@@');
    expect(left).toContain(mockUrl);
    expect(left).toContain('test-key');
    expect(left).toContain('Tom &amp; Jerry'); // XML-escaped
    expect(readFileSync(join(r.out, 'Ann <B>', 'עברית', 'הנקה ימין.shortcut'), 'utf8')).toContain('Ann &lt;B&gt;');
  });

  it('a girl: the Hebrew sleep shortcuts use her words', async () => {
    await fetch(mockUrl, { method: 'POST', body: JSON.stringify({ key: 'test-key', action: 'settings', set: { babySex: 'girl' } }) });
    const r = await sign({ BABYLOG_CODE: encodeSetupCode(mockUrl, 'test-key') }, 'girl');
    await fetch(mockUrl, { method: 'POST', body: JSON.stringify({ key: 'test-key', action: 'settings', set: { babySex: 'boy' } }) });
    expect(r.status, r.stderr).toBe(0);
    const he = readdirSync(join(r.out, 'Tom & Jerry', 'עברית'));
    expect(he).toContain('התינוקת נרדמה.shortcut');
    expect(he).toContain('התינוקת התעוררה.shortcut');
    expect(he).not.toContain('התינוק נרדם.shortcut');
    expect(readFileSync(join(r.out, 'Tom & Jerry', 'עברית', 'יומן תינוק.shortcut'), 'utf8')).toContain('נרדמה');
  });

  it('refuses the private /dev address unless a real address is supplied', async () => {
    const devCode = encodeSetupCode(`${mockUrl}dev`, 'test-key');
    const none = await sign({ BABYLOG_CODE: devCode }, 'dev1');
    expect(none.status).not.toBe(0);
    expect(none.stderr).toMatch(/No address given|private test address/);
    const bad = await sign({ BABYLOG_CODE: devCode, BABYLOG_EXEC_URL: 'http://example.test/exec' }, 'dev2');
    expect(bad.stderr).toMatch(/must start with https/);
    const good = await sign({ BABYLOG_CODE: devCode, BABYLOG_EXEC_URL: mockUrl }, 'dev3');
    expect(good.status, good.stderr).toBe(0);
    const text = readFileSync(join(good.out, 'Tom & Jerry', 'English', 'Left feed.shortcut'), 'utf8');
    expect(text).toContain(mockUrl);
    expect(text).not.toContain(`${mockUrl}dev`);
  });

  it('refuses a wrong key without writing anything', async () => {
    const r = await sign({ BABYLOG_CODE: encodeSetupCode(mockUrl, 'not-the-key-123') }, 'bad');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/did not accept the code/);
    expect(() => readdirSync(r.out)).toThrow();
  });

  it('refuses malformed codes and a missing site', async () => {
    expect((await sign({ BABYLOG_CODE: 'hello' }, 'x1')).stderr).toMatch(/must start with BL1/);
    expect((await sign({ BABYLOG_CODE: 'BL1.@@@' }, 'x2')).status).not.toBe(0);
    expect((await sign({ BABYLOG_CODE: encodeSetupCode(mockUrl, 'test-key'), BABYLOG_SITE: '' }, 'x3')).stderr).toMatch(/BABYLOG_SITE/);
  });

  it('says clearly when it is not run on a Mac', async () => {
    const r = await sign({ BABYLOG_CODE: encodeSetupCode(mockUrl, 'test-key'), BABYLOG_ALLOW_NON_MAC: '' }, 'x4');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/must be run on a Mac/);
  });
});
