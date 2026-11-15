import { byTimeAsc, lastFeed, live, openSleep, vitaminDOnDate } from '../shared/domain';
import { API_VERSION, type ApiResponse, type EventPatch } from '../shared/protocol';
import {
  speechAlreadyAsleep,
  speechAwake,
  speechForLogged,
  speechStatus,
  speechVitaminAgain,
} from '../shared/speech';
import { addDays, dayStart, formatLocal, isDateString, parseLocal } from '../shared/tz';
import {
  type BabyEvent,
  DIAPER_DETAILS,
  EVENT_TYPES,
  FEED_DETAILS,
  type Settings,
} from '../shared/types';

const MIN = 60_000;
const RECENT_ROWS = 500;
const MAX_FUTURE_MIN = 10;

/** Storage behind the API: a Google Sheet in production, memory in tests and in the app's offline cache. */
export interface Store {
  /** The last `n` rows in sheet order (oldest first). */
  recent(n: number): BabyEvent[];
  all(): BabyEvent[];
  find(id: string): BabyEvent | undefined;
  append(e: BabyEvent): void;
  replace(e: BabyEvent): boolean;
  getSettings(): Settings;
  setSettings(s: Settings): void;
  sheetUrl(): string;
  /** Changes whenever data is written through the API; lets clients poll cheaply. */
  revision(): string;
  bump(): void;
}

export interface Deps {
  store: Store;
  now(): number;
  checkKey(key: string): boolean;
  withLock<T>(fn: () => T): T;
}

class ApiException extends Error {
  constructor(
    readonly code: Exclude<ApiResponse, { ok: true }>['error'],
    readonly detail?: string,
  ) {
    super(code);
  }
}

const fail = (code: ApiException['code'], detail?: string): never => {
  throw new ApiException(code, detail);
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function reqString(o: Obj, field: string, max: number): string {
  const v = o[field];
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) fail('bad_request', `${field} missing or too long`);
  return (v as string).trim();
}

function optString(o: Obj, field: string, max: number): string {
  const v = o[field];
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > max) fail('bad_request', `${field} invalid`);
  return v as string;
}

function checkTime(label: string, s: string, now: number): number {
  const t = parseLocal(s);
  if (Number.isNaN(t)) fail('invalid_event', `${label} is not a valid time`);
  if (t > now + MAX_FUTURE_MIN * MIN) fail('invalid_event', `${label} is in the future`);
  return t;
}

/** Throws if the event is inconsistent. Used for every write. */
export function validateEvent(e: BabyEvent, now: number): void {
  if (!EVENT_TYPES.includes(e.type)) fail('invalid_event', 'unknown type');
  if (e.type === 'feed' && !(FEED_DETAILS as readonly string[]).includes(e.detail)) fail('invalid_event', 'feed needs left or right');
  if (e.type === 'diaper' && !(DIAPER_DETAILS as readonly string[]).includes(e.detail)) fail('invalid_event', 'diaper needs wet, poop or both');
  if ((e.type === 'sleep' || e.type === 'vitamin_d') && e.detail !== '') fail('invalid_event', 'this type has no detail');
  if (e.note.length > 200) fail('invalid_event', 'note too long');
  if (e.user.length === 0 || e.user.length > 20) fail('invalid_event', 'user must be 1-20 characters');

  if (e.type !== 'sleep') {
    if (e.end) fail('invalid_event', 'only sleep has an end');
    if (!e.start) fail('invalid_event', 'start is required');
  }
  if (e.type === 'sleep' && !e.start && !e.end) fail('invalid_event', 'sleep needs a start or an end');
  const s = e.start ? checkTime('start', e.start, now) : NaN;
  const t = e.end ? checkTime('end', e.end, now) : NaN;
  if (e.start && e.end && t < s) fail('invalid_event', 'end is before start');
}

function applyPatch(base: BabyEvent, patch: EventPatch): BabyEvent {
  const next = { ...base };
  if (patch.type !== undefined) next.type = patch.type;
  if (patch.detail !== undefined) next.detail = patch.detail;
  if (patch.start !== undefined) next.start = patch.start;
  if (patch.end !== undefined) next.end = patch.end;
  if (patch.note !== undefined) next.note = patch.note;
  return next;
}

function parsePatch(raw: unknown): EventPatch {
  if (!isObj(raw)) return fail('bad_request', 'patch missing');
  const out: EventPatch = {};
  for (const k of ['type', 'detail', 'start', 'end', 'note'] as const) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] !== 'string') fail('bad_request', `${k} must be a string`);
    (out as Obj)[k] = raw[k];
  }
  return out;
}

