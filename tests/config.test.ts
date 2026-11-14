import { describe, expect, it } from 'vitest';
import { decodeSetupCode, encodeSetupCode } from '../src/app/config';
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
