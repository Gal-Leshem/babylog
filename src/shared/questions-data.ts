/**
 * (owner, F16 stage B) The numbers behind the newer questions in "תובנות". Same rules as insights.ts: medians and the middle
 * half, only this family's own data (never norms), a minimum amount of data per question (`progress`), and today compared
 * with the same hour of the 7 full days before it. A trend is 'more' / 'less' only when the difference is clear; the screen
 * words it as "more / less than usual for you", never as good or bad.
 */
import { dailySummary, feedGroups, live } from './domain';
import { INSIGHT_DAYS, MIN_GAPS, MIN_POOPS, type Progress, type Spread, feedGapInsight, feedGaps, insightWindow, isNightHour, nightsOf, poopTimes, quantile, spread } from './insights';
import { addDays, dayStart, localDate, localHour, parseLocal } from './tz';
import type { BabyEvent } from './types';

const MIN = 60_000;
export type Trend = 'same' | 'more' | 'less';

/** Days with data needed before "a usual day" means anything. */
export const MIN_DAYS = 5;
export const MIN_SIDES = 20;
export const MIN_CLUSTER_GAPS = 8;
export const MIN_TREND_NIGHTS = 6;
/** A sleep counted as the start of the night: begins 18:00 to 02:00 and lasts at least this long. */
export const NIGHT_START_MIN_LEN = 120;
/** Evening for cluster feeding: gaps that start 17:00 to 23:00, against the day 07:00 to 17:00. */
const EVENING = [17, 23] as const;
const DAYTIME = [7, 17] as const;

const median = (xs: readonly number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);
/** A clear difference: at least `abs` and at least `rel` of the usual value. */
const trendOf = (now: number, usual: number, abs: number, rel: number): Trend => {
  const d = now - usual;
  if (Math.abs(d) < abs || Math.abs(d) < rel * Math.max(usual, 1)) return 'same';
  return d > 0 ? 'more' : 'less';
};

export interface TodayVsUsual {
  today: number;
  /** the usual count by this time of day (median of the 7 full days), and for a whole day */
  usualByNow: number;
  usualDay: number;
  trend: Trend;
}

export interface MoreAnswers {
  feedsToday: TodayVsUsual | null;
  sides: { left: number; right: number } | null;
  cluster: { evening: Spread; day: Spread; yes: boolean } | null;
  /** last feed's start, the usual gap used (minutes, day or night) and the estimate; null last = no feed in the last 12 hours */
  nextFeed: { last: number | null; gapMin: number; at: number; night: boolean } | null;
  sleepDay: { usual: Spread; yesterday: number; trend: Trend } | null;
  /** minutes after midnight of the evening's day (may pass 1440) */
  nightStart: { median: number; low: number; high: number; nights: number } | null;
  /** longest stretch of each night, oldest first; the last three against the nights before them */
  nightTrend: { nights: number[]; recent: number; before: number; trend: Trend } | null;
  /** null `last` = no poop logged at all in the window and today */
  lastPoop: { last: number; sinceMin: number; gap: Spread; trend: Trend } | null;
  diapersToday: { wet: TodayVsUsual; poop: TodayVsUsual } | null;
  /** what is clearly different today (or last night) from the usual, as short keys the screen words */
  unusual: { notes: { what: 'feeds' | 'wet' | 'poop' | 'night'; trend: Exclude<Trend, 'same'> }[] } | null;
  progress: Record<'feedsToday' | 'sides' | 'cluster' | 'nextFeed' | 'sleepDay' | 'nightStart' | 'nightTrend' | 'lastPoop' | 'diapersToday' | 'unusual', Progress>;
}

/** For each of the 7 full days: how many of `times` fell before the same time of day as now; the days that had any at all. */
function byTimeOfDay(times: readonly number[], days: readonly string[], nowEpoch: number): { byNow: number[]; whole: number[] } {
  const tod = nowEpoch - dayStart(localDate(nowEpoch));
  const byNow: number[] = [];
  const whole: number[] = [];
  for (const d of days) {
    const a = dayStart(d);
    const b = dayStart(addDays(d, 1));
    const inDay = times.filter((t) => t >= a && t < b);
    if (inDay.length === 0) continue; // nothing logged that day: not a "usual" day
    whole.push(inDay.length);
    byNow.push(inDay.filter((t) => t < a + tod).length);
  }
  return { byNow, whole };
}

