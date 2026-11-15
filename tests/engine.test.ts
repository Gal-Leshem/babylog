import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/app/engine';
import { memoryStorage } from '../src/app/storage';
import { type Deps, handle } from '../src/server/core';
import { MemoryStore } from '../src/server/memory-store';
import { formatLocal, localDate } from '../src/shared/tz';
import { T, ev } from './helpers';

const KEY = 'secret-key-123';

let clock: number;
let serverClock: number;
let storage: ReturnType<typeof memoryStorage>;
let server: MemoryStore;
let offline: boolean;
let garbage: boolean;
let timers: { fn: () => void; ms: number }[];
let gate: Promise<void> | null;
let answerEarly: boolean; // compute a held list answer BEFORE the gate opens (a real server answers at request time)
let seen: Array<Record<string, any>>;
let n: number;

const deps = (): Deps => ({ store: server, now: () => serverClock, checkKey: (k) => k === KEY, withLock: (f) => f() });

const fetchImpl = (async (_url: string, init: { body: string }) => {
  if (offline) throw new TypeError('Failed to fetch');
  const body = JSON.parse(init.body);
  seen.push(body);
  if (gate && body.action === 'list') {
    if (answerEarly) {
      const early = JSON.stringify(handle(body, deps()));
      await gate;
      return new Response(early, { status: 200 });
    }
    await gate;
  }
  if (garbage) return new Response('<html>Sign in</html>', { status: 200 });
  return new Response(JSON.stringify(handle(body, deps())), { status: 200 });
}) as unknown as typeof fetch;

