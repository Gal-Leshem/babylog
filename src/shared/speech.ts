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