function todayVsUsual(times: readonly number[], days: readonly string[], nowEpoch: number): TodayVsUsual & { days: number } {
  const { byNow, whole } = byTimeOfDay(times, days, nowEpoch);
  const today = times.filter((t) => t >= dayStart(localDate(nowEpoch)) && t <= nowEpoch).length;
  const usualByNow = whole.length ? Math.round(median(byNow)) : 0;
  return { today, usualByNow, usualDay: whole.length ? Math.round(median(whole)) : 0, trend: trendOf(today, usualByNow, 2, 0.25), days: whole.length };
}

export function moreAnswers(events: readonly BabyEvent[], nowEpoch: number, mergeWindowMin: number): MoreAnswers {
  const w = insightWindow(nowEpoch);
  const days: string[] = [];
  for (let d = w.from; d <= w.to; d = addDays(d, 1)) days.push(d);
  const evs = live(events);
  const feedStarts = feedGroups(evs, mergeWindowMin).map((g) => g.start);

  // feeds today against a usual day by this hour
  const ft = todayVsUsual(feedStarts, days, nowEpoch);

  // left / right presses in the window
  const presses = evs.filter((e) => e.type === 'feed' && e.start && (e.detail === 'left' || e.detail === 'right')).filter((e) => {
    const t = parseLocal(e.start);
    return t >= w.lo && t < w.hi;
  });
  const left = presses.filter((e) => e.detail === 'left').length;
  const right = presses.length - left;

  // cluster feeding: evening gaps against daytime gaps
  const startsIn = feedStarts.filter((t) => t >= w.lo && t < w.hi);
  const evening: number[] = [];
  const daytime: number[] = [];
  for (let i = 1; i < startsIn.length; i++) {
    const gap = (startsIn[i]! - startsIn[i - 1]!) / MIN;
    if (gap > 6 * 60) continue;
    const h = localHour(startsIn[i - 1]!);
    if (h >= EVENING[0] && h < EVENING[1]) evening.push(gap);
    else if (h >= DAYTIME[0] && h < DAYTIME[1]) daytime.push(gap);
  }
  const clusterHave = Math.min(evening.length, daytime.length);
  const cluster =
    clusterHave >= MIN_CLUSTER_GAPS
      ? (() => {
          const e = spread(evening);
          const d = spread(daytime);
          return { evening: e, day: d, yes: e.median <= 0.75 * d.median };
        })()
      : null;

  // next feed: the usual gap (day or night) after the last feed, from this family's pace only
  const gapsReady = feedGaps(evs, w.lo, w.hi, mergeWindowMin).all.length >= MIN_GAPS;
  let nextFeed: MoreAnswers['nextFeed'] = null;
  if (gapsReady) {
    const g = feedGapInsight(evs, w.lo, w.hi, mergeWindowMin)!;
    const last = [...feedStarts].filter((t) => t <= nowEpoch).pop();
    const recent = last !== undefined && nowEpoch - last <= 12 * 60 * MIN ? last : null;
    const night = recent !== null && isNightHour(localHour(recent));
    const gapMin = (night ? g.night : g.day)?.median ?? g.all.median;
    nextFeed = { last: recent, gapMin, at: recent === null ? 0 : recent + gapMin * MIN, night };
  }

  // sleep per day (the 7 full days that have any sleep logged), and yesterday against them
  const sleepTotals = days.map((d) => dailySummary(evs, d, nowEpoch, mergeWindowMin).sleep.totalMin);
  const withSleep = sleepTotals.filter((m) => m > 0);
  const yesterday = sleepTotals[sleepTotals.length - 1] ?? 0;
  const sleepDay = withSleep.length >= MIN_DAYS ? { usual: spread(withSleep), yesterday, trend: trendOf(yesterday, median(withSleep), 60, 0.1) } : null;

  // when the night starts: the first sleep of 2 hours or more that begins 18:00 to 02:00, per finished night
  const sleeps = evs
    .filter((e) => e.type === 'sleep' && e.start && e.end)
    .map((e) => ({ s: parseLocal(e.start), e: parseLocal(e.end) }))
    .sort((a, b) => a.s - b.s);
  const starts: number[] = [];
  for (let k = 1; k <= INSIGHT_DAYS + 1 && starts.length < INSIGHT_DAYS; k++) {
    const d = addDays(localDate(nowEpoch), -k);
    const a = dayStart(d) + 18 * 60 * MIN;
    const b = dayStart(addDays(d, 1)) + 2 * 60 * MIN;
    if (dayStart(addDays(d, 1)) + 7 * 60 * MIN > nowEpoch) continue; // that night is not over yet
    const first = sleeps.find((x) => x.s >= a && x.s < b && x.e - x.s >= NIGHT_START_MIN_LEN * MIN);
    if (first) starts.push((first.s - dayStart(d)) / MIN);
  }
  const ns = starts.length >= 4 ? spread(starts, 15) : null;

  // is the long night stretch getting longer: the last three nights against the nights before them
  const per = nightsOf(evs, nowEpoch).perNight; // newest first
  const nights = per.map((n) => Math.round(n.longest)).reverse();
  const nightTrend =
    nights.length >= MIN_TREND_NIGHTS
      ? (() => {
          const recent = Math.round(median(nights.slice(-3)));
          const before = Math.round(median(nights.slice(0, -3)));
          return { nights, recent, before, trend: trendOf(recent, before, 20, 0) };
        })()
      : null;

  // the last poop, and the usual time between poops (window and today)
  const poopsIn = poopTimes(evs, w.lo, w.hi);
  const poopsAll = poopTimes(evs, w.lo, nowEpoch + 1).sort((a, b) => a - b);
  let lastPoop: MoreAnswers['lastPoop'] = null;
  if (poopsIn.length >= MIN_POOPS) {
    const gaps: number[] = [];
    for (let i = 1; i < poopsAll.length; i++) gaps.push((poopsAll[i]! - poopsAll[i - 1]!) / MIN);
    const gap = spread(gaps, 5);
    const last = poopsAll[poopsAll.length - 1]!;
    const sinceMin = Math.round((nowEpoch - last) / MIN);
    lastPoop = { last, sinceMin, gap, trend: sinceMin > gap.high ? 'more' : 'same' };
  }

  // pee and poop today against a usual day by this hour ("both" counts as one of each)
  const diapers = evs.filter((e) => e.type === 'diaper' && e.start);
  const wetTimes = diapers.filter((e) => e.detail === 'wet' || e.detail === 'both').map((e) => parseLocal(e.start));
  const poopTimesAll = diapers.filter((e) => e.detail === 'poop' || e.detail === 'both').map((e) => parseLocal(e.start));
  const anyDiaperDays = byTimeOfDay(diapers.map((e) => parseLocal(e.start)), days, nowEpoch).whole.length;
  const wet = todayVsUsual(wetTimes, days, nowEpoch);
  const poop = todayVsUsual(poopTimesAll, days, nowEpoch);
  const diapersToday = anyDiaperDays >= MIN_DAYS ? { wet, poop } : null;

  // what is clearly different today (or last night) from the usual
  let unusual: MoreAnswers['unusual'] = null;
  if (ft.days >= MIN_DAYS) {
    const notes: NonNullable<MoreAnswers['unusual']>['notes'] = [];
    if (ft.trend !== 'same') notes.push({ what: 'feeds', trend: ft.trend });
    if (diapersToday && wet.trend !== 'same') notes.push({ what: 'wet', trend: wet.trend });
    if (diapersToday && poop.trend !== 'same') notes.push({ what: 'poop', trend: poop.trend });
    if (per.length >= 4) {
      const lastNight = per[0]!.longest;
      const t = trendOf(lastNight, median(per.slice(1).map((n) => n.longest)), 45, 0.2);
      if (t !== 'same') notes.push({ what: 'night', trend: t });
    }
    unusual = { notes };
  }

  return {
    feedsToday: ft.days >= MIN_DAYS ? { today: ft.today, usualByNow: ft.usualByNow, usualDay: ft.usualDay, trend: ft.trend } : null,
    sides: presses.length >= MIN_SIDES ? { left, right } : null,
    cluster,
    nextFeed,
    sleepDay,
    nightStart: ns ? { median: ns.median, low: ns.low, high: ns.high, nights: starts.length } : null,
    nightTrend,
    lastPoop,
    diapersToday,
    unusual,
    progress: {
      feedsToday: { have: ft.days, need: MIN_DAYS },
      sides: { have: presses.length, need: MIN_SIDES },
      cluster: { have: clusterHave, need: MIN_CLUSTER_GAPS },
      nextFeed: { have: feedGaps(evs, w.lo, w.hi, mergeWindowMin).all.length, need: MIN_GAPS },
      sleepDay: { have: withSleep.length, need: MIN_DAYS },
      nightStart: { have: starts.length, need: 4 },
      nightTrend: { have: nights.length, need: MIN_TREND_NIGHTS },
      lastPoop: { have: poopsIn.length, need: MIN_POOPS },
      diapersToday: { have: anyDiaperDays, need: MIN_DAYS },
      unusual: { have: ft.days, need: MIN_DAYS },
    },
  };
}