function parseSettings(raw: unknown): Partial<Settings> {
  if (!isObj(raw)) return fail('bad_request', 'set must be an object');
  const out: Partial<Settings> = {};
  if (raw.babyName !== undefined) {
    const v = raw.babyName;
    if (typeof v !== 'string' || v.trim() === '' || v.length > 40) fail('bad_request', 'babyName invalid');
    out.babyName = (v as string).trim();
  }
  if (raw.mergeWindowMin !== undefined) {
    const v = raw.mergeWindowMin;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 180) fail('bad_request', 'mergeWindowMin must be 0-180');
    out.mergeWindowMin = v as number;
  }
  if (raw.parents !== undefined) {
    const v = raw.parents;
    if (!Array.isArray(v) || v.length !== 2 || v.some((x) => typeof x !== 'string' || x.trim() === '' || x.length > 20)) {
      fail('bad_request', 'parents must be two names of 1-20 characters');
    }
    const p = v as string[];
    out.parents = [p[0]!.trim(), p[1]!.trim()];
  }
  return out;
}

const stamp = (now: number) => formatLocal(now);

export function handle(raw: unknown, deps: Deps): ApiResponse {
  try {
    if (!isObj(raw)) return { ok: false, error: 'bad_request' };
    if (!deps.checkKey(str(raw.key))) return { ok: false, error: 'unauthorized' };
    return dispatch(raw, deps);
  } catch (e) {
    if (e instanceof ApiException) return { ok: false, error: e.code, ...(e.detail ? { detail: e.detail } : {}) };
    return { ok: false, error: 'server_error', detail: e instanceof Error ? e.message : String(e) };
  }
}

function dispatch(o: Obj, deps: Deps): ApiResponse {
  const { store } = deps;
  const now = deps.now();

  switch (o.action) {
    case 'ping':
      return { ok: true, version: API_VERSION, serverNow: stamp(now), rev: store.revision() };

    case 'poll':
      return { ok: true, rev: store.revision() };

    case 'list': {
      // Read the revision first: a write that lands while we read bumps it, so the next poll still notices.
      const rev = store.revision();
      const from = str(o.from);
      const to = str(o.to);
      if (!isDateString(from) || !isDateString(to) || to < from) return fail('bad_request', 'from/to must be dates');
      const lo = dayStart(from);
      const hi = dayStart(addDays(to, 1));
      const all = live(store.all());
      const open = openSleep(all);
      const events = all.filter((e) => {
        if (e === open) return true;
        const s = e.start ? parseLocal(e.start) : NaN;
        const t = e.end ? parseLocal(e.end) : NaN;
        if (e.type === 'sleep' && e.start) return s < hi && (Number.isNaN(t) ? now : t) > lo;
        const at = Number.isNaN(s) ? t : s;
        return at >= lo && at < hi;
      });
      return {
        ok: true,
        rev,
        events: events.sort(byTimeAsc),
        settings: store.getSettings(),
        serverNow: stamp(now),
        sheetUrl: store.sheetUrl(),
      };
    }

    case 'status': {
      const recent = store.recent(RECENT_ROWS);
      return { ok: true, speech: speechStatus(lastFeed(recent), now) };
    }

    case 'settings': {
      if (o.set === undefined) return { ok: true, settings: store.getSettings(), sheetUrl: store.sheetUrl() };
      const patch = parseSettings(o.set);
      return deps.withLock(() => {
        const merged: Settings = { ...store.getSettings(), ...patch };
        store.setSettings(merged);
        store.bump();
        return { ok: true, settings: merged, sheetUrl: store.sheetUrl() } as const;
      });
    }

    case 'log':
      return write(deps, () => logEvent(o, deps, now));
    case 'asleep':
      return write(deps, () => asleep(o, deps, now));
    case 'awake':
      return write(deps, () => awake(o, deps, now));
    case 'update':
      return write(deps, () => update(o, deps, now));
    case 'delete':
    case 'restore':
      return write(deps, () => setDeleted(str(o.id), o.action === 'delete', deps, now));
    default:
      return fail('unknown_action', typeof o.action === 'string' ? o.action : undefined);
  }
}

/** Runs a write under the lock and bumps the revision only when something actually changed. */
function write(deps: Deps, fn: () => ApiResponse): ApiResponse {
  return deps.withLock(() => {
    const r = fn();
    if (r.ok && !r.duplicate && !r.noop) deps.store.bump();
    return r;
  });
}

function newEvent(o: Obj, type: BabyEvent['type'], detail: string, start: string, end: string, now: number): BabyEvent {
  const source = o.source;
  if (source !== 'app' && source !== 'siri') fail('bad_request', 'source must be app or siri');
  return {
    id: reqString(o, 'id', 64),
    type,
    detail,
    start,
    end,
    user: reqString(o, 'user', 20),
    source: source as 'app' | 'siri',
    note: optString(o, 'note', 200),
    created: stamp(now),
    edited: '',
    deleted: false,
  };
}

