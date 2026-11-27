/**
 * Pattern insights for the "תובנות" view: pure calculations over the last 7 full days (today is partial and left out).
 * Rules (from research on how trackers present insights, see docs/BACKLOG.md F8):
 * - medians and the middle half (25th-75th percentile), never means: one forgotten entry ruins a mean;
 * - an insight is returned only when there is enough data (otherwise null; the screen shows nothing rather than a guess);
 * - a "after a feed" pattern is returned only when it is clearly stronger than chance (diapers happen all day long).
 */
import { feedGroups, live } from './domain';
import { addDays, dayStart, localDate, localHour, parseLocal } from './tz';
import type { BabyEvent } from './types';

const MIN = 60_000;
export const INSIGHT_DAYS = 7;
/** Night for statistics: 19:00 to 07:00 (independent of the app's night theme). */
export const NIGHT_FROM_HOUR = 19;
export const NIGHT_TO_HOUR = 7;
/** A gap longer than this is most likely a feed that was not logged. */
export const MAX_FEED_GAP_MIN = 6 * 60;
/** "After a feed" means within this many minutes of the feed's start. */
export const AFTER_FEED_MIN = 60;
/** A long sleep stretch (the owner: even 3 hours is worth knowing about). */
export const LONG_STRETCH_MIN = 3 * 60;

export const MIN_GAPS = 20;
export const MIN_GAPS_PART = 8;
export const MIN_POOPS = 8;
export const MIN_FEEDS = 15;
export const MIN_NIGHTS = 4;
/** How much more often than chance a pattern must happen, in percentage points. */
export const MIN_LIFT = 0.2;

export interface Spread {
  /** median, 25th and 75th percentile, in minutes, rounded to 5 */
  median: number;
  low: number;
  high: number;
  n: number;
}

export interface FeedGapInsight {
  all: Spread;
  day: Spread | null;
  night: Spread | null;
}

export interface AfterFeedInsight {
  /** how many of `total` happened within AFTER_FEED_MIN of a feed's start */
  hits: number;
  total: number;
  /** median minutes from the feed's start, rounded to 5 */
  lagMin: number;
}

export interface NightSleepInsight {
  nights: number;
  longest: Spread;
  /** usual start of the longest stretch, minutes after midnight (may be >= 1440 for after midnight), middle half, rounded to 15 */
  startLow: number;
  startHigh: number;
  /** stretches of LONG_STRETCH_MIN or more: median per night, and in how many nights there was at least one / at least two */
  longPerNight: number;
  nightsWithLong: number;
  nightsWithTwoLong: number;
  /** the most recent complete night: lengths of its long stretches (or just its longest if none is long), minutes, longest first */
  lastNight: number[];
}

/** How much data an insight has and needs (owner, F16: a question turns on by itself once `have` reaches `need`). */
export interface Progress {
  have: number;
  need: number;
}

export interface Insights {
  from: string;
  to: string;
  feedGaps: FeedGapInsight | null;
  poopAfterFeed: AfterFeedInsight | null;
  diaperAfterFeed: AfterFeedInsight | null;
  nightSleep: NightSleepInsight | null;
  /** Enough data but still null means "no clear pattern" (the after-a-feed insights); not enough means not ready yet. */
  progress: { feedGaps: Progress; poopAfterFeed: Progress; diaperAfterFeed: Progress; nightSleep: Progress };
}

// ---------- small statistics ----------

/** Linear-interpolated quantile of sorted values. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export function spread(values: readonly number[], step = 5): Spread {
  const s = [...values].sort((a, b) => a - b);
  return { median: roundTo(quantile(s, 0.5), step), low: roundTo(quantile(s, 0.25), step), high: roundTo(quantile(s, 0.75), step), n: s.length };
}

export const isNightHour = (h: number) => h >= NIGHT_FROM_HOUR || h < NIGHT_TO_HOUR;

// ---------- the insights ----------

/** The window: the 7 full days before today, midnight to midnight, Israel time. */
export function insightWindow(nowEpoch: number): { from: string; to: string; lo: number; hi: number } {
  const today = localDate(nowEpoch);
  const from = addDays(today, -INSIGHT_DAYS);
  const to = addDays(today, -1);
  return { from, to, lo: dayStart(from), hi: dayStart(today) };
}

