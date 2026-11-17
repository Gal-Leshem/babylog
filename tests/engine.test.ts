import { DEFAULT_VITAMIN_D } from '../src/shared/medicines';
import { beforeEach, describe, expect, it } from 'vitest';
import { ACTIVE_FOR_MS, Engine, pollDelay } from '../src/app/engine';
import { memoryStorage } from '../src/app/storage';
import { type Deps, handle } from '../src/server/core';
import { MemoryStore } from '../src/server/memory-store';
import { formatLocal, localDate } from '../src/shared/tz';
import { safeToReload } from '../src/app/update';
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
  if (gate && (body.action === 'list' || body.action === 'sync')) {
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
    random: () => 0,
  });
  e.configure({ url: 'http://127.0.0.1/x', key, me: 'P1' });
  return e;
}

const nowStr = () => formatLocal(clock);
const feed = (id: string, detail = 'left') => ({ action: 'log' as const, id, type: 'feed' as const, detail, start: nowStr(), user: 'P1', source: 'app' as const });
const idle = () => new Promise((r) => setTimeout(r, 15));
/** The ids of the operations the server was sent, in order (inside `sync` batches or as single requests). */
const sentIds = () => seen.flatMap((x) => (x.action === 'sync' ? (x.ops ?? []) : x.action === 'list' || x.action === 'poll' ? [] : [x])).map((o: any) => o.id);
const syncs = () => seen.filter((x) => x.action === 'sync');

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
    expect(sentIds()).toEqual(['a', 'b', 'c']);
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

  it('a refresh takes pending operations along, so they are never overwritten by the list', async () => {
    offline = true;
    const e = makeEngine();
    e.dispatch(feed('a'));
    await idle();
    offline = false;
    seen = [];
    expect(await e.refresh()).toBe(true);
    expect(seen.map((x) => x.action)).toEqual(['sync']); // one request: the operation and the list
    expect(server.all().map((x) => x.id)).toEqual(['a']);
    expect(e.getState()).toMatchObject({ pending: 0 });
    expect(e.getState().events.map((x) => x.id)).toEqual(['a']);
  });

  it('a tap made while a list is on its way is never wiped by that (older) list', async () => {
    const e = makeEngine();
    answerEarly = true; // the server answers "empty" at once; the answer arrives only after we release it
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const slow = e.refresh();
    await idle();
    gate = null;
    answerEarly = false;
    e.dispatch(feed('a'));
    await idle();
    expect(e.getState().events.map((x) => x.id)).toEqual(['a']);
    release();
    await slow;
    expect(e.getState().events.map((x) => x.id)).toEqual(['a']); // the empty list arrived: the tap is still shown
    await idle();
    expect(server.all().map((x) => x.id)).toEqual(['a']); // and it was sent right after
    expect(e.getState()).toMatchObject({ pending: 0, status: 'idle' });
    expect(e.getState().events.map((x) => x.id)).toEqual(['a']);
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

  // F7: settings gained a "medicines" list. Phones still hold settings saved by the older app, and an older server sends none.
  it('settings saved by an older version or sent by an older server get vitamin D and no other medicines', async () => {
    storage.data.set('bl.state.v1', JSON.stringify({ serverEvents: [], queue: [], settings: { babyName: 'Baby', mergeWindowMin: 20, parents: ['A', 'B'] } }));
    expect(makeEngine().getState().settings.medicines).toEqual([DEFAULT_VITAMIN_D]);
    const oldServer = ((url: string, init: { body: string }) =>
      fetchImpl(url as never, init as never).then(async (r) => {
        const j = await r.json();
        if (j.settings) delete j.settings.medicines;
        return new Response(JSON.stringify(j));
      })) as unknown as typeof fetch;
    const e = new Engine({ storage: memoryStorage(), fetchImpl: oldServer, now: () => clock, newId: () => `op${++n}` });
    e.configure({ url: 'http://127.0.0.1/x', key: KEY, me: 'P1' });
    expect(await e.refresh()).toBe(true);
    expect(e.getState().settings.medicines).toEqual([DEFAULT_VITAMIN_D]);
  });

  it('shows the settings handed over at first-run setup before any refresh', () => {
    const e = new Engine({ storage, fetchImpl, now: () => clock });
    e.configure({ url: 'http://127.0.0.1/x', key: KEY, me: 'A' }, { babyName: 'Baby', mergeWindowMin: 25, parents: ['A', 'B'], medicines: [] });
    expect(e.getState().settings).toEqual({ babyName: 'Baby', mergeWindowMin: 25, parents: ['A', 'B'], medicines: [DEFAULT_VITAMIN_D] });
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
  /** How many answers carried the list (the heavy kind). */
  let lists = 0;
  const listCalls = () => lists;
  const counting = ((url: string, init: { body: string }) =>
    fetchImpl(url as never, init as never).then(async (r) => {
      const text = await r.text();
      try {
        if (Array.isArray(JSON.parse(text).events)) lists++;
      } catch {
        /* not JSON */
      }
      return new Response(text);
    })) as unknown as typeof fetch;
  const makeCounted = (store = storage) => {
    lists = 0;
    const e = new Engine({ storage: store, fetchImpl: counting, now: () => clock, newId: () => `op${++n}`, setTimer: (fn, ms) => timers.push({ fn, ms }), clearTimer: () => undefined });
    e.configure({ url: 'http://127.0.0.1/x', key: KEY, me: 'P1' });
    return e;
  };
  const theirFeed = (id: string) => server.append(ev({ id, type: 'feed', detail: 'right', start: '2026-11-14 11:00', user: 'P2' }));
  const bumped = () => server.bump(); // the real server bumps on every API write; here we write behind its back

  it('fetches the list only when the server revision changed, in the same single request', async () => {
    const e = makeCounted();
    await e.refresh();
    seen = [];
    lists = 0;
    expect(await e.pollOnce()).toBe(false);
    expect(await e.pollOnce()).toBe(false);
    expect([seen.length, listCalls()]).toEqual([2, 0]); // two tiny checks, no list

    theirFeed('x');
    bumped();
    seen = [];
    expect(await e.pollOnce()).toBe(true);
    expect([seen.length, listCalls()]).toEqual([1, 1]); // one round trip brought the news (not a check and then a list)
    expect(e.getState().events.map((v) => v.id)).toEqual(['x']);

    lists = 0;
    expect(await e.pollOnce()).toBe(false); // caught up again
    expect(listCalls()).toBe(0);
  });

  it('a tap is one request and brings no list when nothing else changed', async () => {
    const e = makeCounted();
    await e.refresh();
    seen = [];
    lists = 0;
    e.dispatch(feed('a'));
    await idle();
    expect(seen.map((x) => x.action)).toEqual(['sync']);
    expect(listCalls()).toBe(0);
    expect(e.getState()).toMatchObject({ pending: 0, status: 'idle' });
    expect(await e.pollOnce()).toBe(false); // and the revision we hold already includes our own write
    expect(listCalls()).toBe(0);
  });

  it("a tap brings the other parent's news in the same request", async () => {
    const e = makeCounted();
    await e.refresh();
    theirFeed('x');
    bumped();
    seen = [];
    e.dispatch(feed('a'));
    await idle();
    expect(seen.map((x) => x.action)).toEqual(['sync']);
    expect(e.getState().events.map((v) => v.id).sort()).toEqual(['a', 'x']);
  });

  it('taps made while a request is on its way travel together in the next one', async () => {
    const e = makeEngine();
    await e.refresh();
    seen = [];
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    e.dispatch(feed('a'));
    await idle();
    e.dispatch(feed('b', 'right'));
    e.dispatch({ action: 'log', id: 'c', type: 'diaper', detail: 'wet', start: nowStr(), user: 'P1', source: 'app' });
    gate = null;
    release();
    await idle();
    await idle();
    expect(syncs().map((x) => (x.ops ?? []).map((o: any) => o.id))).toEqual([['a'], ['b', 'c']]);
    expect(server.all().map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(e.getState()).toMatchObject({ pending: 0, status: 'idle' });
  });

  it('sends a long queue in batches of 25', async () => {
    offline = true;
    const e = makeEngine();
    for (let i = 0; i < 30; i++) e.dispatch({ action: 'log', id: `d${i}`, type: 'diaper', detail: 'wet', start: nowStr(), user: 'P1', source: 'app' });
    await idle();
    offline = false;
    seen = [];
    await e.flush();
    await idle();
    expect(syncs().map((x) => (x.ops ?? []).length)).toEqual([25, 5]);
    expect(server.all()).toHaveLength(30);
    expect(e.getState().pending).toBe(0);
  });

  it('remembers the revision across restarts: opening the app with nothing new is one tiny request', async () => {
    const first = makeCounted();
    theirFeed('x');
    await first.refresh();
    const reopened = makeCounted(); // same storage: the app was closed and opened again
    seen = [];
    await reopened.resume();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ action: 'sync', rev: server.revision() });
    expect(listCalls()).toBe(0);
    expect(reopened.getState().events.map((v) => v.id)).toEqual(['x']);
  });

  it("keeps the server's version of what it recorded", async () => {
    serverClock = clock + 60_000; // the server stamps its own time
    const e = makeEngine();
    await e.refresh();
    e.dispatch(feed('a'));
    await idle();
    expect(e.getState().events[0]).toMatchObject({ id: 'a', created: formatLocal(serverClock) });
  });

  it('an answer lost after the server applied the operations: sending again writes nothing twice', async () => {
    const e = makeEngine();
    await e.refresh();
    let lose = true;
    const lossy = ((url: string, init: { body: string }) =>
      fetchImpl(url as never, init as never).then((r) => {
        if (lose && JSON.parse(init.body).ops) {
          lose = false;
          throw new TypeError('connection lost');
        }
        return r;
      })) as unknown as typeof fetch;
    const l = new Engine({ storage, fetchImpl: lossy, now: () => clock, newId: () => `op${++n}`, setTimer: (fn, ms) => timers.push({ fn, ms }), clearTimer: () => undefined });
    offline = true;
    l.dispatch(feed('a'));
    l.dispatch({ action: 'asleep', id: 's', user: 'P1', source: 'app', start: nowStr() });
    await idle();
    offline = false;
    timers.shift()!.fn(); // the retry reaches the server, but its answer is lost on the way back
    await idle();
    expect(l.getState()).toMatchObject({ status: 'offline', pending: 2 });
    expect(server.all()).toHaveLength(2); // the server did record them
    timers.at(-1)!.fn(); // the next retry
    await idle();
    expect(server.all()).toHaveLength(2);
    expect(l.getState()).toMatchObject({ status: 'idle', pending: 0 });
    expect(l.getState().events).toHaveLength(2);
  });

  it('an operation the server failed on stays queued and is sent again', async () => {
    const e = makeEngine();
    await e.refresh();
    const append = server.append.bind(server);
    let fail = true;
    server.append = (x) => {
      if (fail && x.id === 'b') {
        fail = false;
        throw new Error('sheet hiccup');
      }
      append(x);
    };
    e.dispatch(feed('a'));
    e.dispatch(feed('b', 'right'));
    e.dispatch(feed('c'));
    await idle();
    await idle();
    expect(server.all().map((x) => x.id)).toEqual(['a']); // the batch stopped at the failure
    expect(e.getState()).toMatchObject({ status: 'error', pending: 2 });
    expect(e.getState().events).toHaveLength(3); // still shown
    timers.shift()!.fn();
    await idle();
    expect(server.all().map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(e.getState()).toMatchObject({ status: 'idle', pending: 0 });
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
    expect(sentIds()).toEqual(['mine']);
    expect(seen).toHaveLength(1);
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

  it('works against an older server that does not know "sync": single requests, a revision check, then the list', async () => {
    theirFeed('old');
    // a server from before API 0.4.0 answers "unknown_action" to sync
    const oldFetch = ((url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (body.action === 'sync') {
        seen.push(body);
        return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'unknown_action', detail: 'sync' })));
      }
      return fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    const legacy = new Engine({ storage: memoryStorage(), fetchImpl: oldFetch, now: () => clock, newId: () => `op${++n}` });
    legacy.configure({ url: 'http://127.0.0.1/x', key: KEY, me: 'P1' });
    expect(await legacy.pollOnce()).toBe(true);
    expect(legacy.getState().events.map((v) => v.id)).toEqual(['old']);
    expect(seen.map((x) => x.action)).toEqual(['sync', 'list']);

    seen = [];
    expect(await legacy.pollOnce()).toBe(false); // nothing new: only the small check, and `sync` is not tried again
    expect(seen.map((x) => x.action)).toEqual(['poll']);

    seen = [];
    legacy.dispatch(feed('mine'));
    await idle();
    expect(seen.map((x) => x.action)).toEqual(['log', 'list']);
    expect(server.all().map((x) => x.id).sort()).toEqual(['mine', 'old']);
    expect(legacy.getState()).toMatchObject({ pending: 0, status: 'idle' });
    expect(legacy.getState().events.map((v) => v.id).sort()).toEqual(['mine', 'old']);
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
    expect(syncs(), 'the remembered request must produce a second request').toHaveLength(2);
    expect(e.getState().events.map((v) => v.id)).toEqual(['late']); // ... but not forgotten: the new event arrives at once
  });

  it('resume() sends the queue first, otherwise refreshes', async () => {
    const e = makeEngine();
    theirFeed('r');
    await e.resume();
    expect(e.getState().events.map((v) => v.id)).toEqual(['r']);
  });
});

// Phase 2 / 3 of docs/REFACTOR_PLAN.md: the server's duplicate lookup is slow, and a tap followed by locking the phone must still arrive.
describe('first attempts, retries and leaving the app', () => {
  let beacons: Array<Record<string, any>>;
  let ticks: number;
  const make = (beaconOk = true) => {
    beacons = [];
    ticks = 0;
    const e = new Engine({
      storage,
      fetchImpl,
      now: () => clock,
      newId: () => `op${++n}`,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => undefined,
      stopwatch: () => (ticks += 5_000), // every look at the stopwatch is 5 s later
      beacon: (_ep, req) => {
        beacons.push(req as Record<string, any>);
        if (beaconOk) handle({ key: KEY, ...req }, deps()); // the browser delivers it; nobody reads the answer
        return beaconOk;
      },
    });
    e.configure({ url: 'http://127.0.0.1/x', key: KEY, me: 'P1' });
    return e;
  };
  const wire = () => syncs().flatMap((x) => x.ops ?? []);

  it('an operation says "fresh" only the first time it leaves the phone', async () => {
    const e = make();
    await e.refresh();
    garbage = true; // the request goes out, the answer is unusable
    e.dispatch(feed('a'));
    await idle();
    garbage = false;
    timers.at(-1)!.fn();
    await idle();
    expect(wire().map((o: any) => [o.id, o.fresh])).toEqual([['a', true], ['a', undefined]]);
    expect(server.all()).toHaveLength(1);
  });

  it('the "already sent" mark survives a restart (the app was killed while the request was on its way)', async () => {
    const e = make();
    await e.refresh();
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    e.dispatch(feed('a')); // on its way; the app is killed now
    await idle();
    const reopened = make(); // same storage
    gate = null;
    seen = [];
    await reopened.resume();
    expect(wire().map((o: any) => [o.id, o.fresh])).toEqual([['a', undefined]]);
    release();
    await idle();
    expect(server.all()).toHaveLength(1);
  });

  it('leaving the app with undelivered entries hands them to the browser; coming back writes nothing twice', async () => {
    const e = make();
    await e.refresh();
    offline = true;
    e.dispatch(feed('a'));
    e.dispatch({ action: 'asleep', id: 's', user: 'P1', source: 'app', start: nowStr() });
    await idle();
    offline = false; // the connection is back, but the phone is being locked before the retry
    expect(e.leave()).toBe(2);
    expect(beacons).toHaveLength(1);
    expect(beacons[0]).toMatchObject({ action: 'sync', rev: '0' }); // with the revision we hold: the server answers small
    expect(beacons[0]!.ops.map((o: any) => o.id)).toEqual(['a', 's']);
    expect(server.all().map((x) => x.id)).toEqual(['a', 's']); // delivered without the app
    expect(e.getState().pending).toBe(2); // nobody read an answer: still queued here

    seen = [];
    await e.resume(); // back in the app
    expect(wire().every((o: any) => o.fresh === undefined)).toBe(true);
    expect(server.all()).toHaveLength(2);
    expect(e.getState()).toMatchObject({ pending: 0, status: 'idle' });
    expect(e.getState().events).toHaveLength(2);
  });

  it('does not use the beacon for entries a request is already carrying, or when nothing waits', async () => {
    const e = make();
    await e.refresh();
    expect(e.leave()).toBe(0);
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    e.dispatch(feed('a')); // in flight (a keepalive request: the browser finishes it by itself)
    await idle();
    expect(e.leave()).toBe(0);
    expect(beacons).toHaveLength(0);
    gate = null;
    release();
    await idle();
    expect(server.all()).toHaveLength(1);
  });

  it('"hidden" and "page closing" together send one beacon; a refused beacon changes nothing', async () => {
    let now = 0;
    beacons = [];
    const e = new Engine({ storage, fetchImpl, now: () => clock, newId: () => `op${++n}`, setTimer: (fn, ms) => timers.push({ fn, ms }), clearTimer: () => undefined, stopwatch: () => now, beacon: (_ep, req) => (beacons.push(req as never), false) });
    e.configure({ url: 'http://127.0.0.1/x', key: KEY, me: 'P1' });
    offline = true;
    e.dispatch(feed('a'));
    await idle();
    now = 10_000;
    expect(e.leave()).toBe(0); // the browser refused it
    expect(e.leave()).toBe(0);
    expect(beacons).toHaveLength(1);
    now = 20_000;
    e.leave();
    expect(beacons).toHaveLength(2);
    offline = false;
    await e.flush();
    expect(server.all()).toHaveLength(1);
    expect(e.getState().pending).toBe(0);
  });

  it('requests that carry entries ask the browser to finish them even if the app is closed (keepalive)', async () => {
    const flags: Array<[boolean, boolean]> = [];
    const spy = ((url: string, init: { body: string; keepalive?: boolean }) => {
      flags.push([Boolean(JSON.parse(init.body).ops), init.keepalive === true]);
      return fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    const e = new Engine({ storage, fetchImpl: spy, now: () => clock, newId: () => `op${++n}` });
    e.configure({ url: 'http://127.0.0.1/x', key: KEY, me: 'P1' });
    await e.refresh();
    e.dispatch(feed('a'));
    await idle();
    expect(flags).toEqual([[false, false], [true, true]]);
  });
});

describe('pace', () => {
  it('checks every 5 s for two minutes after the app was opened or used, then every 15 s', () => {
    expect(pollDelay(0)).toBe(5_000);
    expect(pollDelay(ACTIVE_FOR_MS - 1)).toBe(5_000);
    expect(pollDelay(ACTIVE_FOR_MS)).toBe(15_000);
    expect(pollDelay(Infinity)).toBe(15_000); // never used yet
  });

  it('spreads retries by up to a fifth, so two phones do not come back in step', async () => {
    offline = true;
    const e = new Engine({ storage, fetchImpl, now: () => clock, newId: () => `op${++n}`, setTimer: (fn, ms) => timers.push({ fn, ms }), clearTimer: () => undefined, random: () => 0.5 });
    e.configure({ url: 'http://127.0.0.1/x', key: KEY, me: 'P1' });
    e.dispatch(feed('a'));
    await idle();
    expect(timers.map((t) => t.ms)).toEqual([3300]);
  });
});

// Phase 4 of docs/REFACTOR_PLAN.md
describe('client housekeeping', () => {
  it('a check that finds nothing new, or a status change, hands the screens the very same events and settings objects', async () => {
    const e = makeEngine();
    server.append(ev({ id: 'x', type: 'feed', detail: 'right', start: '2026-11-14 11:00', user: 'P2' }));
    await e.refresh();
    const before = e.getState();
    let notified = 0;
    e.subscribe(() => notified++);
    await e.pollOnce(); // nothing new
    offline = true;
    await e.pollOnce(); // status: offline
    offline = false;
    await e.pollOnce(); // status: idle again
    expect(notified).toBeGreaterThan(0);
    expect(e.getState().events).toBe(before.events);
    expect(e.getState().allEvents).toBe(before.allEvents);
    expect(e.getState().settings).toBe(before.settings);
    e.dispatch(feed('a'));
    expect(e.getState().events).not.toBe(before.events); // real changes still give new objects
    expect(e.getState().events.map((x) => x.id).sort()).toEqual(['a', 'x']);
  });

  it('at start, days from before the usual window are dropped from the stored copy (History fetches them again); an open sleep stays', async () => {
    const first = makeEngine();
    server.append(ev({ id: 'old', type: 'feed', detail: 'left', start: '2026-10-01 08:00' }));
    server.append(ev({ id: 'edge', type: 'feed', detail: 'left', start: '2026-10-31 08:00' })); // the day before the window: Summary compares with it
    server.append(ev({ id: 'new', type: 'feed', detail: 'left', start: '2026-11-14 08:00' }));
    server.append(ev({ id: 'open', type: 'sleep', start: '2026-09-01 10:00' }));
    await first.refresh();
    await first.ensureRange('2026-10-01', '2026-10-31');
    expect(first.getState().events.map((x) => x.id).sort()).toEqual(['edge', 'new', 'old', 'open']);
    const reopened = makeEngine(); // the app is opened again
    expect(reopened.getState().events.map((x) => x.id).sort()).toEqual(['edge', 'new', 'open']);
    expect(JSON.parse(storage.data.get('bl.state.v1')!).serverEvents.map((x: { id: string }) => x.id).sort()).toEqual(['edge', 'new', 'open']);
    await reopened.ensureRange('2026-10-01', '2026-10-01');
    expect(reopened.getState().events.map((x) => x.id)).toContain('old');
  });

  it('a new app version reloads the page only when nothing can be lost', () => {
    expect(safeToReload({ visible: false, formOpen: true, typing: true })).toBe(true); // in the background
    expect(safeToReload({ visible: true, formOpen: false, typing: false })).toBe(true);
    expect(safeToReload({ visible: true, formOpen: true, typing: false })).toBe(false);
    expect(safeToReload({ visible: true, formOpen: false, typing: true })).toBe(false);
  });
});

// Phase 5 of docs/REFACTOR_PLAN.md (the parts the owner chose)
describe('what the screens are told', () => {
  const theirs = (id: string, start = '2026-11-14 11:00') => {
    server.append(ev({ id, type: 'feed', detail: 'right', start, user: 'P2' }));
    server.bump();
  };

  it("marks entries that just arrived from the other phone, and only those", async () => {
    const e = makeEngine();
    theirs('first');
    await e.refresh(); // the very first load: nothing is "news"
    expect([...e.getState().arrived.ids]).toEqual([]);

    theirs('x');
    server.append(ev({ id: 'me-elsewhere', type: 'diaper', detail: 'wet', start: '2026-11-14 11:30', user: 'P1' })); // my own, e.g. through Siri
    server.append(ev({ id: 'old', type: 'feed', detail: 'left', start: '2026-11-10 08:00', user: 'P2' })); // added late for an old day
    server.bump();
    clock += 60_000;
    await e.pollOnce();
    expect([...e.getState().arrived.ids]).toEqual(['x']);
    expect(e.getState().arrived.at).toBe(clock);

    e.dispatch(feed('mine'));
    await idle();
    await e.refresh();
    expect([...e.getState().arrived.ids]).toEqual(['x']); // my own tap coming back in a list is not news
  });

  it('an older day loaded for History is not news', async () => {
    const e = makeEngine();
    await e.refresh();
    theirs('long-ago', '2026-10-01 08:00');
    await e.ensureRange('2026-10-01', '2026-10-01');
    expect(e.getState().events.map((x) => x.id)).toEqual(['long-ago']);
    expect([...e.getState().arrived.ids]).toEqual([]);
  });

  it('says "checking" from the moment the app is returned to until that first check is back; ordinary checks do not', async () => {
    const e = makeEngine();
    await e.refresh();
    clock += 10_000; // later: the app is returned to
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const back = e.returned();
    await idle();
    expect(e.getState().checking).toBe(true);
    gate = null;
    release();
    await back;
    expect(e.getState().checking).toBe(false);

    clock += 10_000;
    gate = new Promise<void>((r) => (release = r));
    const poll = e.pollOnce();
    await idle();
    expect(e.getState().checking).toBe(false);
    gate = null;
    release();
    await poll;

    offline = true; // and it never stays on after a failure
    clock += 10_000;
    await e.returned();
    expect(e.getState()).toMatchObject({ checking: false, status: 'offline' });
  });
});