function logEvent(o: Obj, deps: Deps, now: number): ApiResponse {
  const { store } = deps;
  const id = reqString(o, 'id', 64);
  const existing = store.find(id);
  if (existing) return { ok: true, duplicate: true, event: existing, speech: speechForLogged(existing, store.recent(RECENT_ROWS)) };

  const type = o.type as BabyEvent['type'];
  // iOS shortcuts cannot send an empty field reliably, so "-" means "no detail".
  const rawDetail = optString(o, 'detail', 20);
  const e = newEvent(o, type, rawDetail === '-' ? '' : rawDetail, optString(o, 'start', 16), optString(o, 'end', 16), now);
  validateEvent(e, now);
  const recent = store.recent(RECENT_ROWS);

  if (e.type === 'sleep' && e.start && !e.end && openSleep(recent)) fail('sleep_already_open');

  let warning: string | undefined;
  let speech: string;
  if (e.type === 'vitamin_d') {
    const already = vitaminDOnDate(recent, e.start.slice(0, 10));
    if (already) {
      warning = 'vitamin_d_already_given';
      speech = speechVitaminAgain(already);
    } else speech = speechForLogged(e, recent);
  } else speech = speechForLogged(e, [...recent, e]);

  store.append(e);
  return { ok: true, event: e, speech, ...(warning ? { warning } : {}) };
}

function asleep(o: Obj, deps: Deps, now: number): ApiResponse {
  const { store } = deps;
  const id = reqString(o, 'id', 64);
  const existing = store.find(id);
  if (existing) return { ok: true, duplicate: true, event: existing, speech: speechForLogged(existing, []) };
  const recent = store.recent(RECENT_ROWS);
  const open = openSleep(recent);
  if (open) return { ok: true, noop: true, event: open, speech: speechAlreadyAsleep(open) };
  const e = newEvent(o, 'sleep', '', optString(o, 'start', 16), '', now);
  validateEvent(e, now);
  store.append(e);
  return { ok: true, event: e, speech: speechForLogged(e, [e]) };
}

function awake(o: Obj, deps: Deps, now: number): ApiResponse {
  const { store } = deps;
  const id = reqString(o, 'id', 64);
  // Shortcuts always send "start" (their current time); accept it as the wake-up time when no "end" is given.
  const end = optString(o, 'end', 16) || optString(o, 'start', 16);
  const existing = store.find(id);
  if (existing) return { ok: true, duplicate: true, event: existing, speech: speechAwake(sleepMinutes(existing)) };

  const recent = store.recent(RECENT_ROWS);
  const open = openSleep(recent);
  if (open) {
    const closed = { ...open, end };
    validateEvent(closed, now);
    store.replace(closed);
    return { ok: true, event: closed, speech: speechAwake(sleepMinutes(closed)) };
  }
  // Retry of a request that already closed the latest sleep: nothing to do.
  const latestClosed = live(recent)
    .filter((e) => e.type === 'sleep' && e.end)
    .sort((a, b) => parseLocal(b.end) - parseLocal(a.end))[0];
  if (latestClosed && latestClosed.end === end) {
    return { ok: true, duplicate: true, event: latestClosed, speech: speechAwake(sleepMinutes(latestClosed)) };
  }
  const e = newEvent(o, 'sleep', '', '', end, now);
  validateEvent(e, now);
  store.append(e);
  return { ok: true, event: e, speech: speechAwake(null) };
}

function sleepMinutes(e: BabyEvent): number | null {
  if (!e.start || !e.end) return null;
  return (parseLocal(e.end) - parseLocal(e.start)) / MIN;
}

function update(o: Obj, deps: Deps, now: number): ApiResponse {
  const { store } = deps;
  const id = reqString(o, 'id', 64);
  const base = store.find(id);
  if (!base) return fail('not_found');
  const next = { ...applyPatch(base, parsePatch(o.patch)), edited: stamp(now) };
  validateEvent(next, now);
  if (next.type === 'sleep' && next.start && !next.end && !base.deleted) {
    const other = openSleep(store.recent(RECENT_ROWS).filter((e) => e.id !== id));
    if (other) fail('sleep_already_open');
  }
  store.replace(next);
  return { ok: true, event: next };
}

function setDeleted(id: string, deleted: boolean, deps: Deps, now: number): ApiResponse {
  if (!id) return fail('bad_request', 'id missing');
  const base = deps.store.find(id);
  if (!base) return fail('not_found');
  if (base.deleted === deleted) return { ok: true, noop: true, event: base };
  const next = { ...base, deleted, edited: stamp(now) };
  deps.store.replace(next);
  return { ok: true, event: next };
}
