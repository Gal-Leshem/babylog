import { addDays, dayStart, formatLocal, localDate, parseLocal } from './tz';
import type { BabyEvent } from './types';

const MIN = 60_000;

export const live = (events: readonly BabyEvent[]): BabyEvent[] => events.filter((e) => !e.deleted);

/** The instant an event is positioned at: its start, or its end for an end-only sleep row. */
export function eventTime(e: BabyEvent): number {
  return parseLocal(e.start || e.end);
}

export const byTimeAsc = (a: BabyEvent, b: BabyEvent): number => eventTime(a) - eventTime(b);
export const byTimeDesc = (a: BabyEvent, b: BabyEvent): number => eventTime(b) - eventTime(a);

export function oppositeSide(side: string): 'left' | 'right' | null {
  return side === 'left' ? 'right' : side === 'right' ? 'left' : null;
}

// ---------- feeding ----------

export interface FeedGroup {
  start: number;
  events: BabyEvent[];
}

/**
 * Groups nursing presses into feedings: a press within `windowMin` minutes of the
 * previous press (any side) belongs to the same feeding.
 */
export function feedGroups(events: readonly BabyEvent[], windowMin: number): FeedGroup[] {
  const feeds = live(events)
    .filter((e) => e.type === 'feed' && e.start)
    .sort(byTimeAsc);
  const groups: FeedGroup[] = [];
  let lastPress = -Infinity;
  for (const f of feeds) {
    const t = parseLocal(f.start);
    const g = groups[groups.length - 1];
    if (g && t - lastPress <= windowMin * MIN) g.events.push(f);
    else groups.push({ start: t, events: [f] });
    lastPress = t;
  }
  return groups;
}

/** The latest feed press. Two presses in the same minute (sides switched quickly): the one entered later counts. */
export function lastFeed(events: readonly BabyEvent[]): BabyEvent | undefined {
  let best: BabyEvent | undefined;
  for (const e of live(events)) if (e.type === 'feed' && e.start && (!best || eventTime(e) >= eventTime(best))) best = e;
  return best;
}

/** (F18) The most recent bottle. */
export function lastBottle(events: readonly BabyEvent[]): BabyEvent | undefined {
  let best: BabyEvent | undefined;
  for (const e of live(events)) if (e.type === 'bottle' && e.start && (!best || eventTime(e) >= eventTime(best))) best = e;
  return best;
}

/** The recommended side for the next feeding: opposite of the most recent press. */
export function nextSide(events: readonly BabyEvent[]): 'left' | 'right' | null {
  const f = lastFeed(events);
  return f ? oppositeSide(f.detail) : null;
}

// ---------- sleep ----------

export function openSleep(events: readonly BabyEvent[]): BabyEvent | undefined {
  return live(events)
    .filter((e) => e.type === 'sleep' && e.start && !e.end)
    .sort(byTimeDesc)[0];
}

export type SleepState = { state: 'asleep'; since: number } | { state: 'awake'; since: number | null };

export function sleepState(events: readonly BabyEvent[]): SleepState {
  const open = openSleep(events);
  if (open) return { state: 'asleep', since: parseLocal(open.start) };
  let latestEnd: number | null = null;
  for (const e of live(events)) {
    if (e.type !== 'sleep' || !e.end) continue;
    const t = parseLocal(e.end);
    if (latestEnd === null || t > latestEnd) latestEnd = t;
  }
  return { state: 'awake', since: latestEnd };
}

/** A sleep open for longer than this is surely a forgotten wake-up, whatever the week looked like. */
export const FORGOTTEN_WAKE_MIN_MIN = 6 * 60;

/**
 * "Forgot to log the wake-up?" (owner): the open sleep has lasted longer than the longest finished sleep of the last 7 days
 * plus an hour, and at least 6 hours. Returns the open sleep then, otherwise null.
 */
