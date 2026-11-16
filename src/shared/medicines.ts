/**
 * Medicines (F7). Every medicine is defined once in Settings. Vitamin D is one of them with the reserved id `vitamin_d`: present by
 * default (active, ☀️), may be archived but never removed, and its doses keep their own event type `vitamin_d`. Doses of every other
 * medicine are events of type `medicine` whose detail is the medicine's id.
 * The app gives no medical advice: every number here is what the parents entered, and every field may stay empty.
 */
import { live } from './domain';
import { addDays, formatLocal, isDateString, localDate, parseLocal } from './tz';
import type { BabyEvent } from './types';

export const VITAMIN_D_ID = 'vitamin_d';

/** Dose units offered on a wheel (like the phone's own health app). */
export const DOSE_UNITS = ['מ״ל', 'מ״ג', 'מק״ג', 'טיפות', 'יחב״ל', 'כדור', 'כמוסה', 'פתילה', 'שקית', 'כפית', 'מנה', 'לחיצה'] as const;
/** Cheerful icons first, then standard ones for those who prefer them. */
export const CHEERFUL_ICONS = ['☀️', '🧸', '🍓', '🍊', '🫐', '🍋', '🌸', '🌼', '⭐', '🌈', '🐣', '🦄', '🎈', '🍀'] as const;
export const STANDARD_ICONS = ['💊', '🧴', '🥄', '🩹', '🌡️'] as const;
/** The Home button's icon when more than three medicines are active. */
export const GENERIC_ICON = '🧸';

export type Schedule = 'daily' | 'times' | 'interval' | 'prn';
export type CourseKind = 'none' | 'doses' | 'days' | 'until';
export type MedicineStatus = 'active' | 'archived';

export const SCHEDULES: readonly Schedule[] = ['daily', 'times', 'interval', 'prn'];
export const COURSES: readonly CourseKind[] = ['none', 'doses', 'days', 'until'];

export interface Medicine {
  id: string;
  /** 1-30 characters */
  name: string;
  /** an emoji shown with the medicine everywhere */
  icon: string;
  /** the amount, e.g. "0.5" or "400" (free text up to 40 characters; may be empty) */
  dose: string;
  /** one of DOSE_UNITS, or empty */
  doseUnit: string;
  /** daily = once a day; times = X times a day; interval = every X hours; prn = as needed */
  schedule: Schedule;
  /** schedule 'times': doses per day (2-12); otherwise 0 */
  timesPerDay: number;
  /** schedule 'interval': hours between doses (0.25-72); otherwise 0 */
  everyHours: number;
  /** schedules 'times' and 'prn': optional minimum hours between doses (0 = none) */
  minGapHours: number;
  /** schedule 'prn': optional maximum doses per day, midnight to midnight (0 = none) */
  maxPerDay: number;
  /** optional course: X doses or X days counted from the first dose given, or until a date (inclusive) */
  course: CourseKind;
  courseCount: number;
  /** course 'until': the last day, YYYY-MM-DD; otherwise empty */
  courseUntil: string;
  status: MedicineStatus;
  /** when it was first saved (set by the server) */
  created: string;
}

/** What a client sends to save one medicine: the medicine, or a removal (allowed only before any dose was logged). */
export type MedicineChange = (Omit<Medicine, 'created'> & { remove?: false }) | { id: string; remove: true };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const hoursOk = (v: number, max: number) => v > 0 && v <= max && Math.abs(v * 4 - Math.round(v * 4)) < 1e-9; // quarter hours

/**
 * Checks one medicine as sent by a client and returns it with fields that do not belong to its schedule cleared,
 * or a Hebrew-free error string (the app maps errors to its own wording).
 */
