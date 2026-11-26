import { beforeEach, describe, expect, it } from 'vitest';
import { type Deps, handle } from '../src/server/core';
import { MemoryStore } from '../src/server/memory-store';
import { DEFAULT_VITAMIN_D } from '../src/shared/medicines';
import type { ApiOk, ApiResponse } from '../src/shared/protocol';
import { T, ev } from './helpers';

const KEY = 'test-key';
let now = T('2026-11-14 12:00');
let store: MemoryStore;
let deps: Deps;
let n = 0;

beforeEach(() => {
  now = T('2026-11-14 12:00');
  store = new MemoryStore();
  deps = { store, now: () => now, checkKey: (k) => k === KEY, withLock: (fn) => fn() };
});

const call = (req: Record<string, unknown>, key = KEY): ApiResponse => handle({ key, ...req }, deps);
const ok = (r: ApiResponse): ApiOk => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error} ${r.detail ?? ''}`);
  return r;
};
const id = () => `id${++n}`;
const log = (type: string, detail: string, start: string, extra: Record<string, unknown> = {}) =>
  call({ action: 'log', id: id(), type, detail, start, user: 'Parent 1', source: 'app', ...extra });
const minutesLater = (m: number) => {
  now += m * 60_000;
};

describe('auth and requests', () => {
  it('rejects a wrong or missing key', () => {
    expect(call({ action: 'ping' }, 'nope')).toEqual({ ok: false, error: 'unauthorized' });
    expect(handle({ action: 'ping' }, deps)).toEqual({ ok: false, error: 'unauthorized' });
  });
  it('rejects non-objects and unknown actions', () => {
    expect(handle('x', deps)).toEqual({ ok: false, error: 'bad_request' });
    expect(handle(null, deps)).toEqual({ ok: false, error: 'bad_request' });
    expect(call({ action: 'explode' })).toMatchObject({ ok: false, error: 'unknown_action' });
  });
  it('answers ping with version and server time', () => {
    expect(ok(call({ action: 'ping' }))).toMatchObject({ serverNow: '2026-11-14 12:00' });
  });
});

describe('log', () => {
  it('stores a feed and tells Siri the next side', () => {
    const r = ok(log('feed', 'left', '2026-11-14 12:00'));
    expect(r.speech).toBe('Logged left, 12:00. Next: right');
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({ created: '2026-11-14 12:00', edited: '', deleted: false, source: 'app' });
  });

  it('is idempotent on the request id', () => {
    const body = { action: 'log', id: 'same', type: 'diaper', detail: 'wet', start: '2026-11-14 12:00', user: 'Parent 1', source: 'siri' };
    ok(call(body));
    const again = ok(call(body));
    expect(again.duplicate).toBe(true);
    expect(store.all()).toHaveLength(1);
  });

  it.each([
    ['feed', 'middle'],
    ['feed', ''],
    ['diaper', 'left'],
    ['sleep', 'left'],
    ['vitamin_d', 'x'],
    ['nap', ''],
  ])('rejects invalid type/detail %s/%s', (type, detail) => {
    expect(log(type, detail, '2026-11-14 12:00')).toMatchObject({ ok: false, error: 'invalid_event' });
  });

  it('rejects malformed, nonexistent and far-future times', () => {
    expect(log('feed', 'left', 'yesterday')).toMatchObject({ ok: false, error: 'invalid_event' });
    expect(log('feed', 'left', '2026-03-27 02:30')).toMatchObject({ ok: false, error: 'invalid_event' });
    expect(log('feed', 'left', '2026-11-14 12:11')).toMatchObject({ ok: false, error: 'invalid_event' });
    expect(ok(log('feed', 'left', '2026-11-14 12:09'))).toBeTruthy(); // small clock skew is tolerated
  });

  it('validates user, source and sizes', () => {
    expect(log('feed', 'left', '2026-11-14 12:00', { user: '' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(log('feed', 'left', '2026-11-14 12:00', { user: 'x'.repeat(21) })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(log('feed', 'left', '2026-11-14 12:00', { source: 'web' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(log('feed', 'left', '2026-11-14 12:00', { note: 'x'.repeat(201) })).toMatchObject({ ok: false, error: 'bad_request' });
  });

  it('only sleep may have an end, and end cannot precede start', () => {
    expect(log('feed', 'left', '2026-11-14 11:00', { end: '2026-11-14 11:30' })).toMatchObject({ ok: false, error: 'invalid_event' });
    expect(log('sleep', '', '2026-11-14 10:00', { end: '2026-11-14 09:00' })).toMatchObject({ ok: false, error: 'invalid_event' });
    expect(ok(log('sleep', '', '2026-11-14 09:00', { end: '2026-11-14 10:00' }))).toBeTruthy();
  });

  it('warns but records a second vitamin D on the same day', () => {
    ok(log('vitamin_d', '', '2026-11-14 08:10'));
    const second = ok(log('vitamin_d', '', '2026-11-14 11:00'));
    expect(second.warning).toBe('vitamin_d_already_given');
    expect(second.speech).toBe('Vitamin D logged again. Already given today at 8:10');
    expect(store.all()).toHaveLength(2);
  });

  it('refuses a second open sleep', () => {
    ok(log('sleep', '', '2026-11-14 10:00'));
    expect(log('sleep', '', '2026-11-14 11:00')).toMatchObject({ ok: false, error: 'sleep_already_open' });
  });
});

describe('asleep / awake', () => {
  const asleep = (start: string, extra = {}) => call({ action: 'asleep', id: id(), user: 'Parent 1', source: 'siri', start, ...extra });
  const awake = (end: string, extra = {}) => call({ action: 'awake', id: id(), user: 'Parent 1', source: 'siri', end, ...extra });

  it('opens and closes one sleep row', () => {
    expect(ok(asleep('2026-11-14 10:35')).speech).toBe('Asleep at 10:35');
    minutesLater(0);
    const w = ok(awake('2026-11-14 12:00'));
    expect(w.speech).toBe('Awake. Slept 1 hour 25 minutes');
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({ start: '2026-11-14 10:35', end: '2026-11-14 12:00' });
  });

  it('does not open a second sleep', () => {
    ok(asleep('2026-11-14 10:35'));
    const again = ok(asleep('2026-11-14 11:00'));
    expect(again.noop).toBe(true);
    expect(again.speech).toBe('Already asleep since 10:35');
    expect(store.all()).toHaveLength(1);
  });

  it('creates an end-only row when awake arrives without an open sleep', () => {
    const w = ok(awake('2026-11-14 11:50'));
    expect(w.speech).toBe('Awake. Sleep length unknown');
    expect(store.all()[0]).toMatchObject({ type: 'sleep', start: '', end: '2026-11-14 11:50' });
  });

  it('treats a retried awake as a duplicate', () => {
    ok(asleep('2026-11-14 10:35'));
    ok(awake('2026-11-14 12:00'));
    const retry = ok(awake('2026-11-14 12:00'));
    expect(retry.duplicate).toBe(true);
    expect(store.all()).toHaveLength(1);
  });

  it('rejects a wake time before the sleep began', () => {
    ok(asleep('2026-11-14 10:35'));
    expect(awake('2026-11-14 10:00')).toMatchObject({ ok: false, error: 'invalid_event' });
  });

  it('is idempotent on the asleep request id', () => {
    const body = { action: 'asleep', id: 'a1', user: 'Parent 1', source: 'app', start: '2026-11-14 10:35' };
    ok(call(body));
    expect(ok(call(body)).duplicate).toBe(true);
    expect(store.all()).toHaveLength(1);
  });
});

describe('shortcut conventions', () => {
  it('treats "-" as no detail', () => {
    expect(ok(log('vitamin_d', '-', '2026-11-14 11:00')).event).toMatchObject({ type: 'vitamin_d', detail: '' });
    expect(log('feed', '-', '2026-11-14 11:00')).toMatchObject({ ok: false, error: 'invalid_event' });
  });

  it('accepts "start" as the wake-up time and ignores unrelated fields', () => {
    call({ action: 'asleep', id: 'a', user: 'P', source: 'siri', start: '2026-11-14 10:00', type: '-', detail: '-' });
    const w = ok(call({ action: 'awake', id: 'b', user: 'P', source: 'siri', start: '2026-11-14 11:30', type: '-', detail: '-' }));
    expect(w.speech).toBe('Awake. Slept 1 hour 30 minutes');
    expect(store.all()[0]).toMatchObject({ end: '2026-11-14 11:30' });
  });

  it('answers status when extra fields are present', () => {
    expect(ok(call({ action: 'status', id: 'x', user: 'P', source: 'siri', type: '-', detail: '-', start: '2026-11-14 12:00' })).speech).toBe('No feeds logged yet');
  });
});

describe('update, delete, restore', () => {
  it('edits fields, stamps edited and keeps created', () => {
    const e = ok(log('feed', 'left', '2026-11-14 11:00')).event!;
    minutesLater(30);
    const r = ok(call({ action: 'update', id: e.id, patch: { start: '2026-11-14 10:45', detail: 'right', note: 'sleepy' } }));
    expect(r.event).toMatchObject({ start: '2026-11-14 10:45', detail: 'right', note: 'sleepy', created: '2026-11-14 12:00', edited: '2026-11-14 12:30' });
  });

  it('refuses edits that make the event inconsistent', () => {
    const e = ok(log('feed', 'left', '2026-11-14 11:00')).event!;
    expect(call({ action: 'update', id: e.id, patch: { type: 'diaper' } })).toMatchObject({ ok: false, error: 'invalid_event' });
    expect(call({ action: 'update', id: e.id, patch: { start: 'bad' } })).toMatchObject({ ok: false, error: 'invalid_event' });
    expect(call({ action: 'update', id: 'ghost', patch: {} })).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('can reopen a sleep by clearing its end, but not while another is open', () => {
    const s = ok(log('sleep', '', '2026-11-14 09:00', { end: '2026-11-14 10:00' })).event!;
    expect(ok(call({ action: 'update', id: s.id, patch: { end: '' } })).event).toMatchObject({ end: '' });
    const s2 = ok(log('sleep', '', '2026-11-14 07:00', { end: '2026-11-14 08:00' })).event!;
    expect(call({ action: 'update', id: s2.id, patch: { end: '' } })).toMatchObject({ ok: false, error: 'sleep_already_open' });
  });

  it('soft-deletes and restores without removing the row', () => {
    const e = ok(log('diaper', 'wet', '2026-11-14 11:00')).event!;
    expect(ok(call({ action: 'delete', id: e.id })).event).toMatchObject({ deleted: true, edited: '2026-11-14 12:00' });
    expect(store.all()).toHaveLength(1);
    expect(ok(call({ action: 'delete', id: e.id })).noop).toBe(true);
    expect(ok(call({ action: 'restore', id: e.id })).event).toMatchObject({ deleted: false });
    expect(call({ action: 'delete', id: 'ghost' })).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('a deleted open sleep no longer counts as asleep', () => {
    const s = ok(call({ action: 'asleep', id: 's1', user: 'P', source: 'app', start: '2026-11-14 11:00' })).event!;
    ok(call({ action: 'delete', id: s.id }));
    expect(ok(call({ action: 'asleep', id: 's2', user: 'P', source: 'app', start: '2026-11-14 11:30' })).noop).toBeUndefined();
  });
});

describe('list and status', () => {
  it('returns events in range plus the open sleep and settings', () => {
    store = new MemoryStore([
      ev({ type: 'feed', detail: 'left', start: '2026-11-01 10:00' }),
      ev({ type: 'feed', detail: 'left', start: '2026-11-13 10:00' }),
      ev({ type: 'feed', detail: 'right', start: '2026-11-14 10:00' }),
      ev({ type: 'diaper', detail: 'wet', start: '2026-11-14 10:30', deleted: true }),
      ev({ type: 'sleep', start: '2026-11-10 23:00' }), // open, started before the range
    ]);
    deps = { ...deps, store };
    const r = ok(call({ action: 'list', from: '2026-11-13', to: '2026-11-14' }));
    expect(r.events!.map((e) => e.start)).toEqual(['2026-11-10 23:00', '2026-11-13 10:00', '2026-11-14 10:00']);
    expect(r.settings!.mergeWindowMin).toBe(20);
    expect(r.serverNow).toBe('2026-11-14 12:00');
  });

  it('includes a sleep that crosses into the range', () => {
    store = new MemoryStore([ev({ type: 'sleep', start: '2026-11-12 23:00', end: '2026-11-13 02:00' }), ev({ type: 'sleep', start: '2026-11-12 20:00', end: '2026-11-12 22:00' })]);
    deps = { ...deps, store };
    const r = ok(call({ action: 'list', from: '2026-11-13', to: '2026-11-13' }));
    expect(r.events).toHaveLength(1);
  });

  it('validates the range', () => {
    expect(call({ action: 'list', from: '2026-11-14', to: '2026-11-13' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(call({ action: 'list', from: 'x', to: 'y' })).toMatchObject({ ok: false, error: 'bad_request' });
  });

  it('answers the status question', () => {
    expect(ok(call({ action: 'status' })).speech).toBe('No feeds logged yet');
    ok(log('feed', 'left', '2026-11-14 09:50'));
    expect(ok(call({ action: 'status' })).speech).toBe('2 hours 10 minutes ago, left side. Next: right');
  });
});

describe('settings', () => {
  it('reads defaults and applies validated changes', () => {
    expect(ok(call({ action: 'settings' })).settings).toMatchObject({ mergeWindowMin: 20 });
    const r = ok(call({ action: 'settings', set: { babyName: ' Baby ', mergeWindowMin: 30, parents: ['A', 'B'] } }));
    expect(r.settings).toEqual({ babyName: 'Baby', mergeWindowMin: 30, parents: ['A', 'B'], medicines: [DEFAULT_VITAMIN_D] });
    expect(ok(call({ action: 'settings' })).settings).toEqual(r.settings);
  });
  it('rejects invalid settings', () => {
    for (const set of [{ mergeWindowMin: -1 }, { mergeWindowMin: 20.5 }, { mergeWindowMin: 999 }, { babyName: '' }, { parents: ['only one'] }, { parents: ['a', ''] }]) {
      expect(call({ action: 'settings', set })).toMatchObject({ ok: false, error: 'bad_request' });
    }
  });
});

describe('medicines (F7)', () => {
  const med = (over: Record<string, unknown> = {}) => ({ id: 'm1', name: ' אנטיביוטיקה ', dose: '5', doseUnit: 'מ״ל', schedule: 'interval', everyHours: 8, course: 'days', courseCount: 7, ...over });
  const save = (...changes: unknown[]) => call({ action: 'settings', set: { medicines: changes } });
  const meds = () => ok(call({ action: 'settings' })).settings!.medicines;

  it('vitamin D is there by default: active, once a day, ☀️, first in the list', () => {
    expect(meds()).toEqual([DEFAULT_VITAMIN_D]);
  });

  it('saves a medicine with server-side created time, trims text, a default icon, and clears numbers that do not fit the schedule', () => {
    const r = ok(save(med({ timesPerDay: 3, maxPerDay: 4 })));
    expect(r.settings!.medicines).toEqual([
      DEFAULT_VITAMIN_D,
      { id: 'm1', name: 'אנטיביוטיקה', icon: '💊', dose: '5', doseUnit: 'מ״ל', schedule: 'interval', timesPerDay: 0, everyHours: 8, minGapHours: 0, maxPerDay: 0, course: 'days', courseCount: 7, courseUntil: '', status: 'active', created: '2026-11-14 12:00' },
    ]);
  });

  it('saves medicines one by one: an edit keeps the others and the created time', () => {
    ok(save(med(), med({ id: 'm2', name: 'אקמול', icon: '🍓', schedule: 'prn', minGapHours: 4, maxPerDay: 4, course: 'none' })));
    minutesLater(30);
    const r = ok(save(med({ status: 'archived' })));
    expect(r.settings!.medicines.map((m) => [m.id, m.status, m.icon, m.created])).toEqual([
      ['vitamin_d', 'active', '☀️', ''],
      ['m1', 'archived', '💊', '2026-11-14 12:00'],
      ['m2', 'active', '🍓', '2026-11-14 12:00'],
    ]);
  });

  it('vitamin D can be edited like any medicine (its schedule too) and archived, never removed', () => {
    const r = ok(save({ ...DEFAULT_VITAMIN_D, dose: '400', doseUnit: 'יחב״ל', schedule: 'times', timesPerDay: 2, course: 'until', courseUntil: '2027-08-15', status: 'archived' }));
    expect(r.settings!.medicines[0]).toMatchObject({ id: 'vitamin_d', dose: '400', doseUnit: 'יחב״ל', schedule: 'times', timesPerDay: 2, course: 'until', courseUntil: '2027-08-15', status: 'archived', created: '2026-11-14 12:00' });
    expect(save({ id: 'vitamin_d', remove: true })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(log('medicine', 'vitamin_d', '2026-11-14 11:00')).toMatchObject({ ok: false, error: 'invalid_event' }); // its doses keep their own type
  });

  it('refuses invalid medicines and changes nothing', () => {
    for (const bad of [
      med({ name: '' }),
      med({ schedule: 'weekly' }),
      med({ schedule: 'times', timesPerDay: 1 }),
      med({ schedule: 'interval', everyHours: 0 }),
      med({ schedule: 'interval', everyHours: 1.1 }),
      med({ schedule: 'prn', maxPerDay: 30 }),
      med({ course: 'doses', courseCount: 0 }),
      med({ course: 'until', courseUntil: '15.8.2027' }),
      med({ doseUnit: 'kg' }),
      med({ dose: 'x'.repeat(41) }),
    ]) {
      expect(save(bad)).toMatchObject({ ok: false, error: 'bad_request' });
    }
    expect(meds()).toEqual([DEFAULT_VITAMIN_D]);
  });

  it('a dose is an event of type medicine naming a known medicine', () => {
    ok(save(med()));
    const r = ok(log('medicine', 'm1', '2026-11-14 11:00'));
    expect(r.event).toMatchObject({ type: 'medicine', detail: 'm1' });
    expect(log('medicine', 'nope', '2026-11-14 11:00')).toMatchObject({ ok: false, error: 'invalid_event', detail: 'unknown medicine' });
    expect(log('medicine', '', '2026-11-14 11:00')).toMatchObject({ ok: false, error: 'invalid_event' });
  });

  it('a medicine can be removed only before any dose was logged; archived ones keep their doses', () => {
    ok(save(med(), med({ id: 'm2', name: 'ב' })));
    ok(save({ id: 'm2', remove: true }));
    const e = ok(log('medicine', 'm1', '2026-11-14 11:00')).event!;
    expect(save({ id: 'm1', remove: true })).toMatchObject({ ok: false, error: 'bad_request' });
    ok(call({ action: 'delete', id: e.id })); // a deleted dose no longer blocks removal
    ok(save({ id: 'm1', remove: true }));
    expect(meds()).toEqual([DEFAULT_VITAMIN_D]);
  });

  it('a settings change without medicines leaves them alone', () => {
    ok(save(med()));
    ok(call({ action: 'settings', set: { babyName: 'B' } }));
    expect(meds()).toHaveLength(2);
  });
});

describe('concurrent-looking sequences stay consistent', () => {
  it('records both parents events from a shared id space', () => {
    ok(log('feed', 'left', '2026-11-14 11:00', { user: 'Parent 1' }));
    ok(log('feed', 'right', '2026-11-14 11:10', { user: 'Parent 2', source: 'siri' }));
    expect(store.all().map((e) => [e.user, e.source])).toEqual([['Parent 1', 'app'], ['Parent 2', 'siri']]);
  });
});

describe('data revision and polling', () => {
  const rev = () => ok(call({ action: 'poll' })).rev!;

  it('poll answers with a revision and ping includes it', () => {
    expect(rev()).toBe('0');
    expect(ok(call({ action: 'ping' })).rev).toBe('0');
  });

  it('every real write changes the revision, reads do not', () => {
    const r0 = rev();
    ok(call({ action: 'list', from: '2026-11-14', to: '2026-11-14' }));
    ok(call({ action: 'status' }));
    ok(call({ action: 'settings' }));
    expect(rev()).toBe(r0);

    const e = ok(log('feed', 'left', '2026-11-14 11:00')).event!;
    const r1 = rev();
    expect(r1).not.toBe(r0);
    ok(call({ action: 'update', id: e.id, patch: { note: 'x' } }));
    const r2 = rev();
    expect(r2).not.toBe(r1);
    ok(call({ action: 'delete', id: e.id }));
    const r3 = rev();
    expect(r3).not.toBe(r2);
    ok(call({ action: 'restore', id: e.id }));
    const r4 = rev();
    expect(r4).not.toBe(r3);
    ok(call({ action: 'settings', set: { babyName: 'B' } }));
    expect(rev()).not.toBe(r4);
  });

  it('writes that change nothing leave the revision alone', () => {
    const e = ok(log('feed', 'left', '2026-11-14 11:00')).event!;
    const after = rev();
    // duplicate request id
    ok(call({ action: 'log', id: e.id, type: 'feed', detail: 'left', start: '2026-11-14 11:00', user: 'P', source: 'app' }));
    // deleting twice, asleep while asleep
    ok(call({ action: 'delete', id: e.id }));
    const afterDelete = rev();
    ok(call({ action: 'delete', id: e.id }));
    ok(call({ action: 'asleep', id: 'sl1', user: 'P', source: 'app', start: '2026-11-14 10:00' }));
    const afterSleep = rev();
    ok(call({ action: 'asleep', id: 'sl2', user: 'P', source: 'app', start: '2026-11-14 10:30' }));
    expect(rev()).toBe(afterSleep);
    expect(afterDelete).not.toBe(after);
    expect(afterSleep).not.toBe(afterDelete);
  });

  it('rejected writes do not change the revision', () => {
    const r0 = rev();
    expect(log('feed', 'up', '2026-11-14 11:00')).toMatchObject({ ok: false });
    expect(call({ action: 'delete', id: 'ghost' })).toMatchObject({ ok: false });
    expect(rev()).toBe(r0);
  });

  it('list reports the revision it was read at', () => {
    log('feed', 'left', '2026-11-14 11:00');
    const l = ok(call({ action: 'list', from: '2026-11-14', to: '2026-11-14' }));
    expect(l.rev).toBe(rev());
  });

  it('poll needs the key like everything else', () => {
    expect(call({ action: 'poll' }, 'bad')).toEqual({ ok: false, error: 'unauthorized' });
  });
});

describe('sync: one round trip for a phone (API 0.4.0)', () => {
  const range = { from: '2026-11-01', to: '2026-11-14' };
  const feedOp = (i: string, detail = 'left') => ({ action: 'log', id: i, type: 'feed', detail, start: '2026-11-14 12:00', user: 'Parent 1', source: 'app' });
  const sync = (extra: Record<string, unknown> = {}) => ok(call({ action: 'sync', ...range, ...extra }));
  /** Counts data reads, to prove that "unchanged" touches no data at all. */
  const countReads = () => {
    let reads = 0;
    for (const m of ['all', 'recent', 'find', 'getSettings'] as const) {
      const orig = (store[m] as (...a: unknown[]) => unknown).bind(store);
      (store as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
        reads++;
        return orig(...a);
      };
    }
    return () => reads;
  };

  it('without a revision it answers like list', () => {
    log('feed', 'left', '2026-11-14 11:00');
    const r = sync();
    expect(r.events).toHaveLength(1);
    expect(r).toMatchObject({ rev: store.revision(), serverNow: '2026-11-14 12:00' });
    expect(r.settings?.medicines).toEqual([DEFAULT_VITAMIN_D]);
    expect(r.unchanged).toBeUndefined();
  });

  it('with the current revision it says "unchanged" and reads no data', () => {
    log('feed', 'left', '2026-11-14 11:00');
    const reads = countReads();
    const r = sync({ rev: store.revision() });
    expect(r).toEqual({ ok: true, rev: store.revision(), serverNow: '2026-11-14 12:00', unchanged: true });
    expect(reads()).toBe(0);
  });

  it('with an older revision it brings the list', () => {
    const rev = store.revision();
    log('feed', 'left', '2026-11-14 11:00');
    const r = sync({ rev });
    expect(r.unchanged).toBeUndefined();
    expect(r.events).toHaveLength(1);
    expect(r.rev).toBe(store.revision());
  });

  it("applies the phone's operations in order and answers each; nothing else changed means no list", () => {
    const rev = store.revision();
    const r = sync({ rev, ops: [feedOp('a'), { action: 'asleep', id: 's', user: 'Parent 1', source: 'app', start: '2026-11-14 12:00' }, { action: 'update', id: 'a', patch: { note: 'x' } }] });
    expect(r.unchanged).toBe(true);
    expect(r.events).toBeUndefined();
    expect(r.results).toHaveLength(3);
    expect(r.results!.map((x) => x.ok)).toEqual([true, true, true]);
    expect((r.results![2] as ApiOk).event).toMatchObject({ id: 'a', note: 'x' });
    expect((r.results![0] as ApiOk).speech).toBeUndefined(); // sentences are for Siri only
    expect(store.all().map((e) => e.id)).toEqual(['a', 's']);
    expect(r.rev).toBe(store.revision());
    expect(r.rev).not.toBe(rev);
    expect(sync({ rev: r.rev }).unchanged).toBe(true); // the phone is up to date with its own writes
  });

  it("brings the list when someone else wrote since the phone's revision", () => {
    const rev = store.revision();
    log('diaper', 'wet', '2026-11-14 11:30', { user: 'Parent 2' });
    const r = sync({ rev, ops: [feedOp('a')] });
    expect(r.unchanged).toBeUndefined();
    expect(r.events!.map((e) => e.type).sort()).toEqual(['diaper', 'feed']); // theirs and ours
    expect(r.results).toHaveLength(1);
  });

  it('a refused operation gets its error and the rest go on', () => {
    const r = sync({ rev: store.revision(), ops: [feedOp('a'), feedOp('bad', 'up'), { action: 'delete', id: 'ghost' }, feedOp('c', 'right')] });
    expect(r.results!.map((x) => (x.ok ? 'ok' : x.error))).toEqual(['ok', 'invalid_event', 'not_found', 'ok']);
    expect(store.all().map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('an unexpected failure stops the batch; what was done stays done and the revision moves', () => {
    const rev = store.revision();
    const append = store.append.bind(store);
    store.append = (e) => {
      if (e.id === 'b') throw new Error('sheet hiccup');
      append(e);
    };
    const r = sync({ rev, ops: [feedOp('a'), feedOp('b'), feedOp('c')] });
    expect(r.results!.map((x) => (x.ok ? 'ok' : x.error))).toEqual(['ok', 'server_error']);
    expect(store.all().map((e) => e.id)).toEqual(['a']);
    expect(store.revision()).not.toBe(rev);
  });

  it('sending the same batch again writes nothing twice and leaves the revision alone', () => {
    const ops = [feedOp('a'), { action: 'asleep', id: 's', user: 'Parent 1', source: 'app', start: '2026-11-14 12:00' }];
    const first = sync({ ops });
    const again = sync({ rev: first.rev, ops });
    expect(again.results!.map((x) => (x as ApiOk).duplicate)).toEqual([true, true]);
    expect(again).toMatchObject({ unchanged: true, rev: first.rev });
    expect(store.all()).toHaveLength(2);
  });

  it('saves settings and medicines inside a batch', () => {
    const r = sync({ rev: store.revision(), ops: [{ action: 'settings', set: { babyName: 'Baby' } }] });
    expect((r.results![0] as ApiOk).settings).toMatchObject({ babyName: 'Baby' });
    expect(store.getSettings().babyName).toBe('Baby');
  });

  it('takes the lock once for the whole batch and not at all without operations', () => {
    let locks = 0;
    deps.withLock = (fn) => {
      locks++;
      return fn();
    };
    sync({ rev: store.revision() });
    expect(locks).toBe(0);
    sync({ ops: [feedOp('a'), feedOp('b', 'right')] });
    expect(locks).toBe(1);
  });

  it('accepts only write actions, at most 25, and a valid range', () => {
    expect(ok(call({ action: 'sync', ...range, ops: [{ action: 'list', ...range }] })).results![0]).toMatchObject({ ok: false, error: 'bad_request' });
    expect(ok(call({ action: 'sync', ...range, ops: [{ action: 'settings' }] })).results![0]).toMatchObject({ ok: false, error: 'bad_request' });
    expect(ok(call({ action: 'sync', ...range, ops: ['x'] })).results![0]).toMatchObject({ ok: false, error: 'bad_request' });
    expect(call({ action: 'sync', ...range, ops: Array.from({ length: 26 }, (_, i) => feedOp(`m${i}`)) })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(call({ action: 'sync', ...range, ops: 'x' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(call({ action: 'sync', from: 'x', to: 'y' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(call({ action: 'sync', ...range }, 'nope')).toEqual({ ok: false, error: 'unauthorized' });
    expect(store.all()).toHaveLength(0);
  });

  // measured on the real server: looking an id up in the whole sheet costs 0.3 to 0.5 s per operation
  describe('fresh operations skip the slow duplicate lookup', () => {
    const finds = () => {
      let c = 0;
      const orig = store.find.bind(store);
      store.find = (i) => {
        c++;
        return orig(i);
      };
      return () => c;
    };
    it('a first attempt is not looked up in the whole sheet; a retry found among the recent rows is not either', () => {
      const count = finds();
      sync({ ops: [{ ...feedOp('a'), fresh: true }, { action: 'asleep', id: 's', user: 'Parent 1', source: 'app', start: '2026-11-14 12:00', fresh: true }, { action: 'awake', id: 'w', user: 'Parent 1', source: 'app', end: '2026-11-14 12:00', fresh: true }] });
      expect(count()).toBe(0);
      expect(store.all().map((e) => e.id)).toEqual(['a', 's']);
      const again = sync({ ops: [feedOp('a')] });
      expect(count()).toBe(0);
      expect((again.results![0] as ApiOk).duplicate).toBe(true);
    });
    it('even a wrongly "fresh" repeat is caught when the row is among the recent ones', () => {
      sync({ ops: [{ ...feedOp('a'), fresh: true }] });
      const again = sync({ ops: [{ ...feedOp('a'), fresh: true }, { action: 'asleep', id: 'a', user: 'Parent 1', source: 'app', start: '2026-11-14 12:00', fresh: true }] });
      expect(again.results!.map((x) => (x as ApiOk).duplicate)).toEqual([true, true]);
      expect(store.all()).toHaveLength(1);
    });
    // a sheet longer than the recent rows: 600 rows written a month ago
    const longSheet = () => {
      store = new MemoryStore(Array.from({ length: 600 }, (_, i) => ev({ id: `old${i}`, type: 'diaper', detail: 'wet', start: '2026-10-14 08:00', created: '2026-10-14 08:00' })));
      deps.store = store;
    };
    it('single requests (Siri, older apps) keep the full lookup on a long sheet', () => {
      longSheet();
      const count = finds();
      log('feed', 'left', '2026-11-14 11:00');
      expect(count()).toBe(1);
    });
    // Owner's sync log: an opening waited 1.1 s for the server to look a re-sent entry up in the whole sheet.
    it('a retry says when it was queued: when the recent rows reach back before that, no search; otherwise a search', () => {
      longSheet();
      const count = finds();
      const queuedAt = now - 60_000;
      const r = sync({ ops: [{ ...feedOp('n1'), queuedAt }] }); // sent before, never arrived
      expect([(r.results![0] as ApiOk).duplicate, count()]).toEqual([undefined, 0]);
      expect(sync({ ops: [{ ...feedOp('n1'), queuedAt }] }).results![0]).toMatchObject({ duplicate: true }); // it did arrive
      expect(count()).toBe(0);
      // queued long ago (before the oldest recent row): the whole sheet is searched, and an old row is found
      expect(sync({ ops: [{ ...feedOp('old3'), queuedAt: T('2026-10-01 08:00') }] }).results![0]).toMatchObject({ duplicate: true });
      expect(count()).toBe(1);
      sync({ ops: [feedOp('n2')] }); // an older app: no time given
      expect(count()).toBe(2);
    });
  });
});

// The sheet grows by some 25 rows a day for good; a list must not read all of it.
// Owner, after reading the sync log: a phone a little behind gets only what changed since its revision (API 0.5.0).
describe('sync: changes since your version', () => {
  const range = { from: '2026-11-01', to: '2026-11-14' };
  const sync = (extra: Record<string, unknown> = {}) => ok(call({ action: 'sync', ...range, ...extra }));
  const countReads = () => {
    let reads = 0;
    for (const m of ['all', 'recent', 'find', 'getSettings'] as const) {
      const orig = (store[m] as (...a: unknown[]) => unknown).bind(store);
      (store as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
        reads++;
        return orig(...a);
      };
    }
    return () => reads;
  };

  it('a phone a little behind gets only the changes, without reading any data', () => {
    log('feed', 'left', '2026-11-14 10:00');
    const mine = sync().rev!;
    const theirs = ok(log('diaper', 'wet', '2026-11-14 11:00')).event!;
    const reads = countReads();
    const r = sync({ rev: mine, delta: true });
    expect(r.changes).toEqual([theirs]);
    expect(r.events).toBeUndefined();
    expect(r.settings).toBeUndefined(); // they did not change
    expect(r.rev).toBe(store.revision());
    expect(reads()).toBe(0);
  });

  it('an app that does not ask for changes (an older one) still gets the list', () => {
    log('feed', 'left', '2026-11-14 10:00');
    const mine = sync().rev!;
    log('diaper', 'wet', '2026-11-14 11:00');
    const r = sync({ rev: mine });
    expect(r.changes).toBeUndefined();
    expect(r.events).toHaveLength(2);
  });

  it('edits, deletes and wake-ups arrive in their new state (a deleted one marked as such)', () => {
    const f = ok(log('feed', 'left', '2026-11-14 10:00')).event!;
    const d = ok(log('diaper', 'wet', '2026-11-14 10:30')).event!;
    ok(call({ action: 'asleep', id: 's1', user: 'Parent 2', source: 'app', start: '2026-11-14 10:40' }));
    const mine = sync().rev!;
    ok(call({ action: 'update', id: f.id, patch: { detail: 'right' } }));
    ok(call({ action: 'delete', id: d.id }));
    ok(call({ action: 'awake', id: 'w1', user: 'Parent 2', source: 'app', end: '2026-11-14 11:30' }));
    const r = sync({ rev: mine, delta: true });
    expect(r.changes!.map((e) => [e.id, e.detail, e.deleted, e.end])).toEqual([
      [f.id, 'right', false, ''],
      [d.id, 'wet', true, ''],
      ['s1', '', false, '2026-11-14 11:30'],
    ]);
  });

  it('settings changed on the other phone come along (only then)', () => {
    const mine = sync().rev!;
    ok(call({ action: 'settings', set: { babyName: 'New' } }));
    const r = sync({ rev: mine, delta: true });
    expect(r.changes).toEqual([]);
    expect(r.settings?.babyName).toBe('New');
  });

  it("the phone's own operations and the other phone's changes travel in one answer", () => {
    const mine = sync().rev!;
    const theirs = ok(log('diaper', 'wet', '2026-11-14 11:00')).event!;
    const r = sync({ rev: mine, delta: true, ops: [{ action: 'log', id: 'my1', type: 'feed', detail: 'left', start: '2026-11-14 11:50', user: 'Parent 1', source: 'app' }] });
    expect(r.results?.[0]).toMatchObject({ ok: true, event: { id: 'my1' } });
    expect(r.changes!.map((e) => e.id)).toEqual([theirs.id, 'my1']);
    expect(r.rev).toBe(store.revision());
    expect(sync({ rev: r.rev, delta: true }).unchanged).toBe(true);
  });

  it('when the journal cannot tell (too far behind, a revision it does not know, a write it was not told about): the list', () => {
    log('feed', 'left', '2026-11-14 10:00');
    const mine = sync().rev!;
    expect(sync({ rev: 'abc', delta: true }).events).toHaveLength(1);
    store.bump(); // a write that did not say what it changed
    log('diaper', 'wet', '2026-11-14 11:00');
    const r = sync({ rev: mine, delta: true });
    expect(r.changes).toBeUndefined();
    expect(r.events).toHaveLength(2);
  });
});

describe('a list reads only the tail of a long sheet', () => {
  /** `n` rows, 20 a day, in creation order, ending on 2026-11-14. */
  const fill = (n: number) => {
    const end = T('2026-11-14 11:00');
    for (let i = 0; i < n; i++) {
      const t = end - (n - 1 - i) * 72 * 60_000;
      const at = new Date(t + 2 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
      store.append(ev({ id: `r${i}`, type: 'diaper', detail: 'wet', start: at, created: at }));
    }
  };
  const reads = () => {
    const c = { all: 0, recent: 0 };
    const all = store.all.bind(store);
    const recent = store.recent.bind(store);
    store.all = () => (c.all++, all());
    store.recent = (k) => (c.recent++, recent(k));
    return c;
  };
  const list = (from: string, to: string) => ok(call({ action: 'list', from, to }));

  it('the last 14 days of a 5,000-row sheet come from the tail, and are the same events as a full read', () => {
    fill(5000);
    const expected = store.all().filter((e) => e.start >= '2026-11-01').map((e) => e.id);
    const c = reads();
    const r = list('2026-11-01', '2026-11-14');
    expect(c).toEqual({ all: 0, recent: 1 });
    expect(r.events!.map((e) => e.id)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(200);
  });

  it('an older range, or a short sheet, is read in full', () => {
    fill(5000);
    let c = reads();
    const old = list('2026-06-01', '2026-06-02');
    expect(c.all).toBe(1);
    expect(old.events!.length).toBeGreaterThan(30);
    store = new MemoryStore();
    deps.store = store;
    fill(300);
    c = reads();
    list('2026-11-01', '2026-11-14');
    expect(c).toEqual({ all: 1, recent: 0 });
  });

  it('a sheet that is not in creation order (sorted by hand) is read in full', () => {
    fill(5000);
    const rows = store.all().reverse();
    store = new MemoryStore(rows);
    deps.store = store;
    const c = reads();
    const r = list('2026-11-01', '2026-11-14');
    expect(c.all).toBe(1);
    expect(r.events!.length).toBeGreaterThan(200);
  });

  it('a sleep that began before the range and reaches into it is still included; an entry added late for an old day too', () => {
    fill(5000);
    store.append(ev({ id: 'late', type: 'feed', detail: 'left', start: '2026-11-02 08:00', created: '2026-11-14 11:30' }));
    const long = store.all().find((e) => e.start.startsWith('2026-10-31 2'))!;
    store.replace({ ...long, type: 'sleep', detail: '', end: '2026-11-01 05:00' });
    const ids = list('2026-11-01', '2026-11-14').events!.map((e) => e.id);
    expect(ids).toContain('late');
    expect(ids).toContain(long.id);
  });
});

describe('one step back after an edit (owner)', () => {
  it('an update keeps what the event was before it; a second update keeps the first edit', () => {
    const id0 = ok(log('feed', 'left', '2026-11-14 11:00')).event!.id;
    expect(store.find(id0)!.prev ?? '').toBe('');
    ok(call({ action: 'update', id: id0, patch: { start: '2026-11-14 10:40', note: 'x' } }));
    expect(JSON.parse(store.find(id0)!.prev!)).toEqual({ type: 'feed', detail: 'left', start: '2026-11-14 11:00', end: '', note: '' });
    ok(call({ action: 'update', id: id0, patch: { detail: 'right' } }));
    expect(JSON.parse(store.find(id0)!.prev!)).toMatchObject({ detail: 'left', start: '2026-11-14 10:40', note: 'x' });
  });
  it('a refused update changes nothing, "prev" included', () => {
    const id0 = ok(log('sleep', '', '2026-11-14 10:00')).event!.id;
    expect(call({ action: 'update', id: id0, patch: { end: '2026-11-14 09:00' } })).toMatchObject({ ok: false });
    expect(store.find(id0)!.prev ?? '').toBe('');
  });
});

describe("the baby's sex (owner: wording only)", () => {
  it('is stored, read back, and only boy or girl', () => {
    expect(ok(call({ action: 'settings' })).settings!.babySex).toBeUndefined(); // older sheets: none (the app says boy)
    expect(ok(call({ action: 'settings', set: { babySex: 'girl' } })).settings!.babySex).toBe('girl');
    expect(ok(call({ action: 'settings', set: { babyName: 'B' } })).settings!.babySex).toBe('girl'); // other changes keep it
    expect(call({ action: 'settings', set: { babySex: 'x' } })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(store.getSettings().babySex).toBe('girl');
  });
});

describe('usage counts (owner, F15)', () => {
  const day = (date: string, counts: Record<string, number>) => ({ date, counts });
  it('stores one row per day, parent and phone; a day sent again replaces its row', () => {
    ok(call({ action: 'usage', user: 'Parent 1', install: 'p1', version: 'abc1234', days: [day('2026-11-12', { open: 3, 'tab.summary': 1 }), day('2026-11-13', { open: 1 })] }));
    ok(call({ action: 'usage', user: 'Parent 2', install: 'p2', days: [day('2026-11-13', { 'log.wet': 2 })] }));
    ok(call({ action: 'usage', user: 'Parent 1', install: 'p1', days: [day('2026-11-13', { open: 4 })] })); // again: replaced
    const rows = store.usageAll();
    expect(rows.map((r) => `${r.date} ${r.user} ${JSON.stringify(r.counts)}`)).toEqual([
      '2026-11-12 Parent 1 {"open":3,"tab.summary":1}',
      '2026-11-13 Parent 1 {"open":4}',
      '2026-11-13 Parent 2 {"log.wet":2}',
    ]);
  });
  it("keeps each insight question's state for the day; skips questions it does not know, refuses unknown states", () => {
    ok(call({ action: 'usage', user: 'Parent 1', install: 'p1', days: [{ date: '2026-11-13', counts: { open: 1 }, states: { gaps: 'shown', night: 'off', sides: 'waiting', nextFeed: 'on' } }] }));
    expect(store.usageAll()[0]!.states).toEqual({ gaps: 'shown', night: 'off', sides: 'waiting', nextFeed: 'on' });
    // a question removed since (an older app still sends it): skipped, the rest of the day is kept
    ok(call({ action: 'usage', user: 'Parent 1', install: 'p1', days: [{ date: '2026-11-12', counts: { open: 2, 'seen.nosuch': 1 }, states: { nosuch: 'shown', gaps: 'on' } }] }));
    expect(store.usageAll().find((r) => r.date === '2026-11-12')).toMatchObject({ counts: { open: 2 }, states: { gaps: 'on' } });
    expect(call({ action: 'usage', user: 'Parent 1', install: 'p1', days: [{ date: '2026-11-13', counts: {}, states: { gaps: 'maybe' } }] })).toMatchObject({ ok: false, error: 'bad_request' });
  });

  it('is not log data: no lock, the revision does not move, nothing is answered but ok', () => {
    let locks = 0;
    deps = { ...deps, withLock: (fn) => (locks++, fn()) };
    const rev = store.revision();
    expect(call({ action: 'usage', user: 'Parent 1', install: 'p1', days: [day('2026-11-13', { open: 1 })] })).toEqual({ ok: true });
    expect(locks).toBe(0);
    expect(store.revision()).toBe(rev);
  });
  it('skips unknown counters; refuses bad numbers, bad dates, too many days, and is never part of a sync', () => {
    const bad = (days: unknown) => expect(call({ action: 'usage', user: 'Parent 1', install: 'p1', days })).toMatchObject({ ok: false, error: 'bad_request' });
    bad([day('2026-11-13', { open: -1 })]);
    bad([day('2026-11-13', { open: 1.5 })]);
    bad([day('13/11/2026', { open: 1 })]);
    bad([]);
    bad(Array.from({ length: 15 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, '0')}`, { open: 1 })));
    expect(call({ action: 'usage', install: 'p1', days: [day('2026-11-13', { open: 1 })] })).toMatchObject({ ok: false });
    expect(call({ action: 'usage', user: 'Parent 1', install: 'p1', days: [day('2026-11-13', { open: 1 })] }, 'wrong')).toMatchObject({ ok: false, error: 'unauthorized' });
    const r = ok(call({ action: 'sync', from: '2026-11-14', to: '2026-11-14', ops: [{ action: 'usage', user: 'Parent 1', install: 'p1', days: [day('2026-11-13', { open: 1 })] }] }));
    expect(r.results?.[0]).toMatchObject({ ok: false });
    expect(store.usageAll()).toEqual([]);
  });
});

