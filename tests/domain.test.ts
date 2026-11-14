import { describe, expect, it } from 'vitest';
import {
  clock,
  dailySummary,
  elapsedHM,
  feedGroups,
  lastFeed,
  nextSide,
  openSleep,
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
    expect(s.feeds.avgGapMin).toBe((180 + 240) / 2);
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
    expect(yesterday.feeds.avgGapMin).toBeNull();
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
