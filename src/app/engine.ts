import { type Deps, handle } from '../server/core';
import { MemoryStore } from '../server/memory-store';
import { eventTime, live } from '../shared/domain';
import { withVitaminD } from '../shared/medicines';
import type { ApiRequest, ApiResponse } from '../shared/protocol';
import { addDays, dayStart, localDate } from '../shared/tz';
import { type BabyEvent, DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { type Endpoint, type FetchLike, NetworkError, callApi, sendAway } from './api';
import type { Config } from './config';
import { FAMILIES_KEY } from './families';
import type { KV } from './storage';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'auth' | 'error';

export interface Op {
  opId: string;
  req: ApiRequest;
  at: number;
  /** It may already have reached the server (a request or a beacon left with it): from now on it is sent as a retry. */
  sent?: boolean;
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

/** Why a sync ran (for the sync log). */
export type SyncWhy = 'open' | 'return' | 'poll' | 'tap' | 'full' | 'retry' | 'online' | 'manual';

/**
 * One line of the sync log (owner: to see why the app is sometimes slow to catch up after opening). Kept on this phone only,
 * the last LOG_MAX; it holds times and sizes, never data.
 */
export interface SyncLogEntry {
  /** when the request finished (epoch ms) */
  at: number;
  why: SyncWhy;
  result: 'ok' | 'offline' | 'timeout' | 'error' | 'auth';
  /** the request itself, as the phone saw it */
  totalMs: number;
  /** the part spent in the server's own code (null: unknown) */
  serverMs: number | null;
  /** where the server spent it (ms per kind of work, "<kind>#" = calls) */
  t?: Record<string, number>;
  /** for an open or a return: from that moment until the data was on screen (includes waiting for an earlier request) */
  sinceReturnMs?: number;
  /** the answer carried data (something had changed) */
  list?: boolean;
  /** ...only the changes since our revision, not the whole list */
  delta?: boolean;
  events?: number;
  kb?: number;
  ops?: number;
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
  /** The app was just opened or returned to and its first check is still on its way: what is shown may be a moment old. */
  checking: boolean;
  /** Entries that just arrived from the other phone (shown highlighted for a few seconds). */
  arrived: { ids: ReadonlySet<string>; at: number };
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
  /** Delivers a request with no answer expected, while the app is being left (default: the browser's beacon). */
  beacon?: (ep: Endpoint, req: ApiRequest) => boolean;
  /** 0..1, for spreading retries (default Math.random). */
  random?: () => number;
  /** A clock for measuring durations (not the app's time). */
  stopwatch?: () => number;
  /**
   * Told about every request this phone makes to the server (`writes`: entries it carries), for the usage counts that show how
   * much of the shared daily quota each family uses (owner). Must cost nothing: it only adds to counts in memory.
   */
  onRequest?: (writes: number) => void;
}

const STATE_KEY = 'bl.state.v1';
const LOG_KEY = 'bl.synclog.v1';
const LOG_MAX = 60;
const CONFIG_KEY = 'bl.config.v1';
const RETRY_MS = [3_000, 6_000, 12_000, 30_000, 60_000];
/**
 * How often an open app asks the server "did anything change?" (one small request that reads no data when nothing did).
 * Faster while the app is in use: right after it is opened or something is logged, the other parent is likely to log too.
 */
export const POLL_ACTIVE_MS = 5_000;
export const POLL_IDLE_MS = 15_000;
export const ACTIVE_FOR_MS = 2 * 60_000;
export const pollDelay = (sinceActiveMs: number): number => (sinceActiveMs < ACTIVE_FOR_MS ? POLL_ACTIVE_MS : POLL_IDLE_MS);
/** Full refresh even without a reported change, to catch edits made directly in the sheet. */
export const FULL_REFRESH_MS = 5 * 60_000;
/** How often the full-refresh clock is looked at (a look that comes much later than this means timers were frozen). */
const FULL_CHECK_MS = 30_000;
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
  /** A sync was requested while one was running: run another one as soon as that one ends (never dropped, except a timer check that an exchange which just succeeded already answered). */
  private again: false | 'rev' | 'full' = false;
  /** The remembered request was asked for by something other than the regular timer check (see `sync`). */
  private againKeep = false;
  /** When the whole list last arrived, or the app was last opened or returned to (the safety-net refresh counts from there). */
  private fullAt = 0;
  /** Operations travelling in the running request (they can no longer be dropped by an undo). */
  private inFlight = new Set<string>();
  /** Bumped whenever the stored server copy changes, so a slower answer for an older day can tell it is out of date. */
  private epoch = 0;
  /** The server does not know `sync` (an older deployment): talk to it the old way for this session. */
  private legacy = false;
  private timing: SyncTiming | null = null;
  /** the app was opened or returned to at this moment and its data is not on screen yet (for the sync log) */
  private returnAt: number | null = null;
  private opened = false;
  private log: SyncLogEntry[] = [];
  private checking = false;
  private arrived: { ids: ReadonlySet<string>; at: number } = { ids: new Set(), at: 0 };
  private lastBeaconAt = -Infinity;
  private readonly stopwatch: () => number;
  private readonly random: () => number;
  /** When the app was last opened, returned to, or used to log something (drives the polling pace). */
  private lastActive = -Infinity;
  private readonly beacon: (ep: Endpoint, req: ApiRequest) => boolean;
  private readonly onRequest: (writes: number) => void;
  private retryTimer: unknown = null;
  private retryStep = 0;

  constructor(opts: EngineOptions) {
    this.storage = opts.storage;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? defaultId;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.beacon = opts.beacon ?? sendAway;
    this.onRequest = opts.onRequest ?? (() => undefined);
    this.random = opts.random ?? Math.random;
    this.stopwatch = opts.stopwatch ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const savedLog = this.storage.get<SyncLogEntry[]>(LOG_KEY);
    this.log = Array.isArray(savedLog) ? savedLog.slice(-LOG_MAX) : [];
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
    this.prune();
    this.snapshot = this.compute();
  }

  /**
   * The stored copy only ever grew (older days fetched for History stayed for good), and all of it is parsed at every start
   * and copied at every change. At start, days from before the usual window are dropped; History fetches an older day again
   * when it is opened. An open sleep is kept whatever its age.
   */
  private prune(): void {
    const lo = dayStart(addDays(this.defaultRange().from, -1));
    const kept = this.p.serverEvents.filter((e) => (e.type === 'sleep' && e.start && !e.end) || !(eventTime(e) < lo));
    if (kept.length !== this.p.serverEvents.length) {
      this.p.serverEvents = kept;
      this.persist();
    }
  }

  // ---------- subscription ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = (): EngineState => this.snapshot;
  getConfig = (): Config | null => this.config;

  /** `data: false` = only the status / timing changed: the events and settings objects are kept (screens can memoize on them). */
  private emit(data = true): void {
    this.snapshot = this.compute(data);
    for (const l of this.listeners) l();
  }

  private persist(): void {
    this.storage.set(STATE_KEY, this.p);
  }

  private compute(data = true): EngineState {
    let view: Pick<EngineState, 'events' | 'allEvents' | 'settings'> = this.snapshot;
    if (data || !view) {
      const store = new MemoryStore(this.p.serverEvents, this.p.settings);
      const deps = localDeps(store, this.now);
      for (const op of this.p.queue) handle({ key: '', ...op.req }, deps);
      const allEvents = store.all();
      view = { events: live(allEvents), allEvents, settings: store.getSettings() };
    }
    return {
      configured: this.config !== null,
      events: view.events,
      allEvents: view.allEvents,
      settings: view.settings,
      pending: this.p.queue.length,
      status: this.status,
      lastSync: this.p.lastSync,
      lastError: this.lastError,
      sheetUrl: this.p.sheetUrl,
      timing: this.timing,
      checking: this.checking,
      arrived: this.arrived,
    };
  }

  private setStatus(s: SyncStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.emit(false);
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
    this.emit(false);
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
    this.log = [];
    this.storage.remove(LOG_KEY);
    this.storage.remove(FAMILIES_KEY); // the owner's list of family servers goes with the connection
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
    this.lastActive = this.now();
    const op: Op = { opId: this.newId(), req, at: this.now() };
    this.p.queue.push(op);
    this.persist();
    this.emit();
    void this.sync('rev', false, 'tap');
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

  /**
   * A single request outside the sync (owner's feedback screen): not queued, so the caller says when it failed. Throws
   * `NetworkError` when the server cannot be reached.
   */
  async ask(req: ApiRequest): Promise<ApiResponse> {
    const ep = this.endpoint();
    if (!ep) return { ok: false, error: 'unauthorized' };
    this.onRequest(0);
    return callApi(ep, req, this.fetchImpl);
  }

  /** Hands one request to the browser to deliver on its own (no answer read); false when there is no server or it was not taken. */
  sendAway(req: ApiRequest): boolean {
    const ep = this.endpoint();
    if (!ep) return false;
    this.onRequest(0);
    return this.beacon(ep, req);
  }

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
  private async sync(mode: 'rev' | 'full', soft = false, why: SyncWhy = 'poll', timer = false): Promise<boolean> {
    const ep = this.endpoint();
    if (!ep) return false;
    const age = this.now() - this.syncStartedAt;
    if (soft && age >= 0 && age < COALESCE_MS && (this.syncing || this.status === 'idle')) return false; // the same return to the app, already served
    if (this.syncing && age < SYNC_STALE_MS) {
      if (this.again !== 'full') this.again = mode; // remembered: it may postdate what the running one will learn
      if (!timer) this.againKeep = true; // asked for by something other than the regular timer: never dropped
      return false;
    }
    this.syncing = true;
    this.syncStartedAt = this.now();
    const seq = ++this.syncSeq;
    if (soft && !this.checking) {
      this.checking = true; // the screens say "updating" until this first check after a return is back
      this.emit(false);
    }
    if (this.retryTimer) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
    let got = false;
    const t0 = this.stopwatch();
    try {
      got = this.legacy ? await this.legacyExchange(ep, mode, seq) : await this.exchange(ep, mode, seq, why);
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      this.note({ at: this.now(), why, result: /abort/i.test(e.message) ? 'timeout' : 'offline', totalMs: Math.round(this.stopwatch() - t0), serverMs: null });
      if (seq === this.syncSeq) {
        this.inFlight.clear();
        this.setStatus('offline');
        if (this.p.queue.length) this.scheduleRetry();
      }
    } finally {
      if (seq === this.syncSeq) {
        this.syncing = false;
        this.inFlight.clear();
        if (this.checking) {
          this.checking = false;
          this.emit(false);
        }
        // A remembered request, a second batch, or taps made meanwhile. Not after a failure: the retry timer and the next check take over.
        let next = this.status === 'idle' || this.status === 'syncing' ? this.again || (this.p.queue.length ? 'rev' : false) : false;
        // (owner's sync log 3) only the timer's check fell meanwhile, and this exchange has just succeeded: its answer is as fresh
        // as that check would be, and the next check is seconds away. Dropped (one request less after every slow exchange).
        if (next === 'rev' && !this.againKeep && !this.p.queue.length && this.status === 'idle') next = false;
        this.again = false;
        this.againKeep = false;
        // (owner's sync log) taps that waited behind a running exchange are labelled as taps, not as checks
        if (next) void this.sync(next, false, this.returnAt !== null ? 'return' : this.p.queue.length ? 'tap' : 'poll');
      }
    }
    return got;
  }

  private async exchange(ep: Endpoint, mode: 'rev' | 'full', seq: number, why: SyncWhy = 'poll'): Promise<boolean> {
    const batch = this.p.queue.slice(0, MAX_OPS);
    for (const op of batch) this.inFlight.add(op.opId);
    if (batch.length) this.setStatus('syncing');
    const range = this.defaultRange();
    // with the revision we hold, the server may answer with only what changed since (API 0.5.0; older servers ignore `delta`)
    const rev = mode === 'rev' && this.p.rev ? { rev: this.p.rev, delta: true as const } : {};
    const t0 = this.stopwatch();
    // a check with nothing to send gives up sooner: the next one is seconds away
    const ops = this.wireOps(batch);
    // a request that carries entries is marked keepalive: the browser should finish it even if the phone is locked right after
    const meta: { bytes?: number } = {};
    this.onRequest(ops.length);
    const res = await callApi(ep, { action: 'sync', ...range, ...rev, ...(ops.length ? { ops } : {}), debug: true }, this.fetchImpl, batch.length || mode === 'full' ? 20_000 : 10_000, batch.length > 0, meta);
    if (seq !== this.syncSeq) return false; // declared dead meanwhile: a newer sync owns the state (anything sent is sent again; ids make that safe)
    if (!res.ok) {
      if (res.error === 'unknown_action') {
        this.legacy = true; // an older server: remembered for this session
        this.inFlight.clear();
        return this.legacyExchange(ep, mode, seq);
      }
      this.note({ at: this.now(), why, result: res.error === 'unauthorized' ? 'auth' : 'error', totalMs: Math.round(this.stopwatch() - t0), serverMs: null });
      if (res.error === 'unauthorized') this.setStatus('auth');
      else {
        this.setStatus('error');
        if (this.p.queue.length) this.scheduleRetry();
      }
      return false;
    }
    const sinceReturnMs = this.returnAt !== null ? Math.max(0, Math.round(this.now() - this.returnAt)) : undefined;
    this.returnAt = null;
    this.note({
      at: this.now(),
      why,
      result: 'ok',
      totalMs: Math.round(this.stopwatch() - t0),
      serverMs: typeof res.ms === 'number' ? res.ms : null,
      ...(res.t ? { t: res.t } : {}),
      ...(sinceReturnMs !== undefined ? { sinceReturnMs } : {}),
      list: !res.unchanged,
      ...(res.changes ? { delta: true, events: res.changes.length } : res.events ? { events: res.events.length } : {}),
      ...(meta.bytes !== undefined ? { kb: Math.round(meta.bytes / 102.4) / 10 } : {}),
      ops: batch.length,
    });
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
    if (res.changes) {
      // only what changed since our revision (deleted entries come marked and drop out of the view like our own deletes)
      this.noteArrivals(res.changes);
      for (const e of res.changes) this.putServerEvent(e);
      if (res.settings) this.p.settings = withDefaults(res.settings);
    } else if (!res.unchanged) {
      this.fullAt = this.now();
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
    this.emit(changed);
    if (failed) this.scheduleRetry();
    return !res.unchanged || batch.length > 0;
  }

  /**
   * The operations as they travel. One that leaves for the first time says so (`fresh`: the server then skips its slow
   * duplicate lookup) and is marked as sent BEFORE the request goes, so whatever happens next it is a retry from now on.
   */
  private wireOps(batch: Op[]): (ApiRequest & { fresh?: true; queuedAt?: number })[] {
    // a retry says when it was queued: the server then usually finds or rules it out in the recent rows, without a search
    const out = batch.map((o) => (o.sent ? { ...o.req, queuedAt: o.at } : { ...o.req, fresh: true as const }));
    if (batch.some((o) => !o.sent)) {
      for (const o of batch) o.sent = true;
      this.persist();
    }
    return out;
  }

  /**
   * The app is being left (hidden, closed, phone locked) with entries not yet delivered and no request carrying them:
   * hand them to the browser to deliver on its own. No answer is read; they stay queued and the next sync sends them again as
   * retries, which the server recognises by their ids. Returns how many were handed over.
   */
  leave(): number {
    const ep = this.endpoint();
    if (!ep || this.legacy) return 0;
    const batch = this.p.queue.filter((o) => !this.inFlight.has(o.opId)).slice(0, MAX_OPS);
    if (!batch.length) return 0;
    if (this.stopwatch() - this.lastBeaconAt < 2_000) return 0; // "hidden" and "page closing" arrive together: once is enough
    this.lastBeaconAt = this.stopwatch();
    const ops = this.wireOps(batch);
    this.onRequest(ops.length);
    const ok = this.beacon(ep, { action: 'sync', ...this.defaultRange(), ...(this.p.rev ? { rev: this.p.rev } : {}), ops });
    return ok ? batch.length : 0;
  }

  /**
   * Which of the fetched entries are news from the other phone: not in our copy before, not something we sent ourselves, and
   * recent (an older day loaded for History is not news). Nothing is marked on the very first load.
   */
  private noteArrivals(fetched: BabyEvent[]): void {
    if (this.p.lastSync === null) return;
    const had = new Set(this.p.serverEvents.map((e) => e.id));
    const mine = new Set(this.p.queue.map((o) => ('id' in o.req ? o.req.id : '')));
    const since = this.now() - 24 * 3600_000;
    const ids = fetched.filter((e) => !had.has(e.id) && !mine.has(e.id) && e.user !== this.config?.me && eventTime(e) >= since).map((e) => e.id);
    if (ids.length) this.arrived = { ids: new Set(ids), at: this.now() };
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
      this.onRequest(1);
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
      this.onRequest(0);
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
    this.onRequest(0);
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
    // up to a fifth longer, at random: two phones that lost the connection together do not come back in step
    const ms = Math.round(RETRY_MS[Math.min(this.retryStep, RETRY_MS.length - 1)]! * (1 + this.random() * 0.2));
    this.retryStep++;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      void this.sync('rev', false, 'retry');
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
    if (!range) return this.sync('full', false, 'manual');
    const ep = this.endpoint();
    if (!ep) return false;
    const startEpoch = this.epoch;
    try {
      this.onRequest(0);
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
    this.noteArrivals(fetched);
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

  /** The open app's regular check (every few seconds, `pollDelay`). */
  async timerCheck(): Promise<boolean> {
    return this.sync('rev', false, 'poll', true);
  }

  /** Used on every return to the app: the same cheap exchange. */
  async resume(): Promise<void> {
    await this.sync('rev');
  }

  /**
   * The app was opened or returned to. Several events announce one return within a few milliseconds; they count as one.
   * Until this check is back the state says `checking`.
   */
  async returned(): Promise<void> {
    // the first return of this page load is the opening of the app
    const why: SyncWhy = this.opened ? 'return' : 'open';
    this.opened = true;
    // (owner's sync log) a return is checked right now; the safety-net full list is due only after the app has been open a while
    this.fullAt = Math.max(this.fullAt, this.now());
    if (this.returnAt === null) this.returnAt = this.now();
    await this.sync('rev', true, why);
  }

  /** The sync log, newest first (owner: Settings > advanced > "יומן סנכרון"). */
  syncLog(): SyncLogEntry[] {
    return [...this.log].reverse();
  }

  clearSyncLog(): void {
    this.log = [];
    this.storage.remove(LOG_KEY);
  }

  private note(e: SyncLogEntry): void {
    this.log.push(e);
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    this.storage.set(LOG_KEY, this.log);
  }

  /**
   * Keeps the app current while it is open and visible: a cheap check every few seconds (`pollDelay`), a full refresh every
   * FULL_REFRESH_MS, and an immediate check whenever the app comes back to the foreground or the network returns
   * (the several events one return fires count as one). Nothing runs while the app is hidden. Returns a stop function.
   */
  start(): () => void {
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const resume = () => {
      if (!visible()) return;
      this.lastActive = this.now();
      void this.returned();
    };
    const leaving = () => {
      if (!visible()) this.leave();
    };
    const closing = () => void this.leave();
    const online = () => {
      if (visible()) void this.sync('rev', false, 'online'); // never coalesced: the running request may be the one that just failed
    };
    let poll: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (visible() && this.config) void this.timerCheck();
      poll = setTimeout(tick, pollDelay(this.now() - this.lastActive));
    };
    poll = setTimeout(tick, POLL_ACTIVE_MS);
    // The safety net: the whole list after FULL_REFRESH_MS of the app being open since the last list, opening or return.
    // (owner's sync log) iOS freezes timers while the app is hidden and fires them on return, which fetched the whole list a
    // second time right after the return's own check: a look that comes far later than planned counts as a return instead.
    let lastLook = this.now();
    const full = setInterval(() => {
      const now = this.now();
      const late = now - lastLook > FULL_CHECK_MS * 2;
      lastLook = now;
      if (late) this.fullAt = Math.max(this.fullAt, now);
      else if (visible() && this.config && now - this.fullAt >= FULL_REFRESH_MS) {
        this.fullAt = now;
        void this.sync('full', false, 'full');
      }
    }, FULL_CHECK_MS);
    window.addEventListener('online', online);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    document.addEventListener('visibilitychange', leaving);
    window.addEventListener('pagehide', closing);
    resume();
    return () => {
      clearTimeout(poll);
      clearInterval(full);
      window.removeEventListener('online', online);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
      document.removeEventListener('visibilitychange', leaving);
      window.removeEventListener('pagehide', closing);
    };
  }
}
