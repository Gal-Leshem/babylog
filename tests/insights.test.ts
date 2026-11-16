import { describe, expect, it } from 'vitest';
import {
  diaperAfterFeedInsight,
  feedGapInsight,
  insights,
  insightWindow,
  nightSleepInsight,
  poopAfterFeedInsight,
  quantile,
  spread,
} from '../src/shared/insights';
import { addDays, formatLocal } from '../src/shared/tz';
import type { BabyEvent } from '../src/shared/types';
import { ev, T } from './helpers';

const MIN = 60_000;
const NOW = T('2026-11-15 10:00'); // the window is Nov 8 .. Nov 14
const at = (t: number) => formatLocal(t);

/** A regular week: feeds every 150 min by day (07-19) and 195 min by night, each feed = left + right 10 min apart. */
function feedWeek(days = 7): BabyEvent[] {
  const out: BabyEvent[] = [];
  let t = T('2026-11-08 00:30');
  const end = T('2026-11-15 09:00');
  while (t < end && t < T('2026-11-08 00:00') + days * 1440 * MIN) {
    out.push(ev({ type: 'feed', detail: 'left', start: at(t) }), ev({ type: 'feed', detail: 'right', start: at(t + 10 * MIN) }));
    const h = Number(at(t).slice(11, 13));
    t += (h >= 19 || h < 7 ? 195 : 150) * MIN;
  }
  return out;
}
const feedStarts = (evs: BabyEvent[]) => evs.filter((e) => e.type === 'feed' && e.detail === 'left').map((e) => T(e.start));

describe('statistics helpers', () => {
  it('quantiles interpolate and spreads round to 5 minutes', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(spread([100, 140, 152, 160, 300])).toEqual({ median: 150, low: 140, high: 160, n: 5 });
  });

  it('the window is the 7 full days before today', () => {
    expect(insightWindow(NOW)).toMatchObject({ from: '2026-11-08', to: '2026-11-14', lo: T('2026-11-08 00:00'), hi: T('2026-11-15 00:00') });
  });
});

describe('feed gaps', () => {
  const w = insightWindow(NOW);
  it('reports the usual gap by day and by night, start to start, after merging the two sides', () => {
    const g = feedGapInsight(feedWeek(), w.lo, w.hi, 20)!;
    expect(g.day?.median).toBe(150);
    expect(g.night?.median).toBe(195);
    expect(g.all.n).toBeGreaterThan(40);
  });

  it('is withheld with too few gaps, and ignores very long gaps (a feed that was not logged)', () => {
    const two = feedWeek(2);
    expect(feedGapInsight(two, w.lo, w.hi, 20)).toBeNull();
    const withHole = feedWeek().filter((e) => !(e.start >= '2026-11-10 08:00' && e.start < '2026-11-10 16:00'));
    expect(feedGapInsight(withHole, w.lo, w.hi, 20)!.all.high).toBeLessThanOrEqual(195);
  });

  it('ignores deleted feeds and anything from today', () => {
    const extra = [...feedWeek(), ev({ type: 'feed', detail: 'left', start: '2026-11-12 13:00', deleted: true }), ev({ type: 'feed', detail: 'left', start: '2026-11-15 01:00' })];
    expect(feedGapInsight(extra, w.lo, w.hi, 20)).toEqual(feedGapInsight(feedWeek(), w.lo, w.hi, 20));
  });
});

