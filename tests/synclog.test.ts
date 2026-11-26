import { describe, expect, it } from 'vitest';
import type { SyncLogEntry } from '../src/app/engine';
import { logLines } from '../src/app/synclog';

const tap: SyncLogEntry = {
  at: Date.parse('2026-11-26T09:39:14Z'),
  why: 'tap',
  result: 'ok',
  totalMs: 5900,
  serverMs: 4200,
  t: { props: 400, 'props#': 3, open: 0, 'open#': 1, sheet: 1900, 'sheet#': 2, lock: 200, 'lock#': 1, read: 300, 'read#': 1, write: 500, 'write#': 1, unlock: 10, 'unlock#': 1 },
  list: false,
  ops: 1,
};

describe('sync log lines', () => {
  it('name the Events tab lookup and say how much of the server time was not timed (owner, log 3)', () => {
    const lines = logLines(tap);
    expect(lines[1]).toBe('שרת 4.2 ש׳ · רשת וגוגל 1.7 ש׳ · בלי שינוי · 1 נשלחו');
    expect(lines[2]).toBe('בשרת: מאפיינים 0.4 ש׳ · לשונית ושורות 1.9 ש׳ · נעילה 0.2 ש׳ · קריאה 0.3 ש׳ · כתיבה 0.5 ש׳ · לא מדוד 0.9 ש׳');
  });

  it('say nothing about untimed work under a tenth of a second, and leave out parts that would read 0.0', () => {
    const lines = logLines({ ...tap, serverMs: 3350 });
    expect(lines[2]).not.toContain('לא מדוד');
    expect(lines[2]).not.toContain('שחרור נעילה');
    const check = logLines({ ...tap, why: 'poll', totalMs: 1200, serverMs: 30, t: { props: 25, 'props#': 1, open: 3, 'open#': 1 }, ops: 0 });
    expect(check).toHaveLength(2); // no "בשרת:" line of zeros
  });
});
