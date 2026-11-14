import { type Deps, handle } from '../server/core';
import { MemoryStore } from '../server/memory-store';
import { eventTime, live } from '../shared/domain';
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
}

const STATE_KEY = 'bl.state.v1';
const CONFIG_KEY = 'bl.config.v1';
const RETRY_MS = [3_000, 6_000, 12_000, 30_000, 60_000];
export const HISTORY_DAYS = 14;

const defaultId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function localDeps(store: MemoryStore, now: () => number): Deps {
  return { store, now, checkKey: () => true, withLock: (fn) => fn() };
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
  private flushing = false;
  private refreshing = false;
  private inFlight: string | null = null;
  private epoch = 0;
  private retryTimer: unknown = null;
  private retryStep = 0;

  constructor(opts: EngineOptions) {
    this.storage = opts.storage;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? defaultId;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.config = this.storage.get<Config>(CONFIG_KEY);
    const saved = this.storage.get<Persisted>(STATE_KEY);
    this.p = {
      serverEvents: Array.isArray(saved?.serverEvents) ? saved!.serverEvents : [],
      settings: saved?.settings ?? DEFAULT_SETTINGS,
      queue: Array.isArray(saved?.queue) ? saved!.queue : [],
      lastSync: saved?.lastSync ?? null,
      sheetUrl: saved?.sheetUrl ?? '',
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
    this.config = cfg;
    this.storage.set(CONFIG_KEY, cfg);
    if (settings) {
      this.p.settings = settings;
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
    this.p = { serverEvents: [], settings: DEFAULT_SETTINGS, queue: [], lastSync: null, sheetUrl: '' };
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
    void this.flush();
    return { ok: true, opId: op.opId, event: r.event, warning: r.warning, queued: true };
  }

  /**
   * Takes back an operation: if it has not been sent yet it is simply dropped,
   * otherwise the inverse operation is sent.
   */
  undo(opId: string, inverse: ApiRequest): DispatchResult {
    const i = this.p.queue.findIndex((o) => o.opId === opId);
    if (i >= 0 && this.inFlight !== opId) {
      this.p.queue.splice(i, 1);
      this.persist();
      this.emit();
      return { ok: true, opId: '', queued: false };
    }
    return this.dispatch(inverse);
  }

  // ---------- sending ----------

  private endpoint(): Endpoint | null {
    return this.config ? { url: this.config.url, key: this.config.key } : null;
  }

  async flush(): Promise<void> {
    const ep = this.endpoint();
    if (!ep || this.flushing) return;
    this.flushing = true;
    if (this.retryTimer) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
    try {
      if (this.p.queue.length) this.setStatus('syncing');
      while (this.p.queue.length) {
        const op = this.p.queue[0]!;
        this.inFlight = op.opId;
        let res: ApiResponse;
        try {
          res = await callApi(ep, op.req, this.fetchImpl);
        } catch (e) {
          if (!(e instanceof NetworkError)) throw e;
          this.inFlight = null;
          this.setStatus('offline');
          this.scheduleRetry();
          return;
        }
        this.inFlight = null;
        if (res.ok) {
          this.applyToServerCopy(op.req);
          this.p.queue.shift();
          this.epoch++;
          this.retryStep = 0;
          this.persist();
          this.emit();
        } else if (res.error === 'unauthorized') {
          this.setStatus('auth');
          return;
        } else if (res.error === 'server_error') {
          this.setStatus('error');
          this.scheduleRetry();
          return;
        } else {
          // The server refused this operation for good (invalid, not found, ...): drop it and say so.
          this.p.queue.shift();
          this.epoch++;
          this.lastError = `${res.error}${res.detail ? `: ${res.detail}` : ''}`;
          this.persist();
          this.emit();
        }
      }
      this.setStatus('idle');
    } finally {
      this.flushing = false;
    }
    await this.refresh();
  }

  private applyToServerCopy(req: ApiRequest): void {
    const store = new MemoryStore(this.p.serverEvents, this.p.settings);
    handle({ key: '', ...req }, localDeps(store, this.now));
    this.p.serverEvents = store.all();
    this.p.settings = store.getSettings();
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const ms = RETRY_MS[Math.min(this.retryStep, RETRY_MS.length - 1)]!;
    this.retryStep++;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      void this.flush().then(() => (this.p.queue.length === 0 ? this.refresh() : undefined));
    }, ms);
  }

  // ---------- fetching ----------

  defaultRange(): { from: string; to: string } {
    const today = localDate(this.now());
    return { from: addDays(today, -(HISTORY_DAYS - 1)), to: today };
  }

  /** Fetches a date range from the server and merges it into the local copy. */
  async refresh(range = this.defaultRange()): Promise<boolean> {
    const ep = this.endpoint();
    if (!ep || this.refreshing || this.flushing || this.p.queue.length > 0) return false;
    this.refreshing = true;
    const startEpoch = this.epoch;
    try {
      const res = await callApi(ep, { action: 'list', from: range.from, to: range.to }, this.fetchImpl);
      if (!res.ok) {
        if (res.error === 'unauthorized') this.setStatus('auth');
        else this.setStatus('error');
        return false;
      }
      if (startEpoch !== this.epoch || this.p.queue.length > 0) return false; // something changed meanwhile: that answer is stale
      this.merge(range, res.events ?? []);
      if (res.settings) this.p.settings = res.settings;
      if (res.sheetUrl) this.p.sheetUrl = res.sheetUrl;
      this.p.lastSync = this.now();
      this.status = 'idle';
      this.persist();
      this.emit();
      return true;
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      this.setStatus('offline');
      return false;
    } finally {
      this.refreshing = false;
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

  /** Starts background triggers: periodic refresh and refresh on return/online. Returns a stop function. */
  start(): () => void {
    const tick = () => {
      if (!this.config) return;
      if (this.p.queue.length) void this.flush();
      else void this.refresh();
    };
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') tick();
    };
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') tick();
    }, 60_000);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }
}
