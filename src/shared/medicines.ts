/**
 * Medicines besides vitamin D (F7). Vitamin D stays built in (event type `vitamin_d`); every other medicine is defined once in
 * Settings and each dose is an event of type `medicine` whose detail is the medicine's id.
 * The app gives no medical advice: every number here is what the parents entered, and every field may stay empty.
 */

export type Schedule = 'daily' | 'times' | 'interval' | 'prn';
export type CourseKind = 'none' | 'doses' | 'days';
export type MedicineStatus = 'active' | 'archived';

export const SCHEDULES: readonly Schedule[] = ['daily', 'times', 'interval', 'prn'];
export const COURSES: readonly CourseKind[] = ['none', 'doses', 'days'];

export interface Medicine {
  id: string;
  /** 1-30 characters */
  name: string;
  /** free text such as "0.5 מ״ל"; may be empty */
  dose: string;
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
  /** optional course length, counted from the first dose given */
  course: CourseKind;
  courseCount: number;
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
  const schedule = o.schedule as Schedule;
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
  if (course !== 'none') {
    const c = num('courseCount');
    if (!isNum(c) || !Number.isInteger(c) || c < 1 || c > 365) return { ok: false, error: 'course length must be 1-365' };
    courseCount = c;
  }
  return { ok: true, medicine: { id, name, dose, schedule, timesPerDay, everyHours, minGapHours, maxPerDay, course, courseCount, status } };
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

export function courseText(m: Pick<Medicine, 'course' | 'courseCount'>): string {
  if (m.course === 'doses') return `${m.courseCount} מנות`;
  if (m.course === 'days') return m.courseCount === 1 ? 'יום אחד' : m.courseCount === 2 ? 'יומיים' : `${m.courseCount} ימים`;
  return '';
}
