import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from '../scripts/deploy-families';
import { familyEnv, isFamilyId, newFamilyId, parseFamilies, readFamilies } from '../scripts/families';

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
  it('reads the build from our answer, recognises Google\'s approval page, and calls anything else a problem', () => {
    expect(classify(200, '{"ok":false,"error":"unauthorized","ms":3,"build":"abc1234"}')).toEqual({ kind: 'build', build: 'abc1234' });
    expect(classify(200, '<!DOCTYPE html><html><title>Sign in</title><a href="https://accounts.google.com/ServiceLogin">')).toEqual({ kind: 'signin' });
    expect(classify(500, '<html>Internal error</html>').kind).toBe('other');
    expect(classify(200, '{"ok":true}').kind).toBe('other');
  });
});

describe('the pipeline keeps the owner\'s server first and apart', () => {
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