export function feedGaps(events: readonly BabyEvent[], lo: number, hi: number, mergeWindowMin: number): { all: number[]; day: number[]; night: number[] } {
  const starts = feedGroups(events, mergeWindowMin)
    .map((g) => g.start)
    .filter((t) => t >= lo && t < hi);
  const all: number[] = [];
  const day: number[] = [];
  const night: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    const gap = (starts[i]! - starts[i - 1]!) / MIN;
    if (gap > MAX_FEED_GAP_MIN) continue;
    all.push(gap);
    (isNightHour(localHour(starts[i - 1]!)) ? night : day).push(gap);
  }
  return { all, day, night };
}

export function feedGapInsight(events: readonly BabyEvent[], lo: number, hi: number, mergeWindowMin: number): FeedGapInsight | null {
  const { all, day, night } = feedGaps(events, lo, hi, mergeWindowMin);
  if (all.length < MIN_GAPS) return null;
  return {
    all: spread(all),
    day: day.length >= MIN_GAPS_PART ? spread(day) : null,
    night: night.length >= MIN_GAPS_PART ? spread(night) : null,
  };
}

/** Share of the window's time that lies within AFTER_FEED_MIN after some feed start: the chance level for "after a feed". */
function afterFeedCoverage(feedStarts: readonly number[], lo: number, hi: number): number {
  let covered = 0;
  let reach = lo;
  for (const s of feedStarts) {
    const a = Math.max(s, reach, lo);
    const b = Math.min(s + AFTER_FEED_MIN * MIN, hi);
    if (b > a) covered += b - a;
    reach = Math.max(reach, s + AFTER_FEED_MIN * MIN);
  }
  return hi > lo ? covered / (hi - lo) : 0;
}

/**
 * Poop (or poop + pee) diapers: how many came within an hour of a feed's start, and the usual delay.
 * Chance level: the share of the day that lies within an hour after a feed.
 */
export const poopTimes = (events: readonly BabyEvent[], lo: number, hi: number): number[] =>
  live(events)
    .filter((e) => e.type === 'diaper' && (e.detail === 'poop' || e.detail === 'both') && e.start)
    .map((e) => parseLocal(e.start))
    .filter((t) => t >= lo && t < hi);

export function poopAfterFeedInsight(events: readonly BabyEvent[], lo: number, hi: number, mergeWindowMin: number): AfterFeedInsight | null {
  const feeds = feedGroups(events, mergeWindowMin)
    .map((g) => g.start)
    .filter((t) => t >= lo - AFTER_FEED_MIN * MIN && t < hi);
  const poops = poopTimes(events, lo, hi);
  if (poops.length < MIN_POOPS || feeds.length === 0) return null;
  const lags: number[] = [];
  for (const p of poops) {
    let prev: number | undefined;
    for (const f of feeds) if (f <= p) prev = f;
    if (prev !== undefined && p - prev <= AFTER_FEED_MIN * MIN) lags.push((p - prev) / MIN);
  }
  const chance = afterFeedCoverage(feeds, lo, hi);
  if (lags.length / poops.length < chance + MIN_LIFT) return null;
  return { hits: lags.length, total: poops.length, lagMin: spread(lags).median };
}

/**
 * Feeds followed by a diaper change (any kind) within an hour: how many, and the usual delay to the first change.
 * Chance level: how often a random hour of those days contains a diaper change (sampled every 5 minutes).
 */
const feedsForDiapers = (events: readonly BabyEvent[], lo: number, hi: number, mergeWindowMin: number): number[] =>
  feedGroups(events, mergeWindowMin)
    .map((g) => g.start)
    .filter((t) => t >= lo && t < hi - AFTER_FEED_MIN * MIN);

