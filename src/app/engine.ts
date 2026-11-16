import { type Deps, handle } from '../server/core';
import { MemoryStore } from '../server/memory-store';
import { eventTime, live } from '../shared/domain';
import { withVitaminD } from '../shared/medicines';
import type { ApiRequest, ApiResponse } from '../shared/protocol';
import { addDays, dayStart, localDate } from '../shared/tz';
import { type BabyEvent, DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { type Endpoint, type FetchLike, NetworkError, callApi } from './api';
import type { Config } from './config';
import type { KV } from './storage';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'auth' | 'error';

export interface Op {
  opId: string;
  req: ApiRequest;
  at: number;
}

interface Persisted {
  serverEvents: BabyEvent[];
  settings: Settings;
  queue: Op[];
  lastSync: number | null;
  sheetUrl: string;
  /** The server data revision the stored copy corresponds to (kept across restarts, so opening the app can be one tiny request). */
  rev?: string | null;
}

/** How long the last exchange with the server took (shown under Settings > advanced). */
export interface SyncTiming {
  totalMs: number;
  /** Time the server reported for itself; null when it did not say. */
  serverMs: number | null;
  /** How many operations travelled in it. */
  ops: number;
  /** The answer carried the list (something had changed). */
  list: boolean;
}

export interface EngineState {
  configured: boolean;
  /** What to show: the last known server state with pending operations replayed on top. Deleted events excluded. */
  events: BabyEvent[];
  /** Same, but including soft-deleted rows (for restore flows). */
  allEvents: BabyEvent[];
  settings: Settings;
  pending: number;
  status: SyncStatus;
  lastSync: number | null;
  lastError: string | null;
  sheetUrl: string;
  timing: SyncTiming | null;
}

export type DispatchResult =
  | { ok: true; opId: string; event?: BabyEvent; warning?: string; noop?: boolean; duplicate?: boolean; queued: boolean }
  | { ok: false; error: string; detail?: string };

export interface EngineOptions {
  storage: KV;
  fetchImpl?: FetchLike;
  now?: () => number;
  newId?: () => string;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  /** A clock for measuring durations (not the app's time). */
  stopwatch?: () => number;
}

const STATE_KEY = 'bl.state.v1';
const CONFIG_KEY = 'bl.config.v1';
const RETRY_MS = [3_000, 6_000, 12_000, 30_000, 60_000];
/** How often an open app asks the server "did anything change?" (a very small request). */
export const POLL_MS = 10_000;
/** Full refresh even without a reported change, to catch edits made directly in the sheet. */
export const FULL_REFRESH_MS = 5 * 60_000;
/** A sync that has been running this long is considered dead and no longer blocks new ones. */
const SYNC_STALE_MS = 30_000;
/**
 * Opening the app fires several "I am back" events within a few milliseconds (page shown, focus, visible): one that arrives this
 * soon after a sync started is the same wish, not a new one. Kept short on purpose: anything later is queued, never dropped.
 */
const COALESCE_MS = 400;
/** Operations per request (the server refuses more). */
const MAX_OPS = 25;
export const HISTORY_DAYS = 14;

const defaultId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function localDeps(store: MemoryStore, now: () => number): Deps {
  return { store, now, checkKey: () => true, withLock: (fn) => fn() };
}

/** Settings saved by an older app version, or sent by an older server, lack newer fields (e.g. `medicines`). */
export function withDefaults(s: Partial<Settings> | null | undefined): Settings {
  if (!s || typeof s !== 'object') return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...s, medicines: withVitaminD(Array.isArray(s.medicines) ? s.medicines : []) };
}

export class Engine {
  private readonly storage: KV;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;

  private config: Config | null;
  private p: Persisted;
  private status: SyncStatus = 'idle';
  private lastError: string | null = null;
  private listeners = new Set<() => void>();
  private snapshot: EngineState;