export function normalizeMedicine(raw: unknown): { ok: true; medicine: Omit<Medicine, 'created'> } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'medicine must be an object' };
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  if (!id || id.length > 64) return { ok: false, error: 'medicine id missing' };
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name || name.length > 30) return { ok: false, error: 'medicine name must be 1-30 characters' };
  const dose = typeof o.dose === 'string' ? o.dose.trim() : '';
  if (dose.length > 40) return { ok: false, error: 'dose is too long' };
  const doseUnit = typeof o.doseUnit === 'string' ? o.doseUnit : '';
  if (doseUnit !== '' && !(DOSE_UNITS as readonly string[]).includes(doseUnit)) return { ok: false, error: 'unknown dose unit' };
  const icon = typeof o.icon === 'string' && o.icon.trim() ? o.icon.trim() : id === VITAMIN_D_ID ? '☀️' : '💊';
  if (icon.length > 8) return { ok: false, error: 'icon is too long' };
  // vitamin D is given once a day
  const schedule = (id === VITAMIN_D_ID ? 'daily' : o.schedule) as Schedule;
  if (!SCHEDULES.includes(schedule)) return { ok: false, error: 'unknown schedule' };
  const course = (o.course ?? 'none') as CourseKind;
  if (!COURSES.includes(course)) return { ok: false, error: 'unknown course' };
  const status = (o.status ?? 'active') as MedicineStatus;
  if (status !== 'active' && status !== 'archived') return { ok: false, error: 'unknown status' };
  const num = (k: string) => (o[k] === undefined || o[k] === null || o[k] === '' ? 0 : o[k]);

  let timesPerDay = 0;
  let everyHours = 0;
  let minGapHours = 0;
  let maxPerDay = 0;
  if (schedule === 'times') {
    const t = num('timesPerDay');
    if (!isNum(t) || !Number.isInteger(t) || t < 2 || t > 12) return { ok: false, error: 'times per day must be 2-12' };
    timesPerDay = t;
  }
  if (schedule === 'interval') {
    const h = num('everyHours');
    if (!isNum(h) || !hoursOk(h, 72)) return { ok: false, error: 'every X hours must be between a quarter hour and 72 hours' };
    everyHours = h;
  }
  if (schedule === 'times' || schedule === 'prn') {
    const g = num('minGapHours');
    if (!isNum(g) || (g !== 0 && !hoursOk(g, 72))) return { ok: false, error: 'minimum gap must be empty or up to 72 hours' };
    minGapHours = g;
  }
  if (schedule === 'prn') {
    const m = num('maxPerDay');
    if (!isNum(m) || !Number.isInteger(m) || m < 0 || m > 24) return { ok: false, error: 'maximum per day must be empty or 1-24' };
    maxPerDay = m;
  }
  let courseCount = 0;
  let courseUntil = '';
  if (course === 'until') {
    courseUntil = typeof o.courseUntil === 'string' ? o.courseUntil : '';
    if (!isDateString(courseUntil)) return { ok: false, error: 'course end date missing' };
  } else if (course !== 'none') {
    const c = num('courseCount');
    if (!isNum(c) || !Number.isInteger(c) || c < 1 || c > 365) return { ok: false, error: 'course length must be 1-365' };
    courseCount = c;
  }
  return {
    ok: true,
    medicine: { id, name, icon, dose, doseUnit, schedule, timesPerDay, everyHours, minGapHours, maxPerDay, course, courseCount, courseUntil, status },
  };
}

const hoursText = (h: number) => {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  if (min === 0) return whole === 1 ? 'שעה' : whole === 2 ? 'שעתיים' : `${whole} שעות`;
  return `${whole}:${String(min).padStart(2, '0')} שעות`;
};

/** One line describing the schedule, e.g. "פעמיים ביום · מרווח של לפחות 8 שעות". */
export function scheduleText(m: Pick<Medicine, 'schedule' | 'timesPerDay' | 'everyHours' | 'minGapHours' | 'maxPerDay'>): string {
  const gap = m.minGapHours > 0 ? ` · מרווח של לפחות ${hoursText(m.minGapHours)}` : '';
  switch (m.schedule) {
    case 'daily':
      return 'פעם ביום';
    case 'times':
      return `${m.timesPerDay === 2 ? 'פעמיים' : `${m.timesPerDay} פעמים`} ביום${gap}`;
    case 'interval':
      return `כל ${hoursText(m.everyHours)}`;
    case 'prn':
      return `לפי הצורך${gap}${m.maxPerDay > 0 ? ` · עד ${m.maxPerDay} ביום` : ''}`;
  }
}