export function forgottenWake(events: readonly BabyEvent[], nowEpoch: number): BabyEvent | null {
  const open = openSleep(events);
  if (!open) return null;
  const since = nowEpoch - 7 * 24 * 60 * MIN;
  let longest = 0;
  for (const e of live(events)) {
    if (e.type !== 'sleep' || !e.start || !e.end) continue;
    const s = parseLocal(e.start);
    const t = parseLocal(e.end);
    if (t >= since && t > s) longest = Math.max(longest, (t - s) / MIN);
  }
  const limit = Math.max(FORGOTTEN_WAKE_MIN_MIN, longest + 60);
  return (nowEpoch - parseLocal(open.start)) / MIN > limit ? open : null;
}

/** Another sleep that overlaps [from, to) (an open sleep lasts until now), or undefined. `exceptId`: the sleep being edited. */
export function overlappingSleep(events: readonly BabyEvent[], from: number, to: number, nowEpoch: number, exceptId?: string): BabyEvent | undefined {
  return live(events).find((e) => {
    if (e.type !== 'sleep' || e.id === exceptId || !e.start) return false;
    const s = parseLocal(e.start);
    const t = e.end ? parseLocal(e.end) : nowEpoch;
    return from < t && s < to;
  });
}

// ---------- vitamin D ----------

export function vitaminDOnDate(events: readonly BabyEvent[], date: string): BabyEvent | undefined {
  return live(events).find((e) => e.type === 'vitamin_d' && e.start.slice(0, 10) === date);
}

// ---------- daily summary ----------

/** The middle value (the mean of the two middle ones for an even count); null for none. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

export interface DailySummary {
  date: string;
  /** gapMin: the median gap between feeds that day (owner: a forgotten entry must not skew it, as a mean would) */
  feeds: { count: number; gapMin: number | null; left: number; right: number };
  diapers: { wet: number; poop: number; both: number };
  sleep: { totalMin: number; longestMin: number };
  vitaminD: boolean;
}

const inRange = (t: number, from: number, to: number) => t >= from && t < to;

export function dailySummary(
  events: readonly BabyEvent[],
  date: string,
  nowEpoch: number,
  mergeWindowMin: number,
): DailySummary {
  const from = dayStart(date);
  const to = dayStart(addDays(date, 1));
  const evs = live(events);

  const groups = feedGroups(evs, mergeWindowMin).filter((g) => inRange(g.start, from, to));
  const gaps: number[] = [];
  for (let i = 1; i < groups.length; i++) gaps.push((groups[i]!.start - groups[i - 1]!.start) / MIN);
  const dayFeeds = evs.filter((e) => e.type === 'feed' && e.start && inRange(parseLocal(e.start), from, to));

  const dayDiapers = evs.filter((e) => e.type === 'diaper' && e.start && inRange(parseLocal(e.start), from, to));

  let total = 0;
  let longest = 0;
  const limit = Math.min(to, nowEpoch);
  for (const e of evs) {
    if (e.type !== 'sleep' || !e.start) continue;
    const s = parseLocal(e.start);
    const end = e.end ? parseLocal(e.end) : nowEpoch;
    const a = Math.max(s, from);
    const b = Math.min(end, limit);
    if (b > a) {
      const mins = (b - a) / MIN;
      total += mins;
      longest = Math.max(longest, mins);
    }
  }

  return {
    date,
    feeds: {
      count: groups.length,
      gapMin: median(gaps),
      left: dayFeeds.filter((e) => e.detail === 'left').length,
      right: dayFeeds.filter((e) => e.detail === 'right').length,
    },
    diapers: {
      wet: dayDiapers.filter((e) => e.detail === 'wet').length,
      poop: dayDiapers.filter((e) => e.detail === 'poop').length,
      both: dayDiapers.filter((e) => e.detail === 'both').length,
    },
    sleep: { totalMin: Math.round(total), longestMin: Math.round(longest) },
    vitaminD: Boolean(vitaminDOnDate(evs, date)),
  };
}

// ---------- formatting ----------

/** Elapsed time as H:MM (e.g. 2:10). Negative values clamp to 0:00. */
export function elapsedHM(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MIN));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** 'H:mm' wall clock (24h, no leading zero on hours) for an instant, Israel time. */
export function clock(epochMs: number): string {
  const [h, m] = formatLocal(epochMs).slice(11).split(':');
  return `${Number(h)}:${m}`;
}

export function todayDate(nowEpoch: number): string {
  return localDate(nowEpoch);
}
