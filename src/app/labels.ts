import { eventTime } from '../shared/domain';
import { addDays, formatLocal, parseLocal } from '../shared/tz';
import type { BabyEvent, EventType } from '../shared/types';

/** The seven things a parent can record, as shown on buttons and in the add/edit form. */
export type Kind = 'feed_left' | 'feed_right' | 'wet' | 'poop' | 'both' | 'sleep' | 'vitamin_d';

export const KIND_LABEL: Record<Kind, string> = {
  feed_left: 'הנקה שמאל',
  feed_right: 'הנקה ימין',
  wet: 'פיפי',
  poop: 'קקי',
  both: 'פיפי + קקי',
  sleep: 'שינה',
  vitamin_d: 'ויטמין D',
};

export const KIND_ICON: Record<Kind, string> = {
  feed_left: '🤱',
  feed_right: '🤱',
  wet: '💧',
  poop: '💩',
  both: '💧💩',
  sleep: '🌙',
  vitamin_d: '☀️',
};

export const KINDS = Object.keys(KIND_LABEL) as Kind[];

export function kindOf(e: Pick<BabyEvent, 'type' | 'detail'>): Kind {
  if (e.type === 'feed') return e.detail === 'right' ? 'feed_right' : 'feed_left';
  if (e.type === 'diaper') return e.detail === 'poop' ? 'poop' : e.detail === 'both' ? 'both' : 'wet';
  return e.type === 'sleep' ? 'sleep' : 'vitamin_d';
}

export function fromKind(k: Kind): { type: EventType; detail: string } {
  switch (k) {
    case 'feed_left':
      return { type: 'feed', detail: 'left' };
    case 'feed_right':
      return { type: 'feed', detail: 'right' };
    case 'wet':
      return { type: 'diaper', detail: 'wet' };
    case 'poop':
      return { type: 'diaper', detail: 'poop' };
    case 'both':
      return { type: 'diaper', detail: 'both' };
    case 'sleep':
      return { type: 'sleep', detail: '' };
    case 'vitamin_d':
      return { type: 'vitamin_d', detail: '' };
  }
}

export const eventLabel = (e: BabyEvent): string => KIND_LABEL[kindOf(e)];
export const eventIcon = (e: BabyEvent): string => KIND_ICON[kindOf(e)];

export const FILTERS: { id: 'all' | EventType; label: string }[] = [
  { id: 'all', label: 'הכל' },
  { id: 'feed', label: 'הנקה' },
  { id: 'diaper', label: 'חיתולים' },
  { id: 'sleep', label: 'שינה' },
  { id: 'vitamin_d', label: 'ויטמין D' },
];

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** 'YYYY-MM-DD' -> '14 בנובמבר 2026' */
export function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ב${MONTHS[m - 1]} ${y}`;
}

/** 'YYYY-MM-DD' -> 'יום ראשון, 14 בנובמבר' */
export function dayHeading(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `יום ${WEEKDAYS[wd]}, ${d} ב${MONTHS[m - 1]}`;
}

/** Relative name for a date: היום / אתמול / otherwise the heading. */
export function dayName(date: string, today: string): string {
  if (date === today) return 'היום';
  if (date === addDays(today, -1)) return 'אתמול';
  return dayHeading(date);
}

/** Minutes -> H:MM */
export function hm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

export const timeOf = (local: string): string => local.slice(11);

/** Shown time of an event row: start, or start–end for a finished sleep. */
export function eventTimeText(e: BabyEvent): string {
  if (e.type === 'sleep') {
    if (e.start && e.end) return `${timeOf(e.start)}–${timeOf(e.end)}`;
    if (e.start) return `${timeOf(e.start)}–…`;
    return `…–${timeOf(e.end)}`;
  }
  return timeOf(e.start);
}

export function sleepDurationText(e: BabyEvent): string {
  if (!e.start || !e.end) return '';
  return hm((parseLocal(e.end) - parseLocal(e.start)) / 60_000);
}

/** True when the event was entered well after it happened. */
export function isBackfilled(e: BabyEvent): boolean {
  if (!e.created) return false;
  const at = eventTime(e);
  return !Number.isNaN(at) && parseLocal(e.created) - at > 10 * 60_000;
}

export const nowLocal = (now = Date.now()): string => formatLocal(now);

const ERRORS: Record<string, string> = {
  invalid_event: 'הנתונים לא תקינים',
  not_found: 'האירוע לא נמצא',
  sleep_already_open: 'כבר יש שינה פתוחה — סגרו אותה קודם',
  bad_request: 'בקשה לא תקינה',
  unauthorized: 'המפתח לא תקין',
};

const DETAILS: [RegExp, string][] = [
  [/end is before start/, 'שעת הסיום קודמת להתחלה'],
  [/start is in the future/, 'השעה בעתיד'],
  [/end is in the future/, 'שעת הסיום בעתיד'],
  [/not a valid time/, 'השעה לא קיימת'],
  [/note too long/, 'ההערה ארוכה מדי'],
];

export function errorText(error: string, detail?: string): string {
  const hit = detail ? DETAILS.find(([re]) => re.test(detail)) : undefined;
  return hit ? hit[1] : (ERRORS[error] ?? 'לא נשמר');
}
