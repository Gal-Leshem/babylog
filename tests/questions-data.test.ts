import { describe, expect, it } from 'vitest';
import { moreAnswers } from '../src/shared/questions-data';
import { addDays, formatLocal } from '../src/shared/tz';
import type { BabyEvent } from '../src/shared/types';
import { ev, T } from './helpers';

const MIN = 60_000;
const at = (t: number) => formatLocal(t);
const NOW = T('2026-11-15 14:00'); // the window is Nov 8 .. Nov 14; today until 14:00

/**
 * A regular made-up week (and today until NOW): a feed every 3 hours from 00:00 (left at 00/06/12/18, right at 03/09/15/21),
 * every 2 hours between 17:00 and 23:00 instead (cluster feeding), a pee 15 minutes after each feed, a poop at 10:30 and 22:30,
 * and one night sleep starting 21:30 whose length grows by 10 minutes a night (from 3:00).
 */
function week(opts: { feedsToday?: number } = {}): BabyEvent[] {
  const out: BabyEvent[] = [];
  for (let d = 0; d < 7; d++) {
    const day = addDays('2026-11-08', d);
    const hours = [0, 3, 6, 9, 12, 15, 17, 19, 21, 23];
    hours.forEach((h, i) => {
      const t = T(`${day} ${String(h).padStart(2, '0')}:00`);
      out.push(ev({ type: 'feed', detail: i % 2 ? 'right' : 'left', start: at(t) }));
      out.push(ev({ type: 'diaper', detail: 'wet', start: at(t + 15 * MIN) }));
    });
    out.push(ev({ type: 'diaper', detail: 'poop', start: `${day} 10:30` }), ev({ type: 'diaper', detail: 'poop', start: `${day} 22:30` }));
    const s = T(`${day} 21:30`);
    out.push(ev({ type: 'sleep', start: at(s), end: at(s + (180 + d * 10) * MIN) }));
  }
  // today until 14:00: by default the same as a usual day (00, 03, 06, 09, 12 = 5 feeds)
  const todayHours = [0, 3, 6, 9, 12].slice(0, opts.feedsToday ?? 5);
  for (const h of todayHours) out.push(ev({ type: 'feed', detail: 'left', start: `2026-11-15 ${String(h).padStart(2, '0')}:00` }), ev({ type: 'diaper', detail: 'wet', start: `2026-11-15 ${String(h).padStart(2, '0')}:15` }));
  out.push(ev({ type: 'diaper', detail: 'poop', start: '2026-11-15 10:30' }));
  return out;
}

