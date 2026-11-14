import { beforeEach, describe, expect, it } from 'vitest';
import { type Deps, handle } from '../src/server/core';
import { MemoryStore } from '../src/server/memory-store';
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
    expect(r.settings).toEqual({ babyName: 'Baby', mergeWindowMin: 30, parents: ['A', 'B'] });
    expect(ok(call({ action: 'settings' })).settings).toEqual(r.settings);
  });
  it('rejects invalid settings', () => {
    for (const set of [{ mergeWindowMin: -1 }, { mergeWindowMin: 20.5 }, { mergeWindowMin: 999 }, { babyName: '' }, { parents: ['only one'] }, { parents: ['a', ''] }]) {
      expect(call({ action: 'settings', set })).toMatchObject({ ok: false, error: 'bad_request' });
    }
  });
});

describe('concurrent-looking sequences stay consistent', () => {
  it('records both parents events from a shared id space', () => {
    ok(log('feed', 'left', '2026-11-14 11:00', { user: 'Parent 1' }));
    ok(log('feed', 'right', '2026-11-14 11:10', { user: 'Parent 2', source: 'siri' }));
    expect(store.all().map((e) => [e.user, e.source])).toEqual([['Parent 1', 'app'], ['Parent 2', 'siri']]);
  });
});