  /** Recently deleted events (memory only), so an undo can bring one back after the server stopped listing it. */
  private tombstones = new Map<string, BabyEvent>();
  /** One exchange with the server at a time. */
  private syncing = false;
  private syncStartedAt = -Infinity;
  private syncSeq = 0;
  /** A sync was requested while one was running: run another one as soon as that one ends (never drop the request). */
  private again: false | 'rev' | 'full' = false;
  /** Operations travelling in the running request (they can no longer be dropped by an undo). */
  private inFlight = new Set<string>();
  /** Bumped whenever the stored server copy changes, so a slower answer for an older day can tell it is out of date. */
  private epoch = 0;
  /** The server does not know `sync` (an older deployment): talk to it the old way for this session. */
  private legacy = false;
  private timing: SyncTiming | null = null;
  private readonly stopwatch: () => number;
  private retryTimer: unknown = null;
  private retryStep = 0;

  constructor(opts: EngineOptions) {
    this.storage = opts.storage;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? defaultId;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.stopwatch = opts.stopwatch ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.config = this.storage.get<Config>(CONFIG_KEY);
    const saved = this.storage.get<Persisted>(STATE_KEY);
    this.p = {
      serverEvents: Array.isArray(saved?.serverEvents) ? saved!.serverEvents : [],
      settings: withDefaults(saved?.settings),
      queue: Array.isArray(saved?.queue) ? saved!.queue : [],
      lastSync: saved?.lastSync ?? null,
      sheetUrl: saved?.sheetUrl ?? '',
      rev: typeof saved?.rev === 'string' ? saved.rev : null,
    };
    this.snapshot = this.compute();
  }

  // ---------- subscription ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = (): EngineState => this.snapshot;
  getConfig = (): Config | null => this.config;

  private emit(): void {
    this.snapshot = this.compute();
    for (const l of this.listeners) l();
  }

  private persist(): void {
    this.storage.set(STATE_KEY, this.p);
  }

  private compute(): EngineState {
    const store = new MemoryStore(this.p.serverEvents, this.p.settings);
    const deps = localDeps(store, this.now);
    for (const op of this.p.queue) handle({ key: '', ...op.req }, deps);
    const allEvents = store.all();
    return {
      configured: this.config !== null,
      events: live(allEvents),
      allEvents,
      settings: store.getSettings(),
      pending: this.p.queue.length,
      status: this.status,
      lastSync: this.p.lastSync,
      lastError: this.lastError,
      sheetUrl: this.p.sheetUrl,
      timing: this.timing,
    };
  }

