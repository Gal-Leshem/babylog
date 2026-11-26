import { describe, expect, it } from 'vitest';
import {
  clock,
  dailySummary,
  elapsedHM,
  feedGroups,
  forgottenWake,
  lastFeed,
  nextSide,
  openSleep,
  overlappingSleep,
  sleepState,
  vitaminDOnDate,
} from '../src/shared/domain';
import { ev, T } from './helpers';

describe('feed grouping and next side', () => {
  const feeds = [
    ev({ type: 'feed', detail: 'left', start: '2026-11-14 01:00' }),
    ev({ type: 'feed', detail: 'right', start: '2026-11-14 01:12' }),
    ev({ type: 'feed', detail: 'left', start: '2026-11-14 04:00' }),
    ev({ type: 'feed', detail: 'right', start: '2026-11-14 04:20' }), // exactly 20 min: same feeding
    ev({ type: 'feed', detail: 'left', start: '2026-11-14 07:00' }),
    ev({ type: 'feed', detail: 'right', start: '2026-11-14 07:21' }), // 21 min: new feeding
  ];

  it('merges presses within the window', () => {
    const g = feedGroups(feeds, 20);
    expect(g.map((x) => x.events.length)).toEqual([2, 2, 1, 1]);
  });

  it('respects a different window', () => {
    expect(feedGroups(feeds, 0)).toHaveLength(6);
    expect(feedGroups(feeds, 150)).toHaveLength(3); // gaps of 168 and 160 min still split
    expect(feedGroups(feeds, 180)).toHaveLength(1); // every gap is within 180 min
  });

  it('ignores deleted feeds', () => {
    const withDeleted = [...feeds, ev({ type: 'feed', detail: 'left', start: '2026-11-14 09:00', deleted: true })];
    expect(lastFeed(withDeleted)?.start).toBe('2026-11-14 07:21');
    expect(nextSide(withDeleted)).toBe('left');
  });

  it('has no recommendation without feeds', () => {
    expect(nextSide([])).toBeNull();
  });

  it('uses the latest press by time, not by insertion order', () => {
    const backfilled = [
      ev({ type: 'feed', detail: 'left', start: '2026-11-14 10:00' }),
      ev({ type: 'feed', detail: 'right', start: '2026-11-14 08:00' }),
    ];
    expect(nextSide(backfilled)).toBe('right');
  });
});

describe('sleep state', () => {
  it('is asleep with an open sleep row', () => {
    const e = [ev({ type: 'sleep', start: '2026-11-14 03:00' })];
    expect(openSleep(e)).toBeDefined();
    expect(sleepState(e)).toEqual({ state: 'asleep', since: T('2026-11-14 03:00') });
  });

  it('is awake since the latest wake-up', () => {
    const e = [
      ev({ type: 'sleep', start: '2026-11-14 01:00', end: '2026-11-14 02:00' }),
      ev({ type: 'sleep', start: '2026-11-14 03:00', end: '2026-11-14 04:30' }),
    ];
    expect(sleepState(e)).toEqual({ state: 'awake', since: T('2026-11-14 04:30') });
  });

  it('counts an end-only row as a wake-up', () => {
    const e = [ev({ type: 'sleep', end: '2026-11-14 05:00' })];
    expect(sleepState(e)).toEqual({ state: 'awake', since: T('2026-11-14 05:00') });
    expect(openSleep(e)).toBeUndefined();
  });

  it('ignores deleted sleep and has no history initially', () => {
    expect(sleepState([ev({ type: 'sleep', start: '2026-11-14 03:00', deleted: true })])).toEqual({
      state: 'awake',
      since: null,
    });
  });
});