function makeEngine(key = KEY, store = storage): Engine {
  const e = new Engine({
    storage: store,
    fetchImpl,
    now: () => clock,
    newId: () => `op${++n}`,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  e.configure({ url: 'http://127.0.0.1/x', key, me: 'P1' });
  return e;
}

const nowStr = () => formatLocal(clock);
const feed = (id: string, detail = 'left') => ({ action: 'log' as const, id, type: 'feed' as const, detail, start: nowStr(), user: 'P1', source: 'app' as const });
const idle = () => new Promise((r) => setTimeout(r, 15));

beforeEach(() => {
  clock = T('2026-11-14 12:00');
  serverClock = clock;
  storage = memoryStorage();
  server = new MemoryStore();
  offline = false;
  garbage = false;
  timers = [];
  gate = null;
  answerEarly = false;
  seen = [];
  n = 0;
});

describe('optimistic updates and sending', () => {
  it('shows the event at once and delivers it to the server', async () => {
    const e = makeEngine();
    const r = e.dispatch(feed('a'));
    expect(r.ok && r.queued).toBe(true);
    expect(e.getState().events.map((x) => x.id)).toEqual(['a']); // visible before any network answer
    await idle();
    expect(server.all().map((x) => x.id)).toEqual(['a']);
    expect(e.getState().pending).toBe(0);
    expect(e.getState().status).toBe('idle');
  });

  it('sends operations in order', async () => {
    const e = makeEngine();
    e.dispatch(feed('a'));
    e.dispatch({ action: 'log', id: 'b', type: 'diaper', detail: 'wet', start: nowStr(), user: 'P1', source: 'app' });
    e.dispatch({ action: 'asleep', id: 'c', user: 'P1', source: 'app', start: nowStr() });
    await idle();
    expect(seen.filter((x) => x.action !== 'list').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(server.all()).toHaveLength(3);
  });

  it('rejects invalid input locally without queueing it', () => {
    const e = makeEngine();
    const r = e.dispatch({ ...feed('a'), detail: 'up' });
    expect(r).toMatchObject({ ok: false, error: 'invalid_event' });
    expect(e.getState().pending).toBe(0);
  });

  it('does not queue no-ops such as falling asleep while asleep', async () => {
    const e = makeEngine();
    e.dispatch({ action: 'asleep', id: 's1', user: 'P1', source: 'app', start: nowStr() });
    const second = e.dispatch({ action: 'asleep', id: 's2', user: 'P1', source: 'app', start: nowStr() });
    expect(second).toMatchObject({ ok: true, noop: true, queued: false });
    await idle();
    expect(server.all()).toHaveLength(1);
  });

  it('applies settings changes locally and on the server', async () => {
    const e = makeEngine();
    e.dispatch({ action: 'settings', set: { babyName: 'Baby', mergeWindowMin: 30 } });
    expect(e.getState().settings.babyName).toBe('Baby');
    await idle();
    expect(server.getSettings()).toMatchObject({ babyName: 'Baby', mergeWindowMin: 30 });
  });
});

describe('no connection', () => {
  it('keeps working offline, persists the queue and syncs when back', async () => {
    offline = true;
    const e = makeEngine();
    e.dispatch(feed('a'));
    e.dispatch({ action: 'log', id: 'b', type: 'diaper', detail: 'poop', start: nowStr(), user: 'P1', source: 'app' });
    await idle();
    expect(e.getState()).toMatchObject({ status: 'offline', pending: 2 });
    expect(e.getState().events).toHaveLength(2);
    expect(timers).toHaveLength(1); // a retry is scheduled

    // the app is closed and reopened: the queue survives
    const reopened = makeEngine();
    expect(reopened.getState().pending).toBe(2);
    expect(reopened.getState().events.map((x) => x.id).sort()).toEqual(['a', 'b']);

    offline = false;
    await reopened.flush();
    expect(server.all().map((x) => x.id)).toEqual(['a', 'b']);
    expect(reopened.getState()).toMatchObject({ status: 'idle', pending: 0 });
  });

  it('backs off between retries and retries on its own', async () => {
    offline = true;
    const e = makeEngine();
    e.dispatch(feed('a'));
    await idle();
    expect(timers.map((t) => t.ms)).toEqual([3000]);
    timers.shift()!.fn(); // retry fires, still offline
    await idle();
    expect(timers.at(-1)!.ms).toBe(6000);
    offline = false;
    timers.shift()!.fn();
    await idle();
    expect(server.all()).toHaveLength(1);
    expect(e.getState().pending).toBe(0);
  });

  it('treats a non-API page (e.g. a sign-in page) as a connection problem and keeps the queue', async () => {
    garbage = true;
    const e = makeEngine();
    e.dispatch(feed('a'));
    await idle();
    expect(e.getState()).toMatchObject({ status: 'offline', pending: 1 });
    garbage = false;
    await e.flush();
    expect(server.all()).toHaveLength(1);
  });
});

describe('server answers', () => {
  it('stops and reports a wrong key without losing the queue', async () => {
    const e = makeEngine('wrong-key-xxxxxx');
    e.dispatch(feed('a'));
    await idle();
    expect(e.getState()).toMatchObject({ status: 'auth', pending: 1 });
    expect(server.all()).toHaveLength(0);
  });

  it('drops an operation the server refuses for good, and says why', async () => {
    serverClock = clock - 30 * 60_000; // server clock behind: this start looks like the future there
    const e = makeEngine();
    e.dispatch(feed('a'));
    e.dispatch({ action: 'log', id: 'b', type: 'diaper', detail: 'wet', start: formatLocal(clock - 45 * 60_000), user: 'P1', source: 'app' });
    await idle();
    expect(server.all().map((x) => x.id)).toEqual(['b']);
    expect(e.getState().pending).toBe(0);
    expect(e.getState().lastError).toMatch(/invalid_event/);
  });
});

describe('undo', () => {
  it('drops a queued operation so the server never sees it', async () => {
    offline = true;
    const e = makeEngine();
    const r = e.dispatch(feed('a'));
    if (!r.ok) throw new Error('dispatch failed');
    await idle(); // the send attempt failed (offline); the operation waits in the queue
    expect(e.getState().pending).toBe(1);
    e.undo(r.opId, { action: 'delete', id: 'a' });
    expect(e.getState().events).toHaveLength(0);
    expect(e.getState().pending).toBe(0);
    offline = false;
    await e.flush();
    expect(server.all()).toHaveLength(0);
  });

  it('sends the inverse when the operation is already on its way', async () => {
    const e = makeEngine();
    const r = e.dispatch(feed('a')); // the send starts immediately
    if (!r.ok) throw new Error('dispatch failed');
    e.undo(r.opId, { action: 'delete', id: 'a' }); // too late to cancel: the inverse follows it
    expect(e.getState().events).toHaveLength(0);
    await idle();
    expect(server.all()[0]).toMatchObject({ id: 'a', deleted: true });
  });

  it('sends the inverse when the operation already went through', async () => {
    const e = makeEngine();
    const r = e.dispatch(feed('a'));
    if (!r.ok) throw new Error('dispatch failed');
    await idle();
    expect(server.all()).toHaveLength(1);
    e.undo(r.opId, { action: 'delete', id: 'a' });
    expect(e.getState().events).toHaveLength(0);
    await idle();
    expect(server.all()[0]).toMatchObject({ id: 'a', deleted: true });
  });

  it('can restore an event after the delete was sent and the server list no longer returns it', async () => {
    const e = makeEngine();
    e.dispatch(feed('a'));
    await idle();
    e.dispatch({ action: 'delete', id: 'a' });
    await idle();
    await e.refresh(); // the server does not list deleted rows, so the local copy forgets it
    expect(e.getState().allEvents.some((x) => x.id === 'a')).toBe(false);
    const r = e.dispatch({ action: 'restore', id: 'a' });
    expect(r).toMatchObject({ ok: true });
    expect(e.getState().events.map((x) => x.id)).toEqual(['a']); // visible at once
    await idle();
    expect(server.all()[0]).toMatchObject({ id: 'a', deleted: false });
    await e.refresh();
    expect(e.getState().events.map((x) => x.id)).toEqual(['a']);
  });

  it('refuses to restore something it never knew', () => {
    const e = makeEngine();
    expect(e.dispatch({ action: 'restore', id: 'ghost' })).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('can restore a deleted event', async () => {
    const e = makeEngine();
    e.dispatch(feed('a'));
    await idle();
    e.dispatch({ action: 'delete', id: 'a' });
    expect(e.getState().events).toHaveLength(0);
    e.dispatch({ action: 'restore', id: 'a' });
    expect(e.getState().events).toHaveLength(1);
    await idle();
    expect(server.all()[0]).toMatchObject({ deleted: false });
  });
});

describe('refreshing', () => {
  it("shows the other parent's events and forgets deleted ones", async () => {
    const e = makeEngine();
    server.append(ev({ id: 'x', type: 'feed', detail: 'right', start: '2026-11-14 11:00', user: 'P2' }));
    expect(await e.refresh()).toBe(true);
    expect(e.getState().events.map((x) => x.id)).toEqual(['x']);
    server.replace({ ...server.find('x')!, deleted: true });
    await e.refresh();
    expect(e.getState().events).toHaveLength(0);
  });

  it('notices when the other parent closed an open sleep', async () => {
    const e = makeEngine();
    server.append(ev({ id: 's', type: 'sleep', start: '2026-11-14 10:00' }));
    await e.refresh();
    expect(e.getState().events[0]).toMatchObject({ end: '' });
    server.replace({ ...server.find('s')!, end: '2026-11-14 11:00' });
    await e.refresh();
    expect(e.getState().events[0]).toMatchObject({ end: '2026-11-14 11:00' });
  });

  it('forgets an open sleep that was deleted elsewhere, even if it began before the window', async () => {
    const e = makeEngine();
    server.append(ev({ id: 's', type: 'sleep', start: '2026-10-01 10:00' }));
    await e.refresh();
    expect(e.getState().events).toHaveLength(1);
    server.replace({ ...server.find('s')!, deleted: true });
    await e.refresh();
    expect(e.getState().events).toHaveLength(0);
  });

  it('does not refresh while operations are pending (so they are never overwritten)', async () => {
    offline = true;
    const e = makeEngine();
    e.dispatch(feed('a'));
    await idle();
    offline = false;
    expect(await e.refresh()).toBe(false);
    expect(e.getState().events.map((x) => x.id)).toEqual(['a']);
  });

  it('discards a stale answer when something was sent meanwhile', async () => {
    const e = makeEngine();
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const slow = e.refresh(); // server answers "empty" but only after we release it
    await idle();
    gate = null;
    e.dispatch(feed('a'));
    await idle();
    release();
    expect(await slow).toBe(false);
    expect(e.getState().events.map((x) => x.id)).toEqual(['a']); // not wiped by the stale answer
  });

  it('loads older days on demand without dropping newer ones', async () => {
    const e = makeEngine();
    server.append(ev({ id: 'old', type: 'feed', detail: 'left', start: '2026-10-01 08:00' }));
    server.append(ev({ id: 'new', type: 'feed', detail: 'left', start: '2026-11-14 08:00' }));
    await e.refresh();
    expect(e.getState().events.map((x) => x.id)).toEqual(['new']);
    await e.ensureRange('2026-10-01', '2026-10-01');
    expect(e.getState().events.map((x) => x.id).sort()).toEqual(['new', 'old']);
  });

  it('uses a 14-day default window ending today', () => {
    const e = makeEngine();
    expect(e.defaultRange()).toEqual({ from: '2026-11-01', to: localDate(clock) });
  });
});

describe('robustness', () => {
  it('ignores corrupt stored data', () => {
    storage.data.set('bl.state.v1', '{"queue": "oops"');
    const e = makeEngine();
    expect(e.getState().events).toEqual([]);
    storage.data.set('bl.state.v1', JSON.stringify({ queue: 5, serverEvents: 'x' }));
    expect(makeEngine().getState().pending).toBe(0);
  });

  it('shows the settings handed over at first-run setup before any refresh', () => {
    const e = new Engine({ storage, fetchImpl, now: () => clock });
    e.configure({ url: 'http://127.0.0.1/x', key: KEY, me: 'A' }, { babyName: 'Baby', mergeWindowMin: 25, parents: ['A', 'B'] });
    expect(e.getState().settings).toEqual({ babyName: 'Baby', mergeWindowMin: 25, parents: ['A', 'B'] });
    expect(new Engine({ storage, fetchImpl, now: () => clock }).getState().settings.parents).toEqual(['A', 'B']); // persisted
  });

  it('forgets everything on reset', async () => {
    const e = makeEngine();
    e.dispatch(feed('a'));
    await idle();
    e.reset();
    expect(e.getState()).toMatchObject({ configured: false, pending: 0, events: [] });
    expect(storage.data.size).toBe(0);
  });

  it('notifies subscribers on changes', () => {
    const e = makeEngine();
    let calls = 0;
    const off = e.subscribe(() => calls++);
    e.dispatch(feed('a'));
    expect(calls).toBeGreaterThan(0);
    off();
  });
});

describe('polling for changes made on the other phone', () => {
  const listCalls = () => seen.filter((x) => x.action === 'list').length;
  const pollCalls = () => seen.filter((x) => x.action === 'poll').length;
  const theirFeed = (id: string) => server.append(ev({ id, type: 'feed', detail: 'right', start: '2026-11-14 11:00', user: 'P2' }));
  const bumped = () => server.bump(); // the real server bumps on every API write; here we write behind its back

  it('fetches the list only when the server revision changed', async () => {
    const e = makeEngine();
    await e.refresh();
    seen = [];
    expect(await e.pollOnce()).toBe(false);
    expect(await e.pollOnce()).toBe(false);
    expect([pollCalls(), listCalls()]).toEqual([2, 0]); // two tiny checks, no list

    theirFeed('x');
    bumped();
    expect(await e.pollOnce()).toBe(true);
    expect(listCalls()).toBe(1);
    expect(e.getState().events.map((v) => v.id)).toEqual(['x']);

    seen = [];
    expect(await e.pollOnce()).toBe(false); // caught up again
    expect(listCalls()).toBe(0);
  });

  it('picks up a change that arrives between the check and the fetch on the next check', async () => {
    const e = makeEngine();
    await e.refresh();
    theirFeed('a');
    bumped();
    await e.pollOnce();
    theirFeed('b'); // lands after we fetched
    bumped();
    expect(await e.pollOnce()).toBe(true);
    expect(e.getState().events.map((v) => v.id).sort()).toEqual(['a', 'b']);
  });

  it('flushes the queue instead of polling when there is something to send', async () => {
    offline = true;
    const e = makeEngine();
    e.dispatch(feed('mine'));
    await idle();
    offline = false;
    seen = [];
    await e.pollOnce();
    expect(seen.map((x) => x.action)[0]).toBe('log');
    expect(server.all().map((x) => x.id)).toContain('mine');
  });

  it('clears the offline state as soon as a check succeeds', async () => {
    const e = makeEngine();
    await e.refresh();
    offline = true;
    await e.pollOnce();
    expect(e.getState().status).toBe('offline');
    offline = false;
    await e.pollOnce();
    expect(e.getState().status).toBe('idle');
  });

  it('works against an older server that does not know "poll" by refreshing fully', async () => {
    const e = makeEngine();
    theirFeed('old');
    // an older server answers "unknown_action" to poll
    const oldFetch = ((url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (body.action === 'poll') return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'unknown_action', detail: 'poll' })));
      return fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    const legacy = new Engine({ storage: memoryStorage(), fetchImpl: oldFetch, now: () => clock, newId: () => `op${++n}` });
    legacy.configure({ url: 'http://127.0.0.1/x', key: KEY, me: 'P1' });
    expect(await legacy.pollOnce()).toBe(true);
    expect(legacy.getState().events.map((v) => v.id)).toEqual(['old']);
    expect(e.getState().events).toEqual([]);
  });

  it('stops and reports a wrong key', async () => {
    const e = makeEngine('wrong-key-xxxxxx');
    await e.pollOnce();
    expect(e.getState().status).toBe('auth');
  });

  it('a refresh stuck on a dead connection does not block later ones', async () => {
    const e = makeEngine();
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const stuck = e.refresh(); // never answers (the phone was asleep)
    await idle();
    gate = null;
    expect(await e.refresh()).toBe(false); // still considered running: not started twice
    clock += 31_000; // half a minute later it is declared dead
    theirFeed('fresh');
    expect(await e.refresh()).toBe(true);
    expect(e.getState().events.map((v) => v.id)).toEqual(['fresh']);
    release(); // the old answer finally arrives and is ignored
    expect(await stuck).toBe(false);
    expect(e.getState().events.map((v) => v.id)).toEqual(['fresh']);
  });

  it('a refresh requested while one is running is not lost: it runs right after', async () => {
    const e = makeEngine();
    answerEarly = true;
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const first = e.refresh(); // in flight; the server already answered "nothing yet" and the answer is on its way
    await idle();
    gate = null;
    answerEarly = false;
    theirFeed('late'); // something new appears on the server after that answer was produced
    expect(await e.refresh()).toBe(false); // refused now (already running) ...
    release();
    await first;
    await idle();
    await idle();
    expect(listCalls(), 'the remembered request must produce a second list request').toBe(2);
    expect(e.getState().events.map((v) => v.id)).toEqual(['late']); // ... but not forgotten: the new event arrives at once
  });

  it('resume() sends the queue first, otherwise refreshes', async () => {
    const e = makeEngine();
    theirFeed('r');
    await e.resume();
    expect(e.getState().events.map((v) => v.id)).toEqual(['r']);
  });
});