  private setStatus(s: SyncStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.emit();
    }
  }

  // ---------- configuration ----------

  /** Stores the connection. `settings` (if known, e.g. from first-run setup) are shown until the first refresh. */
  configure(cfg: Config, settings?: Settings): void {
    if (this.config && (this.config.url !== cfg.url || this.config.key !== cfg.key)) this.p.rev = null; // another server: its revisions mean nothing here
    this.config = cfg;
    this.storage.set(CONFIG_KEY, cfg);
    if (settings) {
      this.p.settings = withDefaults(settings);
      this.persist();
    }
    this.status = 'idle';
    this.emit();
  }

  clearError(): void {
    this.lastError = null;
    this.emit();
  }

  setMe(me: string): void {
    if (!this.config) return;
    this.configure({ ...this.config, me });
  }

  /** Forget the connection and all cached data (pending operations are lost). */
  reset(): void {
    this.config = null;
    this.p = { serverEvents: [], settings: DEFAULT_SETTINGS, queue: [], lastSync: null, sheetUrl: '', rev: null };
    this.legacy = false;
    this.storage.remove(CONFIG_KEY);
    this.storage.remove(STATE_KEY);
    this.lastError = null;
    this.status = 'idle';
    this.emit();
  }

  // ---------- operations ----------

  /**
   * Applies an operation locally right away (optimistic) and queues it for the server.
   * Returns the local outcome, which is exactly what the server would answer.
   */
  dispatch(req: ApiRequest): DispatchResult {
    if (req.action === 'restore' && !this.p.serverEvents.some((e) => e.id === req.id)) {
      const tomb = this.tombstones.get(req.id);
      if (tomb) this.p.serverEvents.push({ ...tomb, deleted: true });
      this.snapshot = this.compute();
    }
    const store = new MemoryStore(this.snapshot.allEvents, this.snapshot.settings);
    const r: ApiResponse = handle({ key: '', ...req }, localDeps(store, this.now));
    if (!r.ok) return { ok: false, error: r.error, detail: r.detail };
    if (r.duplicate || r.noop) return { ok: true, opId: '', event: r.event, noop: r.noop, duplicate: r.duplicate, queued: false };
    if (req.action === 'delete' && r.event) {
      this.tombstones.set(req.id, r.event);
      if (this.tombstones.size > 50) this.tombstones.delete(this.tombstones.keys().next().value as string);
    }
    const op: Op = { opId: this.newId(), req, at: this.now() };
    this.p.queue.push(op);
    this.persist();
    this.emit();
    void this.sync('rev');
    return { ok: true, opId: op.opId, event: r.event, warning: r.warning, queued: true };
  }

  /**
   * Takes back an operation: if it has not been sent yet it is simply dropped,
   * otherwise the inverse operation is sent.
   */
  undo(opId: string, inverse: ApiRequest): DispatchResult {
    const i = this.p.queue.findIndex((o) => o.opId === opId);
    if (i >= 0 && !this.inFlight.has(opId)) {
      this.p.queue.splice(i, 1);
      this.persist();
      this.emit();
      return { ok: true, opId: '', queued: false };
    }
    return this.dispatch(inverse);
  }

  // ---------- talking to the server ----------

  private endpoint(): Endpoint | null {
    return this.config ? { url: this.config.url, key: this.config.key } : null;
  }

  defaultRange(): { from: string; to: string } {
    const today = localDate(this.now());
    return { from: addDays(today, -(HISTORY_DAYS - 1)), to: today };
  }

  /**
   * The one exchange with the server: sends whatever is waiting and learns whether anything else changed.
   * 'rev' sends the revision we hold (the usual case: the answer is tiny when nothing changed); 'full' always fetches the list.
   * `soft` marks an "I am back" event, which is dropped when a sync has only just started.
   * Returns true when new data arrived or operations were delivered.
   */
  private async sync(mode: 'rev' | 'full', soft = false): Promise<boolean> {
    const ep = this.endpoint();
    if (!ep) return false;
    const age = this.now() - this.syncStartedAt;
    if (soft && age >= 0 && age < COALESCE_MS && (this.syncing || this.status === 'idle')) return false; // the same return to the app, already served
    if (this.syncing && age < SYNC_STALE_MS) {
      if (this.again !== 'full') this.again = mode; // remembered: it may postdate what the running one will learn
      return false;
    }
    this.syncing = true;
    this.syncStartedAt = this.now();
    const seq = ++this.syncSeq;
    if (this.retryTimer) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
    let got = false;
    try {
      got = this.legacy ? await this.legacyExchange(ep, mode, seq) : await this.exchange(ep, mode, seq);
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      if (seq === this.syncSeq) {
        this.inFlight.clear();
        this.setStatus('offline');
        if (this.p.queue.length) this.scheduleRetry();
      }
    } finally {
      if (seq === this.syncSeq) {
        this.syncing = false;
        this.inFlight.clear();
        // A remembered request, a second batch, or taps made meanwhile. Not after a failure: the retry timer and the next check take over.
        const next = this.status === 'idle' || this.status === 'syncing' ? this.again || (this.p.queue.length ? 'rev' : false) : false;
        this.again = false;
        if (next) void this.sync(next);
      }
    }
    return got;
  }

  private async exchange(ep: Endpoint, mode: 'rev' | 'full', seq: number): Promise<boolean> {
    const batch = this.p.queue.slice(0, MAX_OPS);
    for (const op of batch) this.inFlight.add(op.opId);
    if (batch.length) this.setStatus('syncing');
    const range = this.defaultRange();
    const rev = mode === 'rev' && this.p.rev ? { rev: this.p.rev } : {};
    const t0 = this.stopwatch();
    // a check with nothing to send gives up sooner: the next one is seconds away
    const res = await callApi(ep, { action: 'sync', ...range, ...rev, ...(batch.length ? { ops: batch.map((o) => o.req) } : {}) }, this.fetchImpl, batch.length || mode === 'full' ? 20_000 : 10_000);
    if (seq !== this.syncSeq) return false; // declared dead meanwhile: a newer sync owns the state (anything sent is sent again; ids make that safe)
    if (!res.ok) {
      if (res.error === 'unknown_action') {
        this.legacy = true; // an older server: remembered for this session
        this.inFlight.clear();
        return this.legacyExchange(ep, mode, seq);
      }
      if (res.error === 'unauthorized') this.setStatus('auth');
      else {
        this.setStatus('error');
        if (this.p.queue.length) this.scheduleRetry();
      }
      return false;
    }
    this.timing = { totalMs: Math.round(this.stopwatch() - t0), serverMs: typeof res.ms === 'number' ? res.ms : null, ops: batch.length, list: !res.unchanged };

    // our operations, one answer each
    let failed = false;
    const results = res.results ?? [];
    batch.forEach((op, i) => {
      const r = results[i];
      if (!r || (!r.ok && r.error === 'server_error')) {
        failed = true; // not done: stays queued and is sent again
        return;
      }
      if (r.ok) {
        if (r.event) this.putServerEvent(r.event);
        if (r.settings) this.p.settings = withDefaults(r.settings);
      } else this.lastError = `${r.error}${r.detail ? `: ${r.detail}` : ''}`; // refused for good (invalid, not found, ...): drop it and say so
      const at = this.p.queue.findIndex((q) => q.opId === op.opId);
      if (at >= 0) this.p.queue.splice(at, 1);
    });

    // everything else that changed on the server
    if (!res.unchanged) {
      this.merge(range, res.events ?? []);
      if (res.settings) this.p.settings = withDefaults(res.settings);
      if (res.sheetUrl) this.p.sheetUrl = res.sheetUrl;
    }
    const changed = !res.unchanged || batch.length > 0 || res.rev !== this.p.rev;
    if (res.rev !== undefined) this.p.rev = res.rev;
    this.p.lastSync = this.now();
    this.retryStep = failed ? this.retryStep : 0;
    this.status = failed ? 'error' : 'idle';
    if (changed) {
      this.epoch++;
      this.persist(); // a check that found nothing new writes nothing (it runs every few seconds)
    }
    this.emit();
    if (failed) this.scheduleRetry();
    return !res.unchanged || batch.length > 0;
  }

  private putServerEvent(e: BabyEvent): void {
    const i = this.p.serverEvents.findIndex((x) => x.id === e.id);
    if (i >= 0) this.p.serverEvents[i] = e;
    else this.p.serverEvents.push(e);
  }

  /** The same exchange against a server from before `sync`: one request per operation, a revision check, then the list. */
  private async legacyExchange(ep: Endpoint, mode: 'rev' | 'full', seq: number): Promise<boolean> {
    let sent = 0;
    if (this.p.queue.length) this.setStatus('syncing');
    while (this.p.queue.length) {
      const op = this.p.queue[0]!;
      this.inFlight.add(op.opId);
      const res = await callApi(ep, op.req, this.fetchImpl);
      if (seq !== this.syncSeq) return false;
      this.inFlight.delete(op.opId);
      if (!res.ok && (res.error === 'unauthorized' || res.error === 'server_error')) {
        this.setStatus(res.error === 'unauthorized' ? 'auth' : 'error');
        if (res.error === 'server_error') this.scheduleRetry();
        return sent > 0;
      }
      if (res.ok) {
        const store = new MemoryStore(this.p.serverEvents, this.p.settings);
        handle({ key: '', ...op.req }, localDeps(store, this.now));
        this.p.serverEvents = store.all();
        this.p.settings = store.getSettings();
      } else this.lastError = `${res.error}${res.detail ? `: ${res.detail}` : ''}`;
      const at = this.p.queue.findIndex((q) => q.opId === op.opId);
      if (at >= 0) this.p.queue.splice(at, 1);
      this.epoch++;
      this.retryStep = 0;
      sent++;
      this.persist();
      this.emit();
    }
    if (mode === 'rev' && sent === 0 && this.p.rev) {
      const poll = await callApi(ep, { action: 'poll' }, this.fetchImpl, 8_000);
      if (seq !== this.syncSeq) return false;
      if (!poll.ok && poll.error === 'unauthorized') {
        this.setStatus('auth');
        return false;
      }
      if (poll.ok && poll.rev !== undefined && poll.rev === this.p.rev) {
        this.setStatus('idle');
        return false;
      }
    }
    const range = this.defaultRange();
    const queued = this.p.queue.length;
    const res = await callApi(ep, { action: 'list', from: range.from, to: range.to }, this.fetchImpl);
    if (seq !== this.syncSeq) return false;
    if (!res.ok) {
      this.setStatus(res.error === 'unauthorized' ? 'auth' : 'error');
      return sent > 0;
    }
    if (this.p.queue.length !== queued) return sent > 0; // taps made meanwhile are sent first; the list follows them
    this.merge(range, res.events ?? []);
    if (res.settings) this.p.settings = withDefaults(res.settings);
    if (res.sheetUrl) this.p.sheetUrl = res.sheetUrl;
    this.p.rev = res.rev ?? null;
    this.epoch++;
    this.p.lastSync = this.now();
    this.status = 'idle';
    this.persist();
    this.emit();
    return true;
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const ms = RETRY_MS[Math.min(this.retryStep, RETRY_MS.length - 1)]!;
    this.retryStep++;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      void this.sync('rev');
    }, ms);
  }

  /** Sends whatever is waiting (and learns what changed, in the same request). */
  async flush(): Promise<void> {
    if (this.p.queue.length) await this.sync('rev');
  }

  /**
   * Without a range: fetches the list from the server whatever revision we hold (pending operations travel along).
   * With a range (an older day in History or Summary): fetches those days and merges them into the local copy.
   */
  async refresh(range?: { from: string; to: string }): Promise<boolean> {
    if (!range) return this.sync('full');
    const ep = this.endpoint();
    if (!ep) return false;
    const startEpoch = this.epoch;
    try {
      const res = await callApi(ep, { action: 'list', from: range.from, to: range.to }, this.fetchImpl);
      if (!res.ok) {
        this.setStatus(res.error === 'unauthorized' ? 'auth' : 'error');
        return false;
      }
      if (startEpoch !== this.epoch) return false; // the local copy moved on meanwhile: that answer may be older than it
      this.merge(range, res.events ?? []);
      this.epoch++;
      this.persist();
      this.emit();
      return true;
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      this.setStatus('offline');
      return false;
    }
  }

  async ensureRange(from: string, to: string): Promise<void> {
    await this.refresh({ from, to });
  }

  private merge(range: { from: string; to: string }, fetched: BabyEvent[]): void {
    const lo = dayStart(range.from);
    const hi = dayStart(addDays(range.to, 1));
    const ids = new Set(fetched.map((e) => e.id));
    const kept = this.p.serverEvents.filter((e) => {
      if (ids.has(e.id)) return false;
      if (e.type === 'sleep' && e.start && !e.end) return false; // an open sleep not returned any more was closed or deleted
      const t = eventTime(e);
      return !(t >= lo && t < hi);
    });
    this.p.serverEvents = [...kept, ...fetched];
  }

  /**
   * The cheap check: one small request that says "nothing changed" or brings what did (and delivers anything waiting).
   * Returns true when new data was fetched or operations were delivered.
   */
  async pollOnce(): Promise<boolean> {
    return this.sync('rev');
  }

  /** Used on every return to the app: the same cheap exchange. */
  async resume(): Promise<void> {
    await this.sync('rev');
  }

  /**
   * Keeps the app current while it is open and visible: a cheap check every POLL_MS, a full refresh every
   * FULL_REFRESH_MS, and an immediate check whenever the app comes back to the foreground or the network returns
   * (the several events one return fires count as one). Nothing runs while the app is hidden. Returns a stop function.
   */
  start(): () => void {
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const resume = () => {
      if (visible()) void this.sync('rev', true);
    };
    const online = () => {
      if (visible()) void this.sync('rev'); // never coalesced: the running request may be the one that just failed
    };
    const poll = setInterval(() => {
      if (visible() && this.config) void this.sync('rev');
    }, POLL_MS);
    const full = setInterval(() => {
      if (visible()) void this.sync('full');
    }, FULL_REFRESH_MS);
    window.addEventListener('online', online);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      clearInterval(poll);
      clearInterval(full);
      window.removeEventListener('online', online);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }
}
