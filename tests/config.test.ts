import { describe, expect, it } from 'vitest';
import { decodeSetupCode, encodeSetupCode, isEditorTestUrl, isServerUrl } from '../src/app/config';
import { encodeInstallCode } from '../src/server/auth';

describe('setup code', () => {
  it('round-trips, including non-ASCII text', () => {
    const code = encodeSetupCode('https://script.google.com/macros/s/ABC/exec', 'k'.repeat(64));
    expect(code.startsWith('BL1.')).toBe(true);
    expect(decodeSetupCode(code)).toEqual({ url: 'https://script.google.com/macros/s/ABC/exec', key: 'k'.repeat(64) });
    expect(decodeSetupCode(encodeSetupCode('https://x.test/é', 'שלום-key-1234'))?.key).toBe('שלום-key-1234');
  });

  it('decodes what the server prints (base64url without padding)', () => {
    const fromServer = encodeInstallCode('https://script.google.com/macros/s/XYZ/exec', 'a1b2c3d4e5f6a7b8', (s) => Buffer.from(s, 'utf8').toString('base64url'));
    expect(decodeSetupCode(fromServer)).toEqual({ url: 'https://script.google.com/macros/s/XYZ/exec', key: 'a1b2c3d4e5f6a7b8' });
  });

  it('tolerates whitespace and line breaks from copying', () => {
    const code = encodeSetupCode('https://script.google.com/macros/s/ABC/exec', 'k'.repeat(40));
    expect(decodeSetupCode(`  ${code.slice(0, 20)}\n${code.slice(20)}  `)).not.toBeNull();
  });

  it('rejects garbage, wrong prefixes, weak keys and non-https addresses', () => {
    expect(decodeSetupCode('')).toBeNull();
    expect(decodeSetupCode('hello')).toBeNull();
    expect(decodeSetupCode('BL1.@@@')).toBeNull();
    expect(decodeSetupCode(encodeSetupCode('https://x.test/', 'short'))).toBeNull();
    expect(decodeSetupCode(encodeSetupCode('http://evil.test/', 'k'.repeat(40)))).toBeNull();
    expect(decodeSetupCode(encodeSetupCode('ftp://x.test/', 'k'.repeat(40)))).toBeNull();
  });

  it('allows a local address for development only', () => {
    expect(decodeSetupCode(encodeSetupCode('http://127.0.0.1:8787/', 'k'.repeat(40)))).not.toBeNull();
  });
});

describe('server addresses', () => {
  it('recognises the editor-only test address', () => {
    expect(isEditorTestUrl('https://script.google.com/macros/s/ABC_1-x/dev')).toBe(true);
    expect(isEditorTestUrl('https://script.google.com/macros/s/ABC_1-x/dev/')).toBe(true);
    expect(isEditorTestUrl('https://script.google.com/macros/s/ABC_1-x/exec')).toBe(false);
    expect(isEditorTestUrl('https://example.test/device')).toBe(false);
  });
  it('accepts only https (or local http)', () => {
    expect(isServerUrl('https://script.google.com/macros/s/x/exec')).toBe(true);
    expect(isServerUrl('http://127.0.0.1:8787/')).toBe(true);
    expect(isServerUrl('http://example.test/exec')).toBe(false);
    expect(isServerUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('admin code (family servers)', () => {
  it('round-trips, and is never taken for a setup code (or the other way round)', async () => {
    const { decodeAdminCode, encodeAdminCode } = await import('../src/app/config');
    const url = 'https://script.google.com/macros/s/ABC/exec';
    const code = encodeAdminCode(url, 'a'.repeat(64));
    expect(code.startsWith('BLA.')).toBe(true);
    expect(decodeAdminCode(code)).toEqual({ url, key: 'a'.repeat(64) });
    expect(decodeSetupCode(code)).toBeNull();
    expect(decodeAdminCode(encodeSetupCode(url, 'a'.repeat(64)))).toBeNull();
  });
  it("the owner's list of family servers survives bad stored data and is removed when empty", async () => {
    const { loadFamilies, saveFamilies, FAMILIES_KEY } = await import('../src/app/families');
    const { memoryStorage } = await import('../src/app/storage');
    const kv = memoryStorage();
    expect(loadFamilies(kv)).toEqual([]);
    kv.set(FAMILIES_KEY, [{ label: 'א', url: 'https://x/exec', key: 'k'.repeat(10) }, { nope: 1 }, null]);
    expect(loadFamilies(kv)).toEqual([{ label: 'א', url: 'https://x/exec', key: 'k'.repeat(10) }]);
    saveFamilies([], kv);
    expect(kv.data.has(FAMILIES_KEY)).toBe(false);
  });
});
