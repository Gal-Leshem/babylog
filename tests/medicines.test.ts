import { describe, expect, it } from 'vitest';
import { DEFAULT_VITAMIN_D, type Medicine, courseProgress, doseText, dosesOf, pickIcon, withVitaminD } from '../src/shared/medicines';
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
