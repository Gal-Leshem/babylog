import { describe, expect, it } from 'vitest';
import { DEFAULT_VITAMIN_D, type Medicine, courseProgress, doseText, doseWarnings, dosesOf, medicineToday, pickIcon, withVitaminD } from '../src/shared/medicines';
import { T, ev } from './helpers';

const med = (over: Partial<Medicine> = {}): Medicine => ({ ...DEFAULT_VITAMIN_D, id: 'm1', name: 'x', icon: '💊', created: '', ...over });
const NOW = T('2026-11-14 12:00');

describe('medicine helpers', () => {
  it('vitamin D is added first when missing, and kept as edited when present', () => {
    expect(withVitaminD([med()]).map((m) => m.id)).toEqual(['vitamin_d', 'm1']);
    const edited = { ...DEFAULT_VITAMIN_D, status: 'archived' as const };
    expect(withVitaminD([med(), edited])).toEqual([edited, med()]);
  });

  it('a new medicine gets an icon no active medicine uses; archived ones free theirs', () => {
    expect(pickIcon([DEFAULT_VITAMIN_D])).toBe('🧸');
    expect(pickIcon([DEFAULT_VITAMIN_D, med({ icon: '🧸' })])).toBe('🍓');
    expect(pickIcon([DEFAULT_VITAMIN_D, med({ icon: '🧸', status: 'archived' })])).toBe('🧸');
  });

  it('dose text joins amount and unit; a unit alone shows nothing', () => {
    expect(doseText({ dose: '400', doseUnit: 'יחב״ל' })).toBe('400 יחב״ל');
    expect(doseText({ dose: '', doseUnit: 'מ״ל' })).toBe('');
    expect(doseText({ dose: '5 מ״ל', doseUnit: '' })).toBe('5 מ״ל');
  });

  it('doses: vitamin D by its own type, others by id; deleted ones do not count', () => {
    const evs = [
      ev({ type: 'vitamin_d', start: '2026-11-14 08:00' }),
      ev({ type: 'medicine', detail: 'm1', start: '2026-11-14 09:00' }),
      ev({ type: 'medicine', detail: 'm1', start: '2026-11-14 10:00', deleted: true }),
    ];
    expect(dosesOf(DEFAULT_VITAMIN_D, evs)).toHaveLength(1);
    expect(dosesOf(med(), evs).map((e) => e.start)).toEqual(['2026-11-14 09:00']);
  });
});

describe('course progress', () => {
  const dose = (start: string) => ev({ type: 'medicine', detail: 'm1', start });

  it('no course: nothing to show', () => {
    expect(courseProgress(med(), [], NOW)).toBeNull();
  });

  it('by doses: counts every dose, done when the number is reached', () => {
    const m = med({ course: 'doses', courseCount: 3 });
    expect(courseProgress(m, [dose('2026-11-13 08:00'), dose('2026-11-13 20:00')], NOW)).toEqual({ text: 'מנה 2 מתוך 3', done: false });
    expect(courseProgress(m, [dose('2026-11-13 08:00'), dose('2026-11-13 20:00'), dose('2026-11-14 08:00')], NOW)?.done).toBe(true);
  });

  it('by days: counted from the first dose; done after the last day', () => {
    const m = med({ course: 'days', courseCount: 7 });
    expect(courseProgress(m, [], NOW)).toEqual({ text: '7 ימים, עוד לא התחיל', done: false });
    expect(courseProgress(m, [dose('2026-11-12 08:00')], NOW)).toEqual({ text: 'יום 3 מתוך 7', done: false });
    expect(courseProgress(m, [dose('2026-11-08 08:00')], NOW)).toEqual({ text: 'יום 7 מתוך 7', done: false }); // last day
    expect(courseProgress(m, [dose('2026-11-07 08:00')], NOW)).toEqual({ text: 'יום 7 מתוך 7', done: true });
  });

  it('until a date: the last day still counts', () => {
    expect(courseProgress(med({ course: 'until', courseUntil: '2026-11-14' }), [], NOW)).toEqual({ text: 'עד 14.11.26', done: false });
    expect(courseProgress(med({ course: 'until', courseUntil: '2026-11-13' }), [], NOW)?.done).toBe(true);
  });
});