export function diaperAfterFeedInsight(events: readonly BabyEvent[], lo: number, hi: number, mergeWindowMin: number): AfterFeedInsight | null {
  const feeds = feedsForDiapers(events, lo, hi, mergeWindowMin);
  const diapers = live(events)
    .filter((e) => e.type === 'diaper' && e.start)
    .map((e) => parseLocal(e.start))
    .sort((a, b) => a - b);
  if (feeds.length < MIN_FEEDS) return null;
  const firstWithin = (t: number) => diapers.find((d) => d >= t && d - t <= AFTER_FEED_MIN * MIN);
  const lags: number[] = [];
  for (const f of feeds) {
    const d = firstWithin(f);
    if (d !== undefined) lags.push((d - f) / MIN);
  }
  let samples = 0;
  let withDiaper = 0;
  for (let t = lo; t < hi - AFTER_FEED_MIN * MIN; t += 5 * MIN) {
    samples++;
    if (firstWithin(t) !== undefined) withDiaper++;
  }
  const chance = samples ? withDiaper / samples : 1;
  if (lags.length / feeds.length < chance + MIN_LIFT) return null;
  return { hits: lags.length, total: feeds.length, lagMin: spread(lags).median };
}

/**
 * Night sleep (19:00 to 07:00): the longest stretch per night and when it usually starts, plus how many stretches of 3 hours or
 * more a night usually has. A stretch belongs to the night in which it starts. Only finished sleeps count; only complete nights.
 */
export function nightsOf(events: readonly BabyEvent[], nowEpoch: number): { perNight: { longest: number; startMin: number; long: number[] }[]; lastNight: number[] } {
  const today = localDate(nowEpoch);
  const sleeps = live(events)
    .filter((e) => e.type === 'sleep' && e.start && e.end)
    .map((e) => ({ s: parseLocal(e.start), e: parseLocal(e.end) }))
    .filter((x) => x.e > x.s);
  const perNight: { longest: number; startMin: number; long: number[] }[] = [];
  let lastNight: number[] = [];
  // night d: d 19:00 -> d+1 07:00, newest first; skip a night that has not ended yet
  for (let k = 1; k <= INSIGHT_DAYS + 1 && perNight.length < INSIGHT_DAYS; k++) {
    const d = addDays(today, -k);
    const a = dayStart(d) + NIGHT_FROM_HOUR * 60 * MIN;
    const b = dayStart(addDays(d, 1)) + NIGHT_TO_HOUR * 60 * MIN;
    if (b > nowEpoch) continue;
    const inNight = sleeps.filter((x) => x.s >= a && x.s < b).map((x) => ({ len: (x.e - x.s) / MIN, s: x.s }));
    if (inNight.length === 0) continue;
    const best = inNight.reduce((p, c) => (c.len > p.len ? c : p));
    const long = inNight.map((x) => x.len).filter((l) => l >= LONG_STRETCH_MIN).sort((p, q) => q - p);
    if (perNight.length === 0) lastNight = (long.length ? long : [best.len]).map((l) => roundTo(l, 5));
    perNight.push({ longest: best.len, startMin: (best.s - dayStart(d)) / MIN, long });
  }
  return { perNight, lastNight };
}

export function nightSleepInsight(events: readonly BabyEvent[], nowEpoch: number): NightSleepInsight | null {
  const { perNight, lastNight } = nightsOf(events, nowEpoch);
  if (perNight.length < MIN_NIGHTS) return null;
  const starts = spread(
    perNight.map((n) => n.startMin),
    15,
  );
  return {
    nights: perNight.length,
    longest: spread(perNight.map((n) => n.longest)),
    startLow: starts.low,
    startHigh: starts.high,
    longPerNight: Math.round(quantile([...perNight.map((n) => n.long.length)].sort((p, q) => p - q), 0.5)),
    nightsWithLong: perNight.filter((n) => n.long.length >= 1).length,
    nightsWithTwoLong: perNight.filter((n) => n.long.length >= 2).length,
    lastNight,
  };
}