describe('daily summary', () => {
  const now = T('2026-11-14 12:00');
  const events = [
    ev({ type: 'feed', detail: 'left', start: '2026-11-14 01:00' }),
    ev({ type: 'feed', detail: 'right', start: '2026-11-14 01:10' }),
    ev({ type: 'feed', detail: 'left', start: '2026-11-14 04:00' }),
    ev({ type: 'feed', detail: 'left', start: '2026-11-14 08:00' }),
    ev({ type: 'feed', detail: 'right', start: '2026-11-13 22:00' }), // other day
    ev({ type: 'diaper', detail: 'wet', start: '2026-11-14 02:00' }),
    ev({ type: 'diaper', detail: 'wet', start: '2026-11-14 05:00' }),
    ev({ type: 'diaper', detail: 'poop', start: '2026-11-14 06:00' }),
    ev({ type: 'diaper', detail: 'both', start: '2026-11-14 07:00' }),
    ev({ type: 'diaper', detail: 'wet', start: '2026-11-14 09:00', deleted: true }),
    ev({ type: 'vitamin_d', start: '2026-11-14 08:10' }),
    // sleeps: one crossing midnight into the day, one inside, one open until now
    ev({ type: 'sleep', start: '2026-11-13 23:00', end: '2026-11-14 00:30' }),
    ev({ type: 'sleep', start: '2026-11-14 02:00', end: '2026-11-14 03:00' }),
    ev({ type: 'sleep', start: '2026-11-14 11:00' }),
  ];

  it('summarises feeds, diapers, vitamin and sleep', () => {
    const s = dailySummary(events, '2026-11-14', now, 20);
    expect(s.feeds.count).toBe(3); // 01:00+01:10 merged, 04:00, 08:00
    expect(s.feeds.left).toBe(3);
    expect(s.feeds.right).toBe(1);
    expect(s.feeds.gapMin).toBe((180 + 240) / 2);
    expect(s.diapers).toEqual({ wet: 2, poop: 1, both: 1 });
    expect(s.vitaminD).toBe(true);
    // 00:00-00:30 (30) + 02:00-03:00 (60) + 11:00-12:00 open (60)
    expect(s.sleep.totalMin).toBe(150);
    expect(s.sleep.longestMin).toBe(60);
  });

  it('splits a sleep crossing midnight between the two days', () => {
    const yesterday = dailySummary(events, '2026-11-13', now, 20);
    expect(yesterday.sleep.totalMin).toBe(60); // 23:00-24:00
    expect(yesterday.vitaminD).toBe(false);
    expect(yesterday.feeds.gapMin).toBeNull();
  });

  it('the gap between feeds is the median: one forgotten feed does not stretch it (owner)', () => {
    const day = [
      ev({ type: 'feed', detail: 'left', start: '2026-11-14 01:00' }),
      ev({ type: 'feed', detail: 'right', start: '2026-11-14 03:00' }),
      ev({ type: 'feed', detail: 'left', start: '2026-11-14 05:00' }),
      // the 07:00 feed was not logged: a 4-hour gap
      ev({ type: 'feed', detail: 'right', start: '2026-11-14 09:00' }),
    ];
    // gaps 120, 120, 240: the mean would be 160 (2:40), the median stays 2:00
    expect(dailySummary(day, '2026-11-14', now, 20).feeds.gapMin).toBe(120);
  });

  it('does not count future time of an open sleep', () => {
    const e = [ev({ type: 'sleep', start: '2026-11-14 10:00' })];
    expect(dailySummary(e, '2026-11-14', T('2026-11-14 10:30'), 20).sleep.totalMin).toBe(30);
    expect(dailySummary(e, '2026-11-15', T('2026-11-14 10:30'), 20).sleep.totalMin).toBe(0);
  });

  it('ignores sleep rows without a start', () => {
    const e = [ev({ type: 'sleep', end: '2026-11-14 05:00' })];
    expect(dailySummary(e, '2026-11-14', now, 20).sleep.totalMin).toBe(0);
  });

  it('finds vitamin D by local date', () => {
    expect(vitaminDOnDate(events, '2026-11-14')).toBeDefined();
    expect(vitaminDOnDate(events, '2026-11-13')).toBeUndefined();
  });
});

describe('formatting', () => {
  it('formats elapsed time as H:MM', () => {
    expect(elapsedHM(0)).toBe('0:00');
    expect(elapsedHM(45 * 60_000)).toBe('0:45');
    expect(elapsedHM((2 * 60 + 10) * 60_000)).toBe('2:10');
    expect(elapsedHM(-5)).toBe('0:00');
    expect(elapsedHM(26 * 3_600_000)).toBe('26:00');
  });

  it('formats a clock time', () => {
    expect(clock(T('2026-11-14 03:12'))).toBe('3:12');
    expect(clock(T('2026-11-14 13:05'))).toBe('13:05');
  });
});

describe('sleep: a forgotten wake-up and overlapping sleeps (owner)', () => {
  const now = T('2026-11-14 12:00');
  const open = (start: string) => ev({ id: 'open', type: 'sleep', start });
  const done = (id: string, start: string, end: string) => ev({ id, type: 'sleep', start, end });

  it('an open sleep longer than 6 hours, with no longer sleep this week, is a forgotten wake-up', () => {
    expect(forgottenWake([open('2026-11-14 06:30')], now)).toBeNull(); // 5:30
    expect(forgottenWake([open('2026-11-14 05:59')], now)?.id).toBe('open'); // 6:01
  });

  it('a week with long night sleeps raises the bar to the longest one plus an hour', () => {
    const week = [done('n', '2026-11-12 21:00', '2026-11-13 04:30')]; // 7:30
    expect(forgottenWake([...week, open('2026-11-14 03:31')], now)).toBeNull(); // 8:29
    expect(forgottenWake([...week, open('2026-11-14 03:29')], now)?.id).toBe('open'); // 8:31
    // a sleep from more than a week ago does not count
    expect(forgottenWake([done('old', '2026-11-01 20:00', '2026-11-02 06:00'), open('2026-11-14 05:00')], now)?.id).toBe('open');
  });

  it('no open sleep: nothing to say', () => {
    expect(forgottenWake([done('a', '2026-11-13 20:00', '2026-11-14 06:00')], now)).toBeNull();
  });

  it('finds another sleep that overlaps, an open one lasting until now, never the sleep itself', () => {
    const list = [done('a', '2026-11-14 01:00', '2026-11-14 03:00'), open('2026-11-14 11:00')];
    const at = (s: string) => T(`2026-11-14 ${s}`);
    expect(overlappingSleep(list, at('02:30'), at('04:00'), now)?.id).toBe('a');
    expect(overlappingSleep(list, at('03:00'), at('04:00'), now)).toBeUndefined(); // touching is fine
    expect(overlappingSleep(list, at('11:30'), at('11:45'), now)?.id).toBe('open');
    expect(overlappingSleep(list, at('00:30'), at('02:00'), now, 'a')).toBeUndefined();
  });
});

describe('the next side when both sides were pressed in the same minute', () => {
  it('the press entered later decides (sides switched quickly)', () => {
    const left = ev({ id: 'l', type: 'feed', detail: 'left', start: '2026-11-14 10:00' });
    const right = ev({ id: 'r', type: 'feed', detail: 'right', start: '2026-11-14 10:00' });
    expect(lastFeed([left, right])?.id).toBe('r');
    expect(nextSide([left, right])).toBe('left');
    expect(nextSide([right, left])).toBe('right');
  });
});

