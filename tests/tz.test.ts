import { describe, expect, it } from 'vitest';
import { addDays, dayStart, formatLocal, isDateString, localDate, offsetMinutesAt, parseLocal } from '../src/shared/tz';

const icu = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function icuLocal(epoch: number): string {
  const p = Object.fromEntries(icu.formatToParts(new Date(epoch)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

describe('Israel time rules', () => {
  it('matches ICU every 30 minutes for 2020-2040', () => {
    const start = Date.UTC(2020, 0, 1);
    const end = Date.UTC(2040, 0, 1);
    let bad = 0;
    for (let t = start; t < end; t += 30 * 60_000) {
      if (formatLocal(t) !== icuLocal(t)) {
        bad += 1;
        if (bad < 5) console.log('mismatch', new Date(t).toISOString(), formatLocal(t), icuLocal(t));
      }
    }
    expect(bad).toBe(0);
  });

  it('knows the 2026 transitions', () => {
    // DST starts Friday 2026-03-27 at 02:00, ends Sunday 2026-10-25 at 02:00
    expect(formatLocal(Date.UTC(2026, 2, 27, 0, 0))).toBe('2026-03-27 03:00');
    expect(formatLocal(Date.UTC(2026, 2, 26, 23, 59))).toBe('2026-03-27 01:59');
    expect(formatLocal(Date.UTC(2026, 9, 24, 22, 59))).toBe('2026-10-25 01:59');
    expect(formatLocal(Date.UTC(2026, 9, 24, 23, 0))).toBe('2026-10-25 01:00');
    expect(offsetMinutesAt(Date.UTC(2026, 6, 1))).toBe(180);
    expect(offsetMinutesAt(Date.UTC(2026, 0, 1))).toBe(120);
  });

  it('round-trips parse and format outside transition gaps', () => {
    for (const s of ['2026-11-14 03:12', '2026-07-01 23:59', '2026-01-01 00:00', '2027-03-26 12:00']) {
      expect(formatLocal(parseLocal(s))).toBe(s);
    }
  });

  it('rejects malformed and nonexistent times', () => {
    expect(parseLocal('2026-11-14')).toBeNaN();
    expect(parseLocal('2026-11-14 25:00')).toBeNaN();
    expect(parseLocal('2026-13-14 01:00')).toBeNaN();
    expect(parseLocal('2026-03-27 02:30')).toBeNaN(); // spring-forward gap
  });

  it('resolves the repeated autumn hour to the first occurrence', () => {
    const t = parseLocal('2026-10-25 01:30');
    expect(t).toBe(Date.UTC(2026, 9, 24, 22, 30)); // summer time (UTC+3)
  });

  it('computes days around DST correctly', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    // the day of the autumn change is 25 hours long
    expect((dayStart('2026-10-26') - dayStart('2026-10-25')) / 3_600_000).toBe(25);
    expect((dayStart('2026-03-28') - dayStart('2026-03-27')) / 3_600_000).toBe(23);
    expect(localDate(Date.UTC(2026, 10, 14, 22, 30))).toBe('2026-11-15');
  });

  it('validates date strings', () => {
    expect(isDateString('2026-02-29')).toBe(false);
    expect(isDateString('2028-02-29')).toBe(true);
    expect(isDateString('26-1-1')).toBe(false);
  });
});