describe('today', () => {
  const at = (start: string, detail = 'm1') => ev({ type: 'medicine', detail, start });

  it('once a day: missing until given today; yesterday does not count', () => {
    const m = med({ schedule: 'daily' });
    expect(medicineToday(m, [at('2026-11-13 08:00')], NOW)).toMatchObject({ count: 0, missing: true, nextAt: null });
    expect(medicineToday(m, [at('2026-11-14 08:00')], NOW)).toMatchObject({ count: 1, missing: false });
  });

  it('vitamin D counts its own events', () => {
    expect(medicineToday(DEFAULT_VITAMIN_D, [ev({ type: 'vitamin_d', start: '2026-11-14 08:00' })], NOW).missing).toBe(false);
  });

  it('X times a day: missing until the count is reached, but not while the minimum gap runs', () => {
    const m = med({ schedule: 'times', timesPerDay: 2, minGapHours: 8 });
    expect(medicineToday(m, [at('2026-11-14 03:00')], NOW)).toMatchObject({ count: 1, missing: true, nextAt: null }); // 03:00 + 8h has passed
  });

  it('X times a day with a gap still running: not missing yet, next allowed time given', () => {
    const m = med({ schedule: 'times', timesPerDay: 2, minGapHours: 8 });
    const r = medicineToday(m, [at('2026-11-14 10:00')], NOW);
    expect(r.missing).toBe(false);
    expect(r.nextAt).toBe(T('2026-11-14 18:00'));
    expect(medicineToday(m, [at('2026-11-14 01:00'), at('2026-11-14 10:00')], T('2026-11-14 20:00')).missing).toBe(false); // both given
  });

  it('every X hours: next allowed time after the last dose; missing once it has passed', () => {
    const m = med({ schedule: 'interval', everyHours: 8 });
    expect(medicineToday(m, [at('2026-11-14 06:00')], NOW)).toMatchObject({ missing: false, nextAt: T('2026-11-14 14:00') });
    expect(medicineToday(m, [at('2026-11-14 02:00')], NOW)).toMatchObject({ missing: true, nextAt: null });
    expect(medicineToday(m, [at('2026-11-13 23:00')], NOW).missing).toBe(true); // the gap counts across midnight
  });

  it('as needed: never missing; a gap gives a next allowed time', () => {
    const m = med({ schedule: 'prn', minGapHours: 6 });
    expect(medicineToday(m, [], NOW)).toMatchObject({ missing: false, nextAt: null });
    expect(medicineToday(m, [at('2026-11-14 09:00')], NOW).nextAt).toBe(T('2026-11-14 15:00'));
  });

  it('a finished course is never missing', () => {
    const m = med({ schedule: 'daily', course: 'until', courseUntil: '2026-11-13' });
    expect(medicineToday(m, [], NOW)).toMatchObject({ missing: false, course: { done: true } });
  });
});

describe('warnings before a dose (stage 3)', () => {
  const at = (start: string, user = 'Parent 2') => ev({ type: 'medicine', detail: 'm1', start, user });

  it('nothing to say for a first dose', () => {
    expect(doseWarnings(med({ schedule: 'daily' }), [], NOW)).toEqual([]);
    expect(doseWarnings(med({ schedule: 'prn', minGapHours: 4, maxPerDay: 4 }), [], NOW)).toEqual([]);
  });

  it('once a day already given (vitamin D too), with when', () => {
    expect(doseWarnings(med({ schedule: 'daily' }), [at('2026-11-14 08:10')], NOW)).toEqual(['כבר ניתן היום ב-8:10']);
    expect(doseWarnings(DEFAULT_VITAMIN_D, [ev({ type: 'vitamin_d', start: '2026-11-14 09:00', user: 'Parent 1' })], NOW)).toEqual(['כבר ניתן היום ב-9:00']);
  });

  it('X times a day reached; too early within the minimum gap', () => {
    const m = med({ schedule: 'times', timesPerDay: 2, minGapHours: 8 });
    expect(doseWarnings(m, [at('2026-11-14 01:00'), at('2026-11-14 10:00')], NOW)).toEqual([
      'כבר ניתנו היום 2 מתוך 2',
      'מוקדם מדי: הבאה מ-18:00',
    ]);
    expect(doseWarnings(m, [at('2026-11-14 01:00')], NOW)).toEqual([]); // one of two, and the gap has passed
  });

  it('every X hours: too early; as needed: daily maximum', () => {
    expect(doseWarnings(med({ schedule: 'interval', everyHours: 8 }), [at('2026-11-14 06:00')], NOW)).toEqual(['מוקדם מדי: הבאה מ-14:00']);
    const prn = med({ schedule: 'prn', maxPerDay: 2 });
    expect(doseWarnings(prn, [at('2026-11-14 01:00'), at('2026-11-14 05:00')], NOW)).toEqual(['הגיע למקסימום היומי (2)']);
    expect(doseWarnings(prn, [at('2026-11-13 20:00'), at('2026-11-14 05:00')], NOW)).toEqual([]); // the day runs midnight to midnight
  });

  it('the period of the medicine is over', () => {
    expect(doseWarnings(med({ schedule: 'prn', course: 'until', courseUntil: '2026-11-13' }), [], NOW)).toEqual(['משך מתן התרופה הסתיים (עד 13.11.26)']);
  });
});