describe('the newer questions (F16 stage B)', () => {
  it('nothing is answered on an empty log, and each says how much it needs', () => {
    const r = moreAnswers([], NOW, 20);
    for (const k of ['feedsToday', 'sides', 'cluster', 'nextFeed', 'sleepDay', 'nightStart', 'nightTrend', 'lastPoop', 'diapersToday', 'unusual'] as const) {
      expect(r[k], k).toBeNull();
      expect(r.progress[k].have, k).toBe(0);
      expect(r.progress[k].need, k).toBeGreaterThan(0);
    }
  });

  it('feeds today against a usual day by this hour: the same, then clearly fewer', () => {
    expect(moreAnswers(week(), NOW, 20).feedsToday).toEqual({ today: 5, usualByNow: 5, usualDay: 10, trend: 'same', withBottle: 0 });
    expect(moreAnswers(week({ feedsToday: 2 }), NOW, 20).feedsToday).toMatchObject({ today: 2, usualByNow: 5, trend: 'less' });
    expect(moreAnswers(week({ feedsToday: 4 }), NOW, 20).feedsToday!.trend).toBe('same'); // one less is not a clear difference
  });

  it('left / right, cluster feeding in the evening, and the next feed from the usual gap', () => {
    const r = moreAnswers(week(), NOW, 20);
    expect(r.sides).toEqual({ left: 35, right: 35 });
    expect(r.cluster).toMatchObject({ days: 0 }); // every 2 to 3 hours: regular, no run of close feeds
    expect(r.cluster!.byDay).toHaveLength(7);
    // (owner) by part of the day: 00-04 and 04-08 and 08-12 every 3 hours, 12-16 three then two hours, 16-20 two hours,
    // 20-24 two hours then one (23:00 to midnight)
    expect(r.feedParts!.map((p) => p.median)).toEqual([180, 180, 180, 150, 120, 120]); // 20-24: seven of 2:00, six of 1:00 (the last 23:00 to midnight is today)
    // the last feed was today 12:00: the usual gap of 12:00 to 16:00 after it
    expect(r.nextFeed).toMatchObject({ last: T('2026-11-15 12:00'), part: 3, basis: 'part', gapMin: 150, at: T('2026-11-15 14:30') });
    // a part with too few gaps of its own falls back to day / night
    const thin = moreAnswers(week().filter((e) => !(e.type === 'feed' && e.start >= '2026-11-08' && e.start < '2026-11-15' && /1[2-5]:00$/.test(e.start) && e.start < '2026-11-13')), NOW, 20);
    expect(thin.feedParts![3]!.n).toBeLessThan(5);
    expect(thin.nextFeed).toMatchObject({ part: 3, basis: 'day' });
  });

  // owner (28 Nov 2026): a feeding of several sides in a row counts from its LAST side (left 12:00, right 12:15, left 12:30:
  // the usual 2:30 from 12:30), not from its first (2:30 from 12:00)
  it('the next feed counts from the last side of a feeding of several sides, with the gap measured from last side to next start', () => {
    const sides = [ev({ type: 'feed', detail: 'right', start: '2026-11-15 12:15' }), ev({ type: 'feed', detail: 'left', start: '2026-11-15 12:30' })];
    const r = moreAnswers([...week(), ...sides], NOW, 20);
    expect(r.nextFeed).toMatchObject({ last: T('2026-11-15 12:30'), part: 3, basis: 'part', gapMin: 150, at: T('2026-11-15 15:00') });
  });

  // (owner) cluster feeding in words a parent can use: on which days and at what hours there were runs of close feeds
  it('cluster feeding: runs of 3 or more feeds at most 75 minutes apart, on which days and at what usual hours', () => {
    const extra: BabyEvent[] = [];
    for (const d of ['2026-11-09', '2026-11-11', '2026-11-12', '2026-11-14']) {
      for (const h of ['18:00', '20:00']) extra.push(ev({ type: 'feed', detail: 'left', start: `${d} ${h}` }));
    }
    const r = moreAnswers([...week(), ...extra], NOW, 20);
    expect(r.cluster!.days).toBe(4);
    expect(r.cluster!.byDay.map((d) => d.run)).toEqual([false, true, false, true, true, false, true]);
    expect(r.cluster!.from).toBe(17 * 60); // 17:00, 18:00, 19:00, 20:00, 21:00
    expect(r.cluster!.to).toBe(21 * 60);
    // two feeds close together are not a run
    const pair = [...week(), ev({ type: 'feed', detail: 'left', start: '2026-11-10 13:00' })]; // 12:00, 13:00, then 15:00
    expect(moreAnswers(pair, NOW, 20).cluster!.days).toBe(0);
  });

  it('sleep per day, when the night starts, and a night stretch that grows', () => {
    const r = moreAnswers(week(), NOW, 20);
    expect(r.nightStart).toMatchObject({ median: 21 * 60 + 30, nights: 7 });
    expect(r.nightTrend!.nights).toHaveLength(7);
    expect(r.nightTrend!.trend).toBe('more'); // the last three nights are 40 minutes longer than the ones before
    expect(r.sleepDay!.usual.median).toBeGreaterThan(0);
  });

  it('the last poop and the usual time between poops; long since the last one is "more"', () => {
    const r = moreAnswers(week(), NOW, 20);
    expect(r.lastPoop).toMatchObject({ last: T('2026-11-15 10:30'), sinceMin: 210, trend: 'same' });
    expect(r.lastPoop!.gap.median).toBe(720);
    const late = moreAnswers(week(), T('2026-11-16 02:00'), 20);
    expect(late.lastPoop!.trend).toBe('more'); // 15:30 since the last one, longer than usual here
  });

  it('pee and poop today, and what is unusual today', () => {
    const same = moreAnswers(week(), NOW, 20);
    expect(same.diapersToday!.wet).toMatchObject({ today: 5, usualByNow: 5, trend: 'same' });
    expect(same.diapersToday!.poop).toMatchObject({ today: 1, usualByNow: 1, trend: 'same' });
    expect(same.unusual!.notes.filter((n) => n.what !== 'night')).toEqual([]);
    const fewer = moreAnswers(week({ feedsToday: 2 }), NOW, 20);
    expect(fewer.unusual!.notes).toEqual(expect.arrayContaining([{ what: 'feeds', trend: 'less' }, { what: 'wet', trend: 'less' }]));
  });

  it('a log of only a few days is not enough for "a usual day"', () => {
    const two = week().filter((e) => e.start >= '2026-11-13');
    const r = moreAnswers(two, NOW, 20);
    expect(r.feedsToday).toBeNull();
    expect(r.progress.feedsToday).toEqual({ have: 2, need: 5 });
    expect(r.unusual).toBeNull();
  });
});