const shortDate = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.${d.slice(2, 4)}`;

export function doseText(m: Pick<Medicine, 'dose' | 'doseUnit'>): string {
  return [m.dose, m.dose ? m.doseUnit : ''].filter(Boolean).join(' ');
}

export function courseText(m: Pick<Medicine, 'course' | 'courseCount' | 'courseUntil'>): string {
  if (m.course === 'until') return `עד ${shortDate(m.courseUntil)}`;
  if (m.course === 'doses') return `${m.courseCount} מנות`;
  if (m.course === 'days') return m.courseCount === 1 ? 'יום אחד' : m.courseCount === 2 ? 'יומיים' : `${m.courseCount} ימים`;
  return '';
}

/** Vitamin D as it is before anyone edited it: active, once a day, ☀️. */
export const DEFAULT_VITAMIN_D: Medicine = {
  id: VITAMIN_D_ID,
  name: 'ויטמין D',
  icon: '☀️',
  dose: '',
  doseUnit: '',
  schedule: 'daily',
  timesPerDay: 0,
  everyHours: 0,
  minGapHours: 0,
  maxPerDay: 0,
  course: 'none',
  courseCount: 0,
  courseUntil: '',
  status: 'active',
  created: '',
};

/** The list with vitamin D first (added with its defaults when the sheet has no row for it yet). */
export function withVitaminD(list: readonly Medicine[]): Medicine[] {
  const vit = list.find((m) => m.id === VITAMIN_D_ID) ?? DEFAULT_VITAMIN_D;
  return [{ ...vit }, ...list.filter((m) => m.id !== VITAMIN_D_ID).map((m) => ({ ...m }))];
}

/** An icon no other active medicine uses (cheerful ones first; ☀️ stays vitamin D's). */
export function pickIcon(meds: readonly Medicine[]): string {
  const used = new Set(meds.filter((m) => m.status === 'active').map((m) => m.icon));
  return [...CHEERFUL_ICONS.slice(1), ...STANDARD_ICONS].find((i) => !used.has(i)) ?? '💊';
}

/** The doses of a medicine, oldest first (vitamin D keeps its own event type). */
export function dosesOf(m: Pick<Medicine, 'id'>, events: readonly BabyEvent[]): BabyEvent[] {
  return live(events)
    .filter((e) => (m.id === VITAMIN_D_ID ? e.type === 'vitamin_d' : e.type === 'medicine' && e.detail === m.id) && e.start)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

export interface CourseProgress {
  /** e.g. "מנה 5 מתוך 14", "יום 3 מתוך 7", "עד 15.8.27" */
  text: string;
  /** the course is over: offer to archive or extend */
  done: boolean;
}

/** Where a course stands. Doses and days count from the first dose given; "until" ends after its last day. */
export function courseProgress(m: Medicine, events: readonly BabyEvent[], nowEpoch: number): CourseProgress | null {
  if (m.course === 'none') return null;
  const today = localDate(nowEpoch);
  if (m.course === 'until') return { text: `עד ${shortDate(m.courseUntil)}`, done: today > m.courseUntil };
  const doses = dosesOf(m, events);
  if (m.course === 'doses') return { text: `מנה ${doses.length} מתוך ${m.courseCount}`, done: doses.length >= m.courseCount };
  if (doses.length === 0) return { text: `${m.courseCount} ימים, עוד לא התחיל`, done: false };
  const first = doses[0]!.start.slice(0, 10);
  const last = addDays(first, m.courseCount - 1);
  let day = 1;
  while (addDays(first, day) <= today && day <= m.courseCount) day++;
  return { text: `יום ${Math.min(day, m.courseCount)} מתוך ${m.courseCount}`, done: today > last };
}

export interface MedicineToday {
  /** doses given today (midnight to midnight) */
  count: number;
  /** the latest dose, any day */
  last: BabyEvent | undefined;
  /** something is still owed today: once a day not given, X times a day not reached, every X hours and the time has come */
  missing: boolean;
  /** too early until then (every X hours, or a minimum gap), epoch ms; null when nothing is pending */
  nextAt: number | null;
  course: CourseProgress | null;
}

const HOUR = 3_600_000;

/** Where a medicine stands today. Clock times are never used: only what was given, the gap and the daily count. */
export function medicineToday(m: Medicine, events: readonly BabyEvent[], nowEpoch: number): MedicineToday {
  const doses = dosesOf(m, events);
  const today = localDate(nowEpoch);
  const count = doses.filter((e) => e.start.slice(0, 10) === today).length;
  const last = doses[doses.length - 1];
  const course = courseProgress(m, events, nowEpoch);
  const gapHours = m.schedule === 'interval' ? m.everyHours : m.schedule === 'times' || m.schedule === 'prn' ? m.minGapHours : 0;
  const lastAt = last ? parseLocal(last.start) : NaN;
  const nextAt = gapHours > 0 && !Number.isNaN(lastAt) && lastAt + gapHours * HOUR > nowEpoch ? lastAt + gapHours * HOUR : null;
  let missing = false;
  if (!course?.done) {
    if (m.schedule === 'daily') missing = count === 0;
    else if (m.schedule === 'times') missing = count < m.timesPerDay && nextAt === null;
    else if (m.schedule === 'interval') missing = nextAt === null;
  }
  return { count, last, missing, nextAt, course };
}

const hm = (epoch: number) => {
  const s = formatLocal(epoch).slice(11);
  return s.startsWith('0') ? s.slice(1) : s;
};

/**
 * Why giving a dose now needs a second look (empty: nothing to say). Short Hebrew sentences without names (who gave the last dose is
 * shown separately, isolated, so a name cannot reorder the sentence). Only what the parents set is used: once a day already given,
 * X times a day reached, the as-needed maximum reached, too early for the gap, or the period of the medicine is over.
 * The app never blocks: the screen shows these and asks for a confirmation.
 */
export function doseWarnings(m: Medicine, events: readonly BabyEvent[], nowEpoch: number): string[] {
  const t = medicineToday(m, events, nowEpoch);
  const out: string[] = [];
  if (t.course?.done) out.push(`משך מתן התרופה הסתיים (${t.course.text})`);
  if (m.schedule === 'daily' && t.count >= 1 && t.last) out.push(`כבר ניתן היום ב-${hm(parseLocal(t.last.start))}`);
  if (m.schedule === 'times' && t.count >= m.timesPerDay) out.push(`כבר ניתנו היום ${t.count} מתוך ${m.timesPerDay}`);
  if (m.schedule === 'prn' && m.maxPerDay > 0 && t.count >= m.maxPerDay) out.push(`הגיע למקסימום היומי (${m.maxPerDay})`);
  if (t.nextAt !== null) out.push(`מוקדם מדי: הבאה מ-${hm(t.nextAt)}`);
  return out;
}