describe("the baby's date of birth (owner)", () => {
  it('is stored, read back, kept by other changes, cleared with an empty value; only a real day from 2000 on', () => {
    expect(ok(call({ action: 'settings' })).settings!.babyBirth).toBeUndefined(); // older sheets: none
    expect(ok(call({ action: 'settings', set: { babyBirth: '2026-09-14' } })).settings!.babyBirth).toBe('2026-09-14');
    expect(ok(call({ action: 'settings', set: { babySex: 'girl' } })).settings!.babyBirth).toBe('2026-09-14');
    for (const bad of ['2026-02-30', '14/09/2026', '1999-12-31', 5, null]) {
      expect(call({ action: 'settings', set: { babyBirth: bad } })).toMatchObject({ ok: false, error: 'bad_request' });
    }
    expect(store.getSettings().babyBirth).toBe('2026-09-14');
    expect(ok(call({ action: 'settings', set: { babyBirth: '' } })).settings!.babyBirth).toBeUndefined();
  });
});

describe('bottles (F18, owner)', () => {
  it('a bottle is logged with its kind and amounts in the detail; a bad one is refused', () => {
    for (const detail of ['formula:90', 'expressed:120:30', 'formula:120:120']) {
      expect(call({ action: 'log', id: id(), type: 'bottle', detail, start: '2026-11-14 11:00', user: 'Parent 1', source: 'app' })).toMatchObject({ ok: true });
    }
    for (const detail of ['', 'formula', 'formula:0', 'milk:90', 'formula:90:100', 'formula:600', 'formula:90:', 'formula:9.5', 'formula:90:10:1']) {
      expect(call({ action: 'log', id: id(), type: 'bottle', detail, start: '2026-11-14 11:00', user: 'Parent 1', source: 'app' })).toMatchObject({ ok: false, error: 'invalid_event' });
    }
  });

  it('the feeding settings are stored whole and checked; older sheets have none (breastfeeding only)', () => {
    expect(ok(call({ action: 'settings' })).settings!.feeding).toBeUndefined();
    const f = { breast: true, expressed: false, formula: true, expressedMl: 60, formulaMl: 120 };
    expect(ok(call({ action: 'settings', set: { feeding: f } })).settings!.feeding).toEqual(f);
    expect(ok(call({ action: 'settings', set: { babySex: 'girl' } })).settings!.feeding).toEqual(f);
    for (const bad of [null, 5, { ...f, breast: 'yes' }, { ...f, formulaMl: 0 }, { ...f, expressedMl: 501 }, { ...f, formulaMl: 90.5 }, { breast: false, expressed: false, formula: false, expressedMl: 60, formulaMl: 90 }, { breast: true }]) {
      expect(call({ action: 'settings', set: { feeding: bad } })).toMatchObject({ ok: false, error: 'bad_request' });
    }
    expect(store.getSettings().feeding).toEqual(f);
  });
});

