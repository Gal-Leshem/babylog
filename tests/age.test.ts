import { describe, expect, it } from 'vitest';
import { ageText, monthDayText } from '../src/app/labels';

// (owner) the baby's age under the date of birth in Settings: calendar months, then days; years from the first birthday
describe('ageText', () => {
  it('days in the first month', () => {
    expect(ageText('2026-11-24', '2026-11-24')).toBe('היום הראשון');
    expect(ageText('2026-11-23', '2026-11-24')).toBe('יום אחד');
    expect(ageText('2026-11-22', '2026-11-24')).toBe('יומיים');
    expect(ageText('2026-11-12', '2026-11-24')).toBe('12 ימים');
    expect(ageText('2026-10-25', '2026-11-24')).toBe('30 ימים');
  });
  it('months and days, with the right "ו"', () => {
    expect(ageText('2026-10-24', '2026-11-24')).toBe('חודש');
    expect(ageText('2026-10-19', '2026-11-24')).toBe('חודש ו-5 ימים');
    expect(ageText('2026-09-22', '2026-11-24')).toBe('חודשיים ויומיים');
    expect(ageText('2026-09-23', '2026-11-24')).toBe('חודשיים ויום אחד');
    expect(ageText('2026-08-24', '2026-11-24')).toBe('3 חודשים');
    expect(ageText('2026-01-25', '2026-11-24')).toBe('9 חודשים ו-30 ימים');
  });
  it('a month is counted on the same day of the month (end of month clamped)', () => {
    expect(ageText('2026-01-31', '2026-02-28')).toBe('חודש');
    expect(ageText('2026-01-31', '2026-02-27')).toBe('27 ימים');
    expect(ageText('2026-01-31', '2026-03-31')).toBe('חודשיים');
  });
  it('years and months; nothing for a missing or future date', () => {
    expect(ageText('2025-11-24', '2026-11-24')).toBe('שנה');
    expect(ageText('2025-08-10', '2026-11-24')).toBe('שנה ו-3 חודשים');
    expect(ageText('2024-10-24', '2026-11-24')).toBe('שנתיים וחודש');
    expect(ageText(undefined, '2026-11-24')).toBe('');
    expect(ageText('2026-11-25', '2026-11-24')).toBe('');
  });
});

describe('the day the baby turns a whole number of months (owner)', () => {
  it('only on that day, in words; the end of a month counts as the day', () => {
    expect(monthDayText('2026-09-14', '2026-10-14')).toBe('חודש');
    expect(monthDayText('2026-09-14', '2026-11-14')).toBe('חודשיים');
    expect(monthDayText('2026-09-14', '2026-12-14')).toBe('3 חודשים');
    expect(monthDayText('2026-09-14', '2027-09-14')).toBe('שנה');
    expect(monthDayText('2026-09-14', '2027-11-14')).toBe('שנה וחודשיים');
    expect(monthDayText('2026-01-31', '2026-02-28')).toBe('חודש');
    for (const today of ['2026-09-14', '2026-11-13', '2026-11-15', '2026-09-30']) expect(monthDayText('2026-09-14', today), today).toBe('');
    expect(monthDayText(undefined, '2026-11-14')).toBe('');
  });
});