export function insights(events: readonly BabyEvent[], nowEpoch: number, mergeWindowMin: number): Insights {
  const w = insightWindow(nowEpoch);
  return {
    from: w.from,
    to: w.to,
    feedGaps: feedGapInsight(events, w.lo, w.hi, mergeWindowMin),
    poopAfterFeed: poopAfterFeedInsight(events, w.lo, w.hi, mergeWindowMin),
    diaperAfterFeed: diaperAfterFeedInsight(events, w.lo, w.hi, mergeWindowMin),
    nightSleep: nightSleepInsight(events, nowEpoch),
    progress: {
      feedGaps: { have: feedGaps(events, w.lo, w.hi, mergeWindowMin).all.length, need: MIN_GAPS },
      poopAfterFeed: { have: poopTimes(events, w.lo, w.hi).length, need: MIN_POOPS },
      diaperAfterFeed: { have: feedsForDiapers(events, w.lo, w.hi, mergeWindowMin).length, need: MIN_FEEDS },
      nightSleep: { have: nightsOf(events, nowEpoch).perNight.length, need: MIN_NIGHTS },
    },
  };
}

// ---------- timeline (one row per day, 06:00 to 06:00) ----------

export const TIMELINE_DAY_START_HOUR = 6;

export interface TimelineRow {
  /** the calendar date the row starts on (at 06:00) */
  date: string;
  /** positions are fractions of the row, 0 = 06:00, 1 = 06:00 the next day */
  sleeps: { from: number; to: number; open: boolean }[];
  feeds: number[];
  diapers: { at: number; kind: 'pee' | 'poop' | 'both' }[];
  /** for today's row: how far the row has run (0..1); 1 for past rows */
  until: number;
  /** (owner, feedback #3) where midnight falls in the row (0.75, or a little off on the two daylight-saving days) */
  midnight: number;
}

/** The last `days` rows, newest first; the first row is the one that contains `now` (it runs only until now). */
export function timeline(events: readonly BabyEvent[], nowEpoch: number, mergeWindowMin: number, days = INSIGHT_DAYS): TimelineRow[] {
  const sixAm = (d: string) => dayStart(d) + TIMELINE_DAY_START_HOUR * 60 * MIN;
  let current = localDate(nowEpoch);
  if (nowEpoch < sixAm(current)) current = addDays(current, -1);
  const evs = live(events);
  const feeds = feedGroups(evs, mergeWindowMin).map((g) => g.start);
  const rows: TimelineRow[] = [];
  for (let k = 0; k < days; k++) {
    const date = addDays(current, -k);
    const a = sixAm(date);
    const b = sixAm(addDays(date, 1));
    const len = b - a;
    const pos = (t: number) => (t - a) / len;
    const inRow = (t: number) => t >= a && t < b && t <= nowEpoch;
    const sleeps: TimelineRow['sleeps'] = [];
    for (const e of evs) {
      if (e.type !== 'sleep' || !e.start) continue;
      const s = parseLocal(e.start);
      const end = e.end ? parseLocal(e.end) : nowEpoch;
      const from = Math.max(s, a);
      const to = Math.min(end, b, nowEpoch);
      if (to > from) sleeps.push({ from: pos(from), to: pos(to), open: !e.end && to === Math.min(nowEpoch, b) });
    }
    sleeps.sort((x, y) => x.from - y.from);
    rows.push({
      date,
      sleeps,
      feeds: feeds.filter(inRow).map(pos),
      diapers: evs
        .filter((e) => e.type === 'diaper' && e.start && inRow(parseLocal(e.start)))
        .map((e) => ({ at: pos(parseLocal(e.start)), kind: e.detail === 'poop' ? ('poop' as const) : e.detail === 'both' ? ('both' as const) : ('pee' as const) }))
        .sort((x, y) => x.at - y.at),
      until: Math.min(1, Math.max(0, pos(nowEpoch))),
      midnight: pos(dayStart(addDays(date, 1))),
    });
  }
  return rows;
}