// Owner: Siri on the other parent's phone speaks Hebrew. A request with lang 'he' gets Hebrew sentences, in the baby's wording.
describe('Siri sentences in Hebrew', () => {
  const siri = (req: Record<string, unknown>) => ok(call({ user: 'Parent 2', source: 'siri', lang: 'he', ...req }));
  it('logs, sleep and the last feed answer in Hebrew; without lang it stays English', () => {
    expect(siri({ action: 'log', id: 'h1', type: 'feed', detail: 'right', start: '2026-11-14 11:50' }).speech).toBe('נרשמה הנקה ימין, 11:50. הבאה: שמאל');
    expect(ok(log('feed', 'left', '2026-11-14 11:55')).speech).toMatch(/^Logged left/);
    ok(call({ action: 'settings', set: { babySex: 'girl' } }));
    expect(siri({ action: 'asleep', id: 'h2', start: '2026-11-14 11:58' }).speech).toBe('נרדמה ב-11:58');
    expect(siri({ action: 'asleep', id: 'h3', start: '2026-11-14 11:59' }).speech).toBe('כבר מסומנת כישנה מ-11:58');
    minutesLater(30);
    expect(siri({ action: 'awake', id: 'h4', end: '2026-11-14 12:28' }).speech).toBe('התעוררה. ישנה 30 דקות');
    expect(siri({ action: 'status' }).speech).toBe('ההנקה האחרונה לפני 35 דקות, צד שמאל. הבאה: ימין');
    expect(siri({ action: 'next' }).speech).toBe('ההנקה הבאה: צד ימין'); // (owner) which side next
    expect(ok(call({ action: 'next' })).speech).toBe('Next: right side');
    expect(store.all().filter((e) => e.type === 'feed')).toHaveLength(2); // asking writes nothing
  });
});
