import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { compileDenylist, findLines, matches, parseDenylist } from '../scripts/privacy-lib';

const p = (...w: string[]) => compileDenylist(w);

describe('privacy word matching', () => {
  it('parses a list, ignoring blanks and comments', () => {
    expect(parseDenylist('A\n\n  B  \r\n# note\nC')).toEqual(['A', 'B', 'C']);
    expect(parseDenylist(undefined)).toEqual([]);
  });

  it('matches whole Latin words case-insensitively', () => {
    const d = p('Alex');
    expect(matches('Hello alex!', d)).toBe(true);
    expect(matches('user-alex-id', d)).toBe(true);
    expect(matches('Alexander', d)).toBe(false);
    expect(matches('galex', d)).toBe(false);
  });

  it('does not match inside longer words', () => {
    const d = p('Sam');
    expect(matches('sample', d)).toBe(false);
    expect(matches('Samurai', d)).toBe(false);
    expect(matches('by sam.', d)).toBe(true);
  });

  it('matches Hebrew names with and without one-letter prefixes', () => {
    const d = p('דנה');
    expect(matches('שלום דנה', d)).toBe(true);
    expect(matches('לדנה', d)).toBe(true);
    expect(matches('ובדנה', d)).toBe(true);
    expect(matches('דנהאל', d)).toBe(false);
    expect(matches('מדנה', d)).toBe(true);
  });

  it('matches e-mail addresses anywhere, case-insensitively', () => {
    const d = p('Someone.Name@example.com');
    expect(matches('contact: someone.name@example.com;', d)).toBe(true);
    expect(matches('someone.name@example.org', d)).toBe(false);
  });

  it('escapes regex characters in entries', () => {
    expect(matches('a b', p('a.b'))).toBe(false);
    expect(matches('a.b', p('a.b'))).toBe(true);
  });

  it('reports line numbers only', () => {
    const text = 'ok\nsecret here\nfine\nSECRET again';
    expect(findLines(text, p('secret'))).toEqual([2, 4]);
  });

  it('finds nothing when the list is empty', () => {
    expect(matches('anything', p())).toBe(false);
  });
});

describe('privacy check script', () => {
  const run = (env: Record<string, string>) => {
    try {
      const out = execFileSync('npx', ['tsx', 'scripts/privacy-check.ts'], { env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stderr: string; stdout: string };
      return { code: err.status, out: err.stderr + err.stdout };
    }
  };

  it('refuses to run without a word list', () => {
    expect(run({ PRIVACY_DENYLIST: '' }).code).toBe(1);
  });

  it('passes for words that are not in the repository', () => {
    // Assembled at runtime so the literal does not itself appear in the repository.
    const absent = ['zzqx', 'absent', 'word', '91'].join('-');
    expect(run({ PRIVACY_DENYLIST: absent }).code).toBe(0);
  });

  it('fails without revealing the word', () => {
    // "privacy" certainly appears in this repository (this very test file).
    const r = run({ PRIVACY_DENYLIST: 'privacy' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('FAILED');
    expect(r.out).toMatch(/tests\/privacy\.test\.ts:\d+/);
    expect(r.out.toLowerCase().split('privacy check').join('').includes('"privacy"')).toBe(false);
  });
});
