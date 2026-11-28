/**
 * (owner, F16 stage B) The numbers behind the newer questions in "תובנות". Same rules as insights.ts: medians and the middle
 * half, only this family's own data (never norms), a minimum amount of data per question (`progress`), and today compared
 * with the same hour of the 7 full days before it. A trend is 'more' / 'less' only when the difference is clear; the screen
 * words it as "more / less than usual for you", never as good or bad.
 */
import { BOTTLE_KINDS, type BottleKind, eaten, parseBottle } from './bottle';
import { dailySummary, feedGroups, live } from './domain';
import { INSIGHT_DAYS, MIN_GAPS, MIN_POOPS, type Progress, type Spread, feedGapInsight, feedGaps, insightWindow, isNightHour, nightsOf, poopTimes, quantile, spread } from './insights';
import { addDays, dayStart, localDate, localHour, parseLocal } from './tz';
import type { BabyEvent } from './types';

const MIN = 60_000;
export type Trend = 'same' | 'more' | 'less';

/** Days with data needed before "a usual day" means anything. */
export const MIN_DAYS = 5;
export const MIN_SIDES = 20;
export const MIN_TREND_NIGHTS = 6;
/** A sleep counted as the start of the night: begins 18:00 to 02:00 and lasts at least this long. */
export const NIGHT_START_MIN_LEN = 120;
/**
 * Cluster feeding: a run of at least CLUSTER_MIN_FEEDS feeds, each starting at most CLUSTER_GAP_MIN after the one before
 * (feeds already merged by the merge window). Found per day; the screen says on how many days and at what hours.
 */
export const CLUSTER_GAP_MIN = 75;
export const CLUSTER_MIN_FEEDS = 3;
/** Parts of the day for the next-feed estimate: 4 hours each, from midnight; a part needs this many gaps of its own. */
export const FEED_PART_HOURS = 4;
export const MIN_PART_GAPS = 5;

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
  /** (F18) `withBottle`: today's feedings that had a bottle in them */
  feedsToday: (TodayVsUsual & { withBottle: number }) | null;
  sides: { left: number; right: number } | null;
  /**
   * cluster feeding over the 7 full days: which days had a run (oldest first), and the usual hours of the runs (minutes after
   * midnight, rounded to 15); `usualGap` is the usual time between feeds otherwise (for "the feeds are regular")
   */
  cluster: { byDay: { date: string; run: boolean }[]; days: number; from: number; to: number; usualGap: number } | null;
  /** last feed's start, the usual gap used (minutes, day or night) and the estimate; null last = no feed in the last 12 hours */
  /**
   * (owner: by part of the day, not only day / night) the usual gap in each 4-hour part of the day (by the hour the earlier
   * feed started; null when that part has too few gaps), and the estimate from the last feed: the usual gap of its part, or of
   * day / night, or of the whole day when the part has too few
   */
  nextFeed: {
    last: number | null;
    gapMin: number;
    at: number;
    /** which usual gap was used: the part's own, day or night (19:00 to 07:00), or all */
    basis: 'part' | 'day' | 'night' | 'all';
    /** index of the last feed's part in `feedParts` */
    part: number;
  } | null;
  /** (owner) the usual gap in each 4-hour part of the day, shown with "כל כמה שעות מאכילים?" (null median: too few gaps) */
  feedParts: { from: number; to: number; median: number | null; n: number }[] | null;
  sleepDay: { usual: Spread; yesterday: number; trend: Trend } | null;
  /** minutes after midnight of the evening's day (may pass 1440) */
  nightStart: { median: number; low: number; high: number; nights: number } | null;
  /** longest stretch of each night, oldest first; the last three against the nights before them */
  nightTrend: { nights: number[]; recent: number; before: number; trend: Trend } | null;
  /** null `last` = no poop logged at all in the window and today */
  lastPoop: { last: number; sinceMin: number; gap: Spread; trend: Trend } | null;
  diapersToday: { wet: TodayVsUsual; poop: TodayVsUsual } | null;
  /** what is clearly different today (or last night) from the usual, as short keys the screen words */
  unusual: { notes: { what: 'feeds' | 'wet' | 'poop' | 'night' | 'bottleMl'; trend: Exclude<Trend, 'same'> }[] } | null;
  /** (F18) bottles today and ml eaten from them, against a usual day by this hour */
  bottlesToday: { count: TodayVsUsual; ml: TodayVsUsual } | null;
  /**
   * (F18) per bottle kind (a top-up of expressed milk and a formula bottle are different sizes): the usual amount eaten from a
   * bottle on each of the 7 full days that had bottles of that kind (oldest first), the last 3 days against the days before;
   * the kind with the most bottles first. Only kinds with enough days.
   */
  bottleSize: { kind: BottleKind; byDay: { date: string; ml: number }[]; usual: number; recent: number; before: number; trend: Trend }[] | null;
  /** (F18) feedings in the 7 full days with a bottle in them */
  bottleShare: { withBottle: number; total: number } | null;
  progress: Record<'feedsToday' | 'sides' | 'cluster' | 'nextFeed' | 'sleepDay' | 'nightStart' | 'nightTrend' | 'lastPoop' | 'diapersToday' | 'unusual' | 'bottlesToday' | 'bottleSize' | 'bottleShare', Progress>;
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

