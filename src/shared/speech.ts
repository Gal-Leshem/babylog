import { clock, nextSide, oppositeSide } from './domain';
import { parseLocal } from './tz';
import type { BabyEvent } from './types';

const MIN = 60_000;

export function durationEn(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return 'less than a minute';
  const h = Math.floor(m / 60);
  const r = m % 60;
  const hp = h ? `${h} hour${h === 1 ? '' : 's'}` : '';
  const mp = r ? `${r} minute${r === 1 ? '' : 's'}` : '';
  return [hp, mp].filter(Boolean).join(' ');
}

export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The sentence Siri says after an event was logged. `all` must include the event itself. */
export function speechForLogged(e: BabyEvent, all: readonly BabyEvent[]): string {
  const t = clock(parseLocal(e.start));
  switch (e.type) {
    case 'feed': {
      const next = nextSide(all);
      return `Logged ${e.detail}, ${t}.${next ? ` Next: ${next}` : ''}`;
    }
    case 'diaper':
      return e.detail === 'wet'
        ? `Wet diaper logged, ${t}`
        : e.detail === 'poop'
          ? `Poop logged, ${t}`
          : `Full diaper logged, ${t}`;
    case 'vitamin_d':
      return 'Vitamin D logged for today';
    case 'medicine':
      return `Medicine logged, ${t}`;
    case 'sleep':
      return e.start ? `Asleep at ${t}` : 'Awake. Sleep length unknown';
  }
}

export function speechVitaminAgain(firstGiven: BabyEvent): string {
  return `Vitamin D logged again. Already given today at ${clock(parseLocal(firstGiven.start))}`;
}

export function speechAlreadyAsleep(open: BabyEvent): string {
  return `Already asleep since ${clock(parseLocal(open.start))}`;
}

export function speechAwake(sleepMinutes: number | null): string {
  return sleepMinutes === null ? 'Awake. Sleep length unknown' : `Awake. Slept ${durationEn(sleepMinutes)}`;
}

export function speechStatus(last: BabyEvent | undefined, nowEpoch: number): string {
  if (!last) return 'No feeds logged yet';
  const ago = capitalize(durationEn((nowEpoch - parseLocal(last.start)) / MIN));
  const next = oppositeSide(last.detail);
  return `${ago} ago, ${last.detail} side.${next ? ` Next: ${next}` : ''}`;
}

// ---------- Hebrew (owner: Siri on the other parent's phone speaks Hebrew) ----------

const SIDE_HE: Record<string, string> = { left: 'שמאל', right: 'ימין' };

/** "פחות מדקה", "דקה", "20 דקות", "שעה", "שעתיים", "3 שעות", "שעה ו-20 דקות", "שעתיים ודקה". */
export function durationHe(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return 'פחות מדקה';
  const h = Math.floor(m / 60);
  const r = m % 60;
  const hp = h === 0 ? '' : h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`;
  const mp = r === 0 ? '' : r === 1 ? 'דקה' : `${r} דקות`;
  if (!hp) return mp;
  if (!mp) return hp;
  return `${hp} ${/^\d/.test(mp) ? 'ו-' : 'ו'}${mp}`;
}

/** What Siri says, in one language. The server picks it from the request (`lang`) and the baby's sex in the settings. */
export interface Voice {
  logged(e: BabyEvent, all: readonly BabyEvent[]): string;
  vitaminAgain(firstGiven: BabyEvent): string;
  alreadyAsleep(open: BabyEvent): string;
  awake(sleepMinutes: number | null): string;
  status(last: BabyEvent | undefined, nowEpoch: number): string;
}

export const voiceEn: Voice = {
  logged: speechForLogged,
  vitaminAgain: speechVitaminAgain,
  alreadyAsleep: speechAlreadyAsleep,
  awake: speechAwake,
  status: speechStatus,
};

/** Hebrew sentences; words about the baby follow the sex chosen in Settings (missing = boy), as in the app. */
export function voiceHe(sex: 'boy' | 'girl' | undefined): Voice {
  const girl = sex === 'girl';
  const fellAsleep = girl ? 'נרדמה' : 'נרדם';
  const wokeUp = girl ? 'התעוררה' : 'התעורר';
  const slept = girl ? 'ישנה' : 'ישן';
  const at = (e: BabyEvent) => clock(parseLocal(e.start));
  return {
    logged(e, all) {
      const t = e.start ? at(e) : '';
      switch (e.type) {
        case 'feed': {
          const next = nextSide(all);
          return `נרשמה הנקה ${SIDE_HE[e.detail] ?? ''}, ${t}.${next ? ` הבאה: ${SIDE_HE[next]}` : ''}`;
        }
        case 'diaper':
          return e.detail === 'wet' ? `נרשם חיתול פיפי, ${t}` : e.detail === 'poop' ? `נרשם חיתול קקי, ${t}` : `נרשם חיתול פיפי וקקי, ${t}`;
        case 'vitamin_d':
          return 'נרשם ויטמין די להיום';
        case 'medicine':
          return `נרשמה תרופה, ${t}`;
        case 'sleep':
          return e.start ? `${fellAsleep} ב-${t}` : `${wokeUp}. אורך השינה לא ידוע`;
      }
    },
    vitaminAgain: (first) => `ויטמין די נרשם שוב. כבר ניתן היום ב-${at(first)}`,
    alreadyAsleep: (open) => `כבר ${girl ? 'מסומנת כישנה' : 'מסומן כישן'} מ-${at(open)}`,
    awake: (min) => (min === null ? `${wokeUp}. אורך השינה לא ידוע` : `${wokeUp}. ${slept} ${durationHe(min)}`),
    status(last, nowEpoch) {
      if (!last) return 'עוד לא נרשמו הנקות';
      const next = oppositeSide(last.detail);
      return `ההנקה האחרונה לפני ${durationHe((nowEpoch - parseLocal(last.start)) / MIN)}, צד ${SIDE_HE[last.detail] ?? ''}.${next ? ` הבאה: ${SIDE_HE[next]}` : ''}`;
    },
  };
}

/** The voice a request asks for: `lang: 'he'` gives Hebrew; anything else (Siri shortcuts made before) English. */
export const voiceFor = (lang: unknown, sex: () => 'boy' | 'girl' | undefined): Voice => (lang === 'he' ? voiceHe(sex()) : voiceEn);
