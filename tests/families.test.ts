import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from '../scripts/deploy-families';
import { familyEnv, isFamilyId, newFamilyId, parseFamilies, readFamilies } from '../scripts/families';
import { usageText } from '../src/app/families';

describe('the families list (families.json)', () => {
  it('the file in the repository is valid', () => {
    expect(() => readFamilies()).not.toThrow();
  });
  it('accepts random ids and refuses names, reserved words, bad shapes and repeats', () => {
    expect(parseFamilies('{"families":["k3q9xa7m","ab12cd"]}')).toEqual(['k3q9xa7m', 'ab12cd']);
    expect(() => parseFamilies('{"families":["Cohen"]}')).toThrow(/not a valid/);
    expect(() => parseFamilies('{"families":["a b c d e"]}')).toThrow(/not a valid/);
    expect(() => parseFamilies('{"families":["abc"]}')).toThrow(/not a valid/);
    expect(() => parseFamilies('{"families":["k3q9xa7m","k3q9xa7m"]}')).toThrow(/twice/);
    expect(() => parseFamilies('{"families":"k3q9xa7m"}')).toThrow(/list/);
    expect(isFamilyId('test')).toBe(false);
    expect(isFamilyId('prod')).toBe(false);
  });
  it('a family never shares an environment with the test or production server', () => {
    expect(familyEnv('k3q9xa7m')).toEqual({ env: 'family-k3q9xa7m', title: 'BabyLog k3q9xa7m' });
    expect(() => familyEnv('prod')).toThrow();
    expect(() => familyEnv('../prod')).toThrow();
  });
  it('a new id is valid and not taken', () => {
    let calls = 0;
    // the first draw repeats a taken id, the second is new
    const seq = [...Array(8).fill(0), ...Array(8).fill(1)];
    const id = newFamilyId(['aaaaaaaa'], () => seq[calls++] ?? 2);
    expect(id).toBe('bbbbbbbb');
    expect(isFamilyId(newFamilyId([]))).toBe(true);
  });
});

describe('checking a family server after its deploy', () => {
  it("reads the build from our answer, recognises Google's approval page, and calls anything else a problem", () => {
    expect(classify(200, '{"ok":false,"error":"unauthorized","ms":3,"build":"abc1234"}')).toEqual({ kind: 'build', build: 'abc1234' });
    expect(classify(200, '<!DOCTYPE html><html><title>Sign in</title><a href="https://accounts.google.com/ServiceLogin">')).toEqual({ kind: 'signin', detail: 'HTTP 200, page "Sign in"' });
    // the first real family: Google answered HTTP 403 (not JSON) until the owner ran setup once
    expect(classify(403, '<html><head><title>Error 403</title></head><body>Forbidden</body></html>')).toEqual({ kind: 'signin', detail: 'HTTP 403, page "Error 403"' });
    expect(classify(500, '<html>Internal error</html>').kind).toBe('other');
    expect(classify(200, '{"ok":true}').kind).toBe('other');
  });
});

describe("the pipeline keeps the owner's server first and apart", () => {
  const yml = readFileSync('.github/workflows/pipeline.yml', 'utf8');
  const job = (name: string): string => {
    const m = yml.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z#]|$)`));
    if (!m) throw new Error(`no job ${name}`);
    return m[1]!;
  };
  it('the families job runs only on main, only after production, in its own concurrency group', () => {
    const f = job('families');
    expect(f).toMatch(/^ {4}needs: prod$/m);
    expect(f).toMatch(/if: github\.ref == 'refs\/heads\/main'/);
    expect(f).toMatch(/group: family-servers/);
    expect(f).toMatch(/deploy-families\.ts/);
    expect(f).toMatch(/report\.sh families/);
  });
  it('a family server is a production build: the families job never has the test key', () => {
    expect(job('families')).not.toMatch(/FIXED_KEY/);
  });
  it('production does not wait for, or depend on, the families', () => {
    const p = job('prod');
    expect(p).toMatch(/needs: \[test, server\]/);
    expect(p).not.toMatch(/famil/);
    expect(job('server')).not.toMatch(/famil/);
  });
});

// Owner (F15 option B, 27 Nov 2026): every server's usage days as one text for a chat, in Hebrew, no names.
describe('usage text', () => {
  it('lists each server, then each phone and day with its counts in label order and the questions\' states', () => {
    const text = usageText([
      {
        label: 'שלנו',
        rows: [
          { date: '2026-11-26', parent: 'הורה 1', phone: 1, version: 'abc1234', counts: { 'sync.requests': 40, 'log.feed_left': 3, 'log.wet': 0 }, states: { gaps: 'on' } },
          { date: '2026-11-26', parent: 'הורה 2', phone: 2, version: '', counts: {} },
        ],
      },
      { label: 'משפחה א', rows: 'old' },
      { label: 'משפחה ב', rows: 'error' },
      { label: 'משפחה ג', rows: [] },
    ]);
    expect(text).toBe(
      [
        '== שלנו ==',
        '2026-11-26 · הורה 1 · טלפון 1 · גרסה abc1234',
        'רישום: הנקה שמאל 3 · בקשות לשרת 40',
        'שאלות: כל כמה זמן מאכילים: הודלקה ידנית',
        '',
        '2026-11-26 · הורה 2 · טלפון 2',
        'אין פעולות',
        '',
        '== משפחה א ==',
        'השרת עוד לא מעודכן',
        '',
        '== משפחה ב ==',
        'לא ענה',
        '',
        '== משפחה ג ==',
        'אין נתונים',
      ].join('\n'),
    );
  });
});