/** Like `todayVsUsual`, for a sum (ml) instead of a count: today so far against the usual sum by this hour. */
function sumVsUsual(items: readonly { t: number; v: number }[], days: readonly string[], nowEpoch: number): TodayVsUsual & { days: number } {
  const tod = nowEpoch - dayStart(localDate(nowEpoch));
  const byNow: number[] = [];
  const whole: number[] = [];
  for (const d of days) {
    const a = dayStart(d);
    const inDay = items.filter((x) => x.t >= a && x.t < dayStart(addDays(d, 1)));
    if (!inDay.length) continue;
    whole.push(inDay.reduce((n, x) => n + x.v, 0));
    byNow.push(inDay.filter((x) => x.t < a + tod).reduce((n, x) => n + x.v, 0));
  }
  const t0 = dayStart(localDate(nowEpoch));
  const today = items.filter((x) => x.t >= t0 && x.t <= nowEpoch).reduce((n, x) => n + x.v, 0);
  const usualByNow = whole.length ? Math.round(median(byNow)) : 0;
  return { today, usualByNow, usualDay: whole.length ? Math.round(median(whole)) : 0, trend: trendOf(today, usualByNow, 30, 0.25), days: whole.length };
}

function todayVsUsual(times: readonly number[], days: readonly string[], nowEpoch: number): TodayVsUsual & { days: number } {
  const { byNow, whole } = byTimeOfDay(times, days, nowEpoch);
  const today = times.filter((t) => t >= dayStart(localDate(nowEpoch)) && t <= nowEpoch).length;
  const usualByNow = whole.length ? Math.round(median(byNow)) : 0;
  return { today, usualByNow, usualDay: whole.length ? Math.round(median(whole)) : 0, trend: trendOf(today, usualByNow, 2, 0.25), days: whole.length };
}

/**
 * `nursing` (F18): whether the family nurses; without nursing, the ml eaten from bottles is one of the things "היום חריג" looks
 * at (with nursing it is left out: a bottle day says little when most feeds are at the breast).
 */