// (owner, F18) bottles: a bottle near a nursing is one feeding; bottles and ml today; the amount per bottle; the share with a bottle
describe('bottles in the questions (F18)', () => {
  /** every day: nursing at 00, 06, 12, 18 with a 60 ml top-up 10 minutes later; formula bottles at 03, 09, 15, 21 (ml grows) */
  function mixed(opts: { mlToday?: number } = {}): BabyEvent[] {
    const out: BabyEvent[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays('2026-11-08', d);
      for (const h of [0, 6, 12, 18]) {
        const t = T(`${day} ${String(h).padStart(2, '0')}:00`);
        out.push(ev({ type: 'feed', detail: h % 12 ? 'right' : 'left', start: at(t) }), ev({ type: 'bottle', detail: 'expressed:60', start: at(t + 10 * MIN) }));
      }
      for (const h of [3, 9, 15, 21]) out.push(ev({ type: 'bottle', detail: `formula:${100 + d * 10}:${d < 3 ? 10 : 0}`, start: `${day} ${String(h).padStart(2, '0')}:00` }));
    }
    // today until 14:00: nursing + top-up at 00, 06, 12; formula at 03, 09 (or one bigger bottle)
    for (const h of [0, 6, 12]) {
      const t = T(`2026-11-15 ${String(h).padStart(2, '0')}:00`);
      out.push(ev({ type: 'feed', detail: 'left', start: at(t) }), ev({ type: 'bottle', detail: 'expressed:60', start: at(t + 10 * MIN) }));
    }
    out.push(ev({ type: 'bottle', detail: `formula:${opts.mlToday ?? 160}`, start: '2026-11-15 03:00' }), ev({ type: 'bottle', detail: `formula:${opts.mlToday ?? 160}`, start: '2026-11-15 09:00' }));
    return out;
  }

  it('a top-up within the merge window is the same feeding; the feedings today with a bottle', () => {
    const r = moreAnswers(mixed(), NOW, 20);
    expect(r.feedsToday).toMatchObject({ today: 5, withBottle: 5, usualDay: 8 });
    // with no merge window the top-ups are feedings of their own
    expect(moreAnswers(mixed(), NOW, 0).feedsToday).toMatchObject({ today: 8 });
  });

  it('bottles and ml today against a usual day; the usual amount per bottle and its trend; the share of feedings with a bottle', () => {
    const r = moreAnswers(mixed(), NOW, 20);
    // by 14:00 a usual day has 5 bottles: 3 top-ups of 60 and 2 formula; today the formula bottles are 160
    expect(r.bottlesToday!.count).toMatchObject({ today: 5, usualByNow: 5, usualDay: 8, trend: 'same' });
    expect(r.bottlesToday!.ml.today).toBe(3 * 60 + 2 * 160);
    // per kind: the top-ups stay 60; the formula (eaten = given - left: 90, 100, 110, then 130, 140, 150, 160) grows
    expect(r.bottleSize!.map((b) => b.kind)).toEqual(['expressed', 'formula']); // 28 top-ups first, then 28 formula (a tie keeps the order)
    const [ex, fo] = r.bottleSize!;
    expect(ex).toMatchObject({ usual: 60, trend: 'same' });
    expect(fo!.byDay.map((d) => d.ml)).toEqual([90, 100, 110, 130, 140, 150, 160]);
    expect(fo).toMatchObject({ usual: 130, recent: 150, before: 105, trend: 'more' });
    expect(r.bottleShare).toEqual({ withBottle: 56, total: 56 });
    expect(r.progress.bottleShare).toEqual({ have: 56, need: 20 });
  });

  it('"היום חריג" looks at the ml from bottles only when the family does not nurse', () => {
    const lots = mixed({ mlToday: 300 });
    expect(moreAnswers(lots, NOW, 20, { nursing: false }).unusual!.notes).toContainEqual({ what: 'bottleMl', trend: 'more' });
    expect(moreAnswers(lots, NOW, 20, { nursing: true }).unusual!.notes.some((n) => n.what === 'bottleMl')).toBe(false);
    expect(moreAnswers(lots, NOW, 20).unusual!.notes.some((n) => n.what === 'bottleMl')).toBe(false);
  });

  it('families without bottles: no bottle answers, and the feed answers are as before', () => {
    const r = moreAnswers(week(), NOW, 20);
    expect(r.bottlesToday).toBeNull();
    expect(r.bottleSize).toBeNull();
    expect(r.bottleShare).toBeNull();
  });
});
