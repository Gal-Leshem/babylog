import { describe, expect, it } from 'vitest';
import { sanitizeLine, sanitizeLog } from '../scripts/sanitize.mjs';

describe('CI log sanitizer', () => {
  it('removes e-mail addresses, deployment ids and long tokens', () => {
    const line = 'user a.b@example.com deployed AKfycbxyz123_-ABCdef with key 0123456789abcdef0123456789abcdef0123';
    const out = sanitizeLine(line);
    expect(out).not.toMatch(/example\.com|AKfycb|0123456789abcdef/);
    expect(out).toContain('[email]');
  });
  it('removes ids from script and sheet urls', () => {
    const out = sanitizeLine('https://script.google.com/macros/s/ABC_def-123/exec and https://docs.google.com/spreadsheets/d/1AbC-d_E/edit');
    expect(out).toBe('https://script.google.com/macros/s/[id]/exec and https://docs.google.com/spreadsheets/d/[id]/edit');
  });
  it('redacts forbidden words case-insensitively', () => {
    expect(sanitizeLine('Hello SECRET world', ['secret'])).toBe('Hello [redacted] world');
  });
  it('strips colour codes and keeps only the last lines', () => {
    expect(sanitizeLine('\u001b[31mred\u001b[0m')).toBe('red');
    const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const out = sanitizeLog(text, [], 80);
    expect(out).toHaveLength(80);
    expect(out[79]).toBe('line 199');
  });
  it('leaves ordinary build output alone', () => {
    expect(sanitizeLine('✓ 82 tests passed in 2.4s')).toBe('✓ 82 tests passed in 2.4s');
  });
});