export function moreAnswers(events: readonly BabyEvent[], nowEpoch: number, mergeWindowMin: number, opts: { nursing?: boolean } = {}): MoreAnswers {
  const w = insightWindow(nowEpoch);
  const days: string[] = [];
  for (let d = w.from; d <= w.to; d = addDays(d, 1)) days.push(d);
  const evs = live(events);
  const groups = feedGroups(evs, mergeWindowMin);
  const feedStarts = groups.map((g) => g.start);

  // feeds today against a usual day by this hour (a nursing and a bottle in one merge window are one feeding)
  const ft = todayVsUsual(feedStarts, days, nowEpoch);
  const todayFrom = dayStart(localDate(nowEpoch));
  const withBottleToday = groups.filter((g) => g.start >= todayFrom && g.start <= nowEpoch && g.events.some((e) => e.type === 'bottle')).length;

  // bottles: how many and how much was eaten, today against a usual day; the usual amount per bottle, day by day
  const bottles = evs
    .filter((e) => e.type === 'bottle' && e.start)
    .map((e) => ({ t: parseLocal(e.start), b: parseBottle(e.detail) }))
    .filter((x): x is { t: number; b: NonNullable<ReturnType<typeof parseBottle>> } => x.b !== null);
  const bCount = todayVsUsual(bottles.map((x) => x.t), days, nowEpoch);
  const bMl = sumVsUsual(bottles.map((x) => ({ t: x.t, v: eaten(x.b) })), days, nowEpoch);
  const sizeKinds = BOTTLE_KINDS.map((kind) => {
    const mine = bottles.filter((x) => x.b.kind === kind);
    const byDay = days
      .map((d) => ({ date: d, list: mine.filter((x) => x.t >= dayStart(d) && x.t < dayStart(addDays(d, 1))).map((x) => eaten(x.b)) }))
      .filter((d) => d.list.length > 0)
      .map((d) => ({ date: d.date, ml: Math.round(median(d.list) / 5) * 5 }));
    const sizes = byDay.map((d) => d.ml);
    const recent = byDay.length ? Math.round(median(sizes.slice(-3))) : 0;
    const before = byDay.length > 3 ? Math.round(median(sizes.slice(0, -3))) : recent;
    const n = mine.filter((x) => x.t >= w.lo && x.t < w.hi).length;
    return { kind, n, byDay, usual: byDay.length ? Math.round(median(sizes) / 5) * 5 : 0, recent, before, trend: trendOf(recent, before, 10, 0.1) };
  });
  const sizeReady = sizeKinds.filter((k) => k.byDay.length >= MIN_DAYS).sort((a, b) => b.n - a.n);
  const bottleSize = sizeReady.length ? sizeReady.map(({ n: _n, ...k }) => k) : null;
  const sizeDays = Math.max(0, ...sizeKinds.map((k) => k.byDay.length));
  const inWindow = groups.filter((g) => g.start >= w.lo && g.start < w.hi);
  const withBottleWeek = inWindow.filter((g) => g.events.some((e) => e.type === 'bottle')).length;

  // left / right presses in the window
  const presses = evs.filter((e) => e.type === 'feed' && e.start && (e.detail === 'left' || e.detail === 'right')).filter((e) => {
    const t = parseLocal(e.start);
    return t >= w.lo && t < w.hi;
  });
  const left = presses.filter((e) => e.detail === 'left').length;
  const right = presses.length - left;

  // cluster feeding: on each full day, the longest run of feeds close to each other
  const runStarts: number[] = [];
  const runEnds: number[] = [];
  const byDay: { date: string; run: boolean }[] = [];
  let daysWithFeeds = 0;
  for (const d of days) {
    const a = dayStart(d);
    const inDay = feedStarts.filter((t) => t >= a && t < dayStart(addDays(d, 1)));
    if (inDay.length) daysWithFeeds++;
    let best: [number, number] | null = null;
    let i = 0;
    while (i < inDay.length) {
      let j = i;
      while (j + 1 < inDay.length && inDay[j + 1]! - inDay[j]! <= CLUSTER_GAP_MIN * MIN) j++;
      if (j - i + 1 >= CLUSTER_MIN_FEEDS && (!best || j - i > best[1] - best[0])) best = [i, j];
      i = j + 1;
    }
    byDay.push({ date: d, run: best !== null });
    if (best) {
      runStarts.push((inDay[best[0]]! - a) / MIN);
      runEnds.push((inDay[best[1]]! - a) / MIN);
    }
  }
  const gapsAll = feedGaps(evs, w.lo, w.hi, mergeWindowMin).all;
  const cluster =
    daysWithFeeds >= MIN_DAYS
      ? {
          byDay,
          days: runStarts.length,
          from: runStarts.length ? spread(runStarts, 15).median : 0,
          to: runEnds.length ? spread(runEnds, 15).median : 0,
          usualGap: gapsAll.length ? spread(gapsAll).median : 0,
        }
      : null;

  // next feed: the usual gap after the last feed in the same part of the day, from this family's pace only
  const gapsReady = feedGaps(evs, w.lo, w.hi, mergeWindowMin).all.length >= MIN_GAPS;
  let nextFeed: MoreAnswers['nextFeed'] = null;
  let feedParts: MoreAnswers['feedParts'] = null;
  if (gapsReady) {
    const g = feedGapInsight(evs, w.lo, w.hi, mergeWindowMin)!;
    const startsIn = feedStarts.filter((t) => t >= w.lo && t < w.hi);
    const byPart: number[][] = Array.from({ length: 24 / FEED_PART_HOURS }, () => []);
    for (let i = 1; i < startsIn.length; i++) {
      const gap = (startsIn[i]! - startsIn[i - 1]!) / MIN;
      if (gap > 6 * 60) continue; // most likely a feed that was not logged
      byPart[Math.floor(localHour(startsIn[i - 1]!) / FEED_PART_HOURS)]!.push(gap);
    }
    const parts = byPart.map((gaps, k) => ({ from: k * FEED_PART_HOURS, to: (k + 1) * FEED_PART_HOURS, median: gaps.length >= MIN_PART_GAPS ? spread(gaps).median : null, n: gaps.length }));
    feedParts = parts;
    // (owner, 28 Nov 2026) the next feed counts from the LAST side of the last feeding (several sides in a row are one feeding),
    // so its usual gap is measured the same way: from the last side of each feeding to the start of the next one
    const ends = groups.map((gr) => parseLocal(gr.events[gr.events.length - 1]!.start));
    const endGaps: { at: number; gap: number }[] = [];
    for (let i = 0; i + 1 < groups.length; i++) {
      const at = ends[i]!;
      const next = feedStarts[i + 1]!;
      if (at < w.lo || next >= w.hi) continue;
      const gap = (next - at) / MIN;
      if (gap > 6 * 60) continue; // most likely a feed that was not logged
      endGaps.push({ at, gap });
    }
    const median = (xs: number[], need: number) => (xs.length >= need ? spread(xs).median : null);
    const last = ends.filter((t) => t <= nowEpoch).pop();
    const recent = last !== undefined && nowEpoch - last <= 12 * 60 * MIN ? last : null;
    const part = Math.floor(localHour(recent ?? nowEpoch) / FEED_PART_HOURS);
    const night = isNightHour(localHour(recent ?? nowEpoch));
    const own = median(endGaps.filter((x) => Math.floor(localHour(x.at) / FEED_PART_HOURS) === part).map((x) => x.gap), MIN_PART_GAPS);
    const half = median(endGaps.filter((x) => isNightHour(localHour(x.at)) === night).map((x) => x.gap), MIN_PART_GAPS);
    const all = median(endGaps.map((x) => x.gap), 1) ?? g.all.median;
    const [gapMin, basis]: [number, 'part' | 'day' | 'night' | 'all'] = own !== null ? [own, 'part'] : half !== null ? [half, night ? 'night' : 'day'] : [all, 'all'];
    nextFeed = { last: recent, gapMin, at: recent === null ? 0 : recent + gapMin * MIN, basis, part };
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
    // (owner) the ml eaten from bottles only when the family does not nurse
    if (opts.nursing === false && bMl.days >= MIN_DAYS && bMl.trend !== 'same') notes.push({ what: 'bottleMl', trend: bMl.trend });
    if (per.length >= 4) {
      const lastNight = per[0]!.longest;
      const t = trendOf(lastNight, median(per.slice(1).map((n) => n.longest)), 45, 0.2);
      if (t !== 'same') notes.push({ what: 'night', trend: t });
    }
    unusual = { notes };
  }

  return {
    feedsToday: ft.days >= MIN_DAYS ? { today: ft.today, usualByNow: ft.usualByNow, usualDay: ft.usualDay, trend: ft.trend, withBottle: withBottleToday } : null,
    bottlesToday: bCount.days >= MIN_DAYS ? { count: bCount, ml: bMl } : null,
    bottleSize,
    bottleShare: inWindow.length >= MIN_SIDES && bottles.length > 0 ? { withBottle: withBottleWeek, total: inWindow.length } : null,
    sides: presses.length >= MIN_SIDES ? { left, right } : null,
    cluster,
    nextFeed,
    feedParts,
    sleepDay,
    nightStart: ns ? { median: ns.median, low: ns.low, high: ns.high, nights: starts.length } : null,
    nightTrend,
    lastPoop,
    diapersToday,
    unusual,
    progress: {
      feedsToday: { have: ft.days, need: MIN_DAYS },
      sides: { have: presses.length, need: MIN_SIDES },
      cluster: { have: daysWithFeeds, need: MIN_DAYS },
      nextFeed: { have: feedGaps(evs, w.lo, w.hi, mergeWindowMin).all.length, need: MIN_GAPS },
      sleepDay: { have: withSleep.length, need: MIN_DAYS },
      nightStart: { have: starts.length, need: 4 },
      nightTrend: { have: nights.length, need: MIN_TREND_NIGHTS },
      lastPoop: { have: poopsIn.length, need: MIN_POOPS },
      diapersToday: { have: anyDiaperDays, need: MIN_DAYS },
      unusual: { have: ft.days, need: MIN_DAYS },
      bottlesToday: { have: bCount.days, need: MIN_DAYS },
      bottleSize: { have: sizeDays, need: MIN_DAYS },
      bottleShare: { have: inWindow.length, need: MIN_SIDES },
    },
  };
}