describe('diapers after feeds', () => {
  const w = insightWindow(NOW);
  const feeds = feedWeek();

  it('poop usually 20 minutes after a feed starts', () => {
    const poops = feedStarts(feeds)
      .filter((_, i) => i % 3 === 0)
      .map((t) => ev({ type: 'diaper', detail: 'poop', start: at(t + 20 * MIN) }));
    const r = poopAfterFeedInsight([...feeds, ...poops], w.lo, w.hi, 20)!;
    expect(r.lagMin).toBe(20);
    expect(r.hits).toBe(r.total);
    expect(r.total).toBeGreaterThanOrEqual(8);
  });

  it('"poop + pee" counts as a poop', () => {
    const both = feedStarts(feeds)
      .filter((_, i) => i % 3 === 0)
      .map((t) => ev({ type: 'diaper', detail: 'both', start: at(t + 25 * MIN) }));
    expect(poopAfterFeedInsight([...feeds, ...both], w.lo, w.hi, 20)?.lagMin).toBe(25);
  });

  it('a poop that has nothing to do with feeds is not reported as a pattern', () => {
    // poops just before each next feed: after the hour, so never "after a feed"
    const poops = feedStarts(feeds)
      .filter((_, i) => i % 3 === 0)
      .map((t) => ev({ type: 'diaper', detail: 'poop', start: at(t + 120 * MIN) }));
    expect(poopAfterFeedInsight([...feeds, ...poops], w.lo, w.hi, 20)).toBeNull();
  });

  it('needs at least 8 poops', () => {
    const few = feedStarts(feeds)
      .slice(0, 5)
      .map((t) => ev({ type: 'diaper', detail: 'poop', start: at(t + 20 * MIN) }));
    expect(poopAfterFeedInsight([...feeds, ...few], w.lo, w.hi, 20)).toBeNull();
  });

  it('diaper changes 15 minutes after most feeds', () => {
    const changes = feedStarts(feeds)
      .filter((_, i) => i % 5 !== 0)
      .map((t) => ev({ type: 'diaper', detail: 'wet', start: at(t + 15 * MIN) }));
    const r = diaperAfterFeedInsight([...feeds, ...changes], w.lo, w.hi, 20)!;
    expect(r.lagMin).toBe(15);
    expect(r.hits / r.total).toBeGreaterThan(0.75);
  });

  it('diapers spread evenly over the day are not a pattern (chance level)', () => {
    const even: BabyEvent[] = [];
    for (let t = w.lo + 7 * MIN; t < w.hi; t += 75 * MIN) even.push(ev({ type: 'diaper', detail: 'wet', start: at(t) }));
    expect(diaperAfterFeedInsight([...feeds, ...even], w.lo, w.hi, 20)).toBeNull();
  });
});

describe('night sleep', () => {
  /** each night: a stretch from 22:00 of `first` minutes, then one at 03:00 of `second` minutes */
  function nights(first: number, second: number, count = 7): BabyEvent[] {
    const out: BabyEvent[] = [];
    for (let k = 1; k <= count; k++) {
      const d = addDays('2026-11-15', -k);
      const a = T(`${d} 22:00`);
      out.push(ev({ type: 'sleep', start: at(a), end: at(a + first * MIN) }));
      const b = T(`${addDays(d, 1)} 03:00`);
      out.push(ev({ type: 'sleep', start: at(b), end: at(b + second * MIN) }));
    }
    return out;
  }

  it('longest stretch, when it starts, and how many stretches of 3 hours or more', () => {
    const r = nightSleepInsight(nights(220, 185), NOW)!;
    expect(r.nights).toBe(7);
    expect(r.longest.median).toBe(220);
    expect([r.startLow, r.startHigh]).toEqual([22 * 60, 22 * 60]);
    expect(r.longPerNight).toBe(2);
    expect(r.nightsWithTwoLong).toBe(7);
    expect(r.lastNight).toEqual([220, 185]);
  });

  it('a start after midnight is counted on the same clock (minutes after the evening midnight + 24 h)', () => {
    const r = nightSleepInsight(nights(100, 200), NOW)!;
    expect(r.longest.median).toBe(200);
    expect(r.startLow).toBe(27 * 60); // 03:00 the next morning
    expect(r.longPerNight).toBe(1);
    expect(r.lastNight).toEqual([200]);
  });

  it('with no long stretch, the last night shows just its longest', () => {
    const r = nightSleepInsight(nights(150, 120), NOW)!;
    expect(r.longPerNight).toBe(0);
    expect(r.nightsWithLong).toBe(0);
    expect(r.lastNight).toEqual([150]);
  });

  it('skips a night that has not ended and open sleeps; needs 4 nights', () => {
    const early = T('2026-11-15 05:00'); // last night is still going: the newest complete night is Nov 13 -> 14
    const evs = [...nights(220, 185), ev({ type: 'sleep', start: '2026-11-14 23:30' })];
    expect(nightSleepInsight(evs, early)!.nights).toBe(6);
    expect(nightSleepInsight(nights(220, 185, 3), NOW)).toBeNull();
  });
});

describe('all insights together', () => {
  it('returns nulls on an empty log', () => {
    expect(insights([], NOW, 20)).toEqual({ from: '2026-11-08', to: '2026-11-14', feedGaps: null, poopAfterFeed: null, diaperAfterFeed: null, nightSleep: null });
  });
});
