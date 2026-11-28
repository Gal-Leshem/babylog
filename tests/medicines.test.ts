import { describe, expect, it } from 'vitest';
import { DEFAULT_VITAMIN_D, type Medicine, allDoneToday, courseProgress, endsCourse, doneToday, doseText, doseWarnings, dosesOf, dosesPerDay, medicineToday, pickIcon, todayText, withVitaminD } from '../src/shared/medicines';
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

describe('today in words (tile and window)', () => {
  it('once a day: given or not yet', () => {
    expect(todayText(med({ schedule: 'daily' }), 0)).toBe('עדיין לא');
    expect(todayText(DEFAULT_VITAMIN_D, 1)).toBe('ניתן היום');
  });
  it('several a day: how many of how many; every X hours counts 24/X', () => {
    expect(todayText(med({ schedule: 'times', timesPerDay: 2 }), 1)).toBe('1 מתוך 2');
    expect(todayText(med({ schedule: 'interval', everyHours: 8 }), 0)).toBe('0 מתוך 3');
    expect(dosesPerDay(med({ schedule: 'interval', everyHours: 5 }))).toBe(4);
    expect(dosesPerDay(med({ schedule: 'interval', everyHours: 36 }))).toBe(1);
  });
  it('as needed: just how many today', () => {
    expect(todayText(med({ schedule: 'prn' }), 0)).toBe('עדיין לא');
    expect(todayText(med({ schedule: 'prn', maxPerDay: 4 }), 2)).toBe('2 היום');
  });
});

// Owner: the Home button says when everything due today is given.
describe('done for today', () => {
  const dose = (detail: string, start: string) => (detail === 'vitamin_d' ? ev({ type: 'vitamin_d', start }) : ev({ type: 'medicine', detail, start }));
  const twice = med({ id: 'm1', schedule: 'times', timesPerDay: 2 });
  const prn = med({ id: 'm2', schedule: 'prn' });
  const every8 = med({ id: 'm3', schedule: 'interval', everyHours: 8 });

  it('once a day: given today; yesterday does not count', () => {
    expect(doneToday(DEFAULT_VITAMIN_D, [dose('vitamin_d', '2026-11-13 09:00')], NOW)).toBe(false);
    expect(doneToday(DEFAULT_VITAMIN_D, [dose('vitamin_d', '2026-11-14 09:00')], NOW)).toBe(true);
  });
  it('X times a day and every X hours: only when the daily amount is reached; as needed: never', () => {
    expect(doneToday(twice, [dose('m1', '2026-11-14 08:00')], NOW)).toBe(false);
    expect(doneToday(twice, [dose('m1', '2026-11-14 08:00'), dose('m1', '2026-11-14 11:00')], NOW)).toBe(true);
    expect(doneToday(every8, [dose('m3', '2026-11-14 01:00'), dose('m3', '2026-11-14 09:00')], NOW)).toBe(false);
    expect(doneToday(prn, [dose('m2', '2026-11-14 08:00')], NOW)).toBe(false);
  });
  it('all of them: every medicine with a daily amount, as needed ones aside; none with a daily amount: never', () => {
    const given = [dose('vitamin_d', '2026-11-14 07:00'), dose('m1', '2026-11-14 08:00')];
    expect(allDoneToday([DEFAULT_VITAMIN_D, twice, prn], given, NOW)).toBe(false);
    expect(allDoneToday([DEFAULT_VITAMIN_D, twice, prn], [...given, dose('m1', '2026-11-14 11:00')], NOW)).toBe(true);
    expect(allDoneToday([prn], [dose('m2', '2026-11-14 08:00')], NOW)).toBe(false);
    expect(allDoneToday([], [], NOW)).toBe(false);
  });
});

// Owner (feedback #6): after the dose that ends a course, offer to archive the medicine.
describe('endsCourse', () => {
  const d = (start: string) => ev({ type: 'medicine', detail: 'm1', start });
  it('X doses: true exactly at the last one', () => {
    const m = med({ schedule: 'daily', course: 'doses', courseCount: 3 });
    expect(endsCourse(m, [d('2026-11-12 08:00'), d('2026-11-13 08:00')], NOW)).toBe(false);
    expect(endsCourse(m, [d('2026-11-12 08:00'), d('2026-11-13 08:00'), d('2026-11-14 08:00')], NOW)).toBe(true);
    expect(endsCourse(m, [d('2026-11-11 08:00'), d('2026-11-12 08:00'), d('2026-11-13 08:00'), d('2026-11-14 08:00')], NOW), 'given after the end').toBe(false);
  });
  it('X days or until a date: on the last day, when the day\'s amount is complete', () => {
    const days = med({ schedule: 'times', timesPerDay: 2, course: 'days', courseCount: 2 });
    expect(endsCourse(days, [d('2026-11-13 08:00'), d('2026-11-13 20:00'), d('2026-11-14 08:00')], NOW), 'one of two on the last day').toBe(false);
    expect(endsCourse(days, [d('2026-11-13 08:00'), d('2026-11-13 20:00'), d('2026-11-14 08:00'), d('2026-11-14 11:00')], NOW)).toBe(true);
    expect(endsCourse(days, [d('2026-11-14 08:00'), d('2026-11-14 11:00')], NOW), 'the first of two days').toBe(false);
    const until = med({ schedule: 'daily', course: 'until', courseUntil: '2026-11-14' });
    expect(endsCourse(until, [d('2026-11-14 08:00')], NOW)).toBe(true);
    expect(endsCourse(until, [d('2026-11-14 08:00')], T('2026-11-13 12:00')), 'before the last day').toBe(false);
  });
  it('no course, or as needed for days or a date: never a known last dose; as needed for X doses: the Xth', () => {
    expect(endsCourse(med({ schedule: 'daily' }), [d('2026-11-14 08:00')], NOW)).toBe(false);
    expect(endsCourse(med({ schedule: 'prn', course: 'days', courseCount: 1 }), [d('2026-11-14 08:00')], NOW)).toBe(false);
    expect(endsCourse(med({ schedule: 'prn', course: 'doses', courseCount: 1 }), [d('2026-11-14 08:00')], NOW)).toBe(true);
  });
  // (review) every 5 hours fits five doses a day (00, 05, 10, 15, 20), not floor(24 / 5) = 4
  it('every X hours: the last day ends when no further dose fits before midnight', () => {
    const m = med({ schedule: 'interval', everyHours: 5, course: 'until', courseUntil: '2026-11-14' });
    const day = ['00:00', '05:00', '10:00', '15:00'].map((t) => d(`2026-11-14 ${t}`));
    expect(endsCourse(m, day, T('2026-11-14 15:00')), 'a dose at 20:00 still fits').toBe(false);
    expect(endsCourse(m, [...day, d('2026-11-14 20:00')], T('2026-11-14 20:00'))).toBe(true);
    const sixteen = med({ schedule: 'interval', everyHours: 16, course: 'until', courseUntil: '2026-11-14' });
    expect(endsCourse(sixteen, [d('2026-11-14 01:00')], T('2026-11-14 01:00')), 'a second dose at 17:00 still fits').toBe(false);
    expect(endsCourse(sixteen, [d('2026-11-14 01:00'), d('2026-11-14 17:00')], T('2026-11-14 17:00'))).toBe(true);
  });
});
