import { byTimeAsc, lastFeed, live, openSleep, vitaminDOnDate } from '../shared/domain';
import { type Medicine, VITAMIN_D_ID, normalizeMedicine, withVitaminD } from '../shared/medicines';
import { API_VERSION, type ApiOk, type ApiResponse, type EventPatch } from '../shared/protocol';
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
  if (e.type === 'medicine' && (e.detail === '' || e.detail.length > 64)) fail('invalid_event', 'medicine needs the id of a medicine');
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

/** A dose must name a medicine that exists (active or archived). */
function checkMedicineKnown(e: BabyEvent, store: Store): void {
  if (e.type !== 'medicine') return;
  if (e.detail === VITAMIN_D_ID) fail('invalid_event', 'vitamin D has its own type');
  if (!store.getSettings().medicines.some((m) => m.id === e.detail)) fail('invalid_event', 'unknown medicine');
}

const MAX_MEDICINES = 30;

/** Settings as clients see them: vitamin D is always in the medicines list (with its defaults until someone edits it). */
function settingsOf(store: Store): Settings {
  const s = store.getSettings();
  return { ...s, medicines: withVitaminD(s.medicines) };
}

type MedicinePatch = { id: string; remove: true } | Omit<Medicine, 'created'>;

function parseMedicines(raw: unknown): MedicinePatch[] {
  if (!Array.isArray(raw) || raw.length > 10) return fail('bad_request', 'medicines must be a list of up to 10 changes');
  return raw.map((x): MedicinePatch => {
    if (isObj(x) && x.remove === true) {
      const id = str(x.id);
      if (!id || id.length > 64) fail('bad_request', 'medicine id missing');
      return { id, remove: true };
    }
    const r = normalizeMedicine(x);
    if (!r.ok) return fail('bad_request', r.error);
    return r.medicine;
  });
}

/** Saves medicines one by one (by id), so two phones editing different medicines never overwrite each other. */
function mergeMedicines(current: readonly Medicine[], changes: readonly MedicinePatch[], store: Store, now: number): Medicine[] {
  let list = current.map((m) => ({ ...m }));
  for (const ch of changes) {
    const i = list.findIndex((m) => m.id === ch.id);
    if ('remove' in ch) {
      if (i < 0) continue;
      if (ch.id === VITAMIN_D_ID) fail('bad_request', 'vitamin D cannot be removed: archive it instead');
      if (live(store.all()).some((e) => e.type === 'medicine' && e.detail === ch.id)) fail('bad_request', 'medicine has doses: archive it instead');
      list = list.filter((m) => m.id !== ch.id);
    } else if (i >= 0) list[i] = { ...ch, created: list[i]!.created || stamp(now) }; // vitamin D gets its time when first saved
    else {
      if (list.length >= MAX_MEDICINES) fail('bad_request', 'too many medicines');
      list.push({ ...ch, created: stamp(now) });
    }
  }
  return list;
}

function parseSettings(raw: unknown): Partial<Omit<Settings, 'medicines'>> & { medicines?: MedicinePatch[] } {
  if (!isObj(raw)) return fail('bad_request', 'set must be an object');
  const out: Partial<Omit<Settings, 'medicines'>> & { medicines?: MedicinePatch[] } = {};
  if (raw.medicines !== undefined) out.medicines = parseMedicines(raw.medicines);
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
      return { ...listRange(store, from, to, now), rev };
    }

    case 'sync':
      return sync(o, deps, now);

    case 'status': {
      const recent = store.recent(RECENT_ROWS);
      return { ok: true, speech: speechStatus(lastFeed(recent), now) };
    }

    case 'settings': {
      if (o.set === undefined) return { ok: true, settings: settingsOf(store), sheetUrl: store.sheetUrl() };
      return deps.withLock(() => {
        const r = saveSettings(o.set, deps, now);
        store.bump();
        return r;
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

/** Everything a phone shows for a range of days (the open sleep always included), plus settings. */
function listRange(store: Store, from: string, to: string, now: number): ApiOk {
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
  return { ok: true, events: events.sort(byTimeAsc), settings: settingsOf(store), serverNow: stamp(now), sheetUrl: store.sheetUrl() };
}

/** The write actions without lock and revision handling (the callers do both). Returns null for anything that is not a write. */
function applyWrite(o: Obj, deps: Deps, now: number): ApiResponse | null {
  switch (o.action) {
    case 'log':
      return logEvent(o, deps, now);
    case 'asleep':
      return asleep(o, deps, now);
    case 'awake':
      return awake(o, deps, now);
    case 'update':
      return update(o, deps, now);
    case 'delete':
    case 'restore':
      return setDeleted(str(o.id), o.action === 'delete', deps, now);
    case 'settings':
      return o.set === undefined ? null : saveSettings(o.set, deps, now);
    default:
      return null;
  }
}

function saveSettings(set: unknown, deps: Deps, now: number): ApiResponse {
  const { store } = deps;
  const { medicines, ...patch } = parseSettings(set);
  const current = settingsOf(store);
  const merged: Settings = { ...current, ...patch, medicines: medicines ? mergeMedicines(current.medicines, medicines, store, now) : current.medicines };
  store.setSettings(merged);
  return { ok: true, settings: merged, sheetUrl: store.sheetUrl() };
}

export const MAX_SYNC_OPS = 25;

/**
 * One round trip for a phone: applies its pending operations (in order, under one lock) and tells it whether anything else
 * changed since the revision it holds. "unchanged" costs no data read at all; otherwise the answer carries the list.
 * A refused operation gets its own error and the rest go on; an unexpected failure stops the batch (the phone sends the rest again).
 */
function sync(o: Obj, deps: Deps, now: number): ApiResponse {
  const { store } = deps;
  const from = str(o.from);
  const to = str(o.to);
  if (!isDateString(from) || !isDateString(to) || to < from) return fail('bad_request', 'from/to must be dates');
  const ops = o.ops === undefined ? [] : o.ops;
  if (!Array.isArray(ops) || ops.length > MAX_SYNC_OPS) return fail('bad_request', `ops must be a list of up to ${MAX_SYNC_OPS} operations`);
  const clientRev = typeof o.rev === 'string' ? o.rev : null;

  let results: ApiResponse[] | undefined;
  let revBefore: string;
  if (ops.length) {
    const done = deps.withLock(() => {
      const before = store.revision();
      const out: ApiResponse[] = [];
      let changed = false;
      for (const raw of ops as unknown[]) {
        let r: ApiResponse;
        try {
          if (!isObj(raw)) fail('bad_request', 'an operation must be an object');
          r = applyWrite(raw as Obj, deps, now) ?? fail('bad_request', 'only write actions can be sent in ops');
        } catch (e) {
          r = e instanceof ApiException ? { ok: false, error: e.code, ...(e.detail ? { detail: e.detail } : {}) } : { ok: false, error: 'server_error', detail: e instanceof Error ? e.message : String(e) };
        }
        if (r.ok) {
          if (!r.duplicate && !r.noop) changed = true;
          delete r.speech; // only Siri needs sentences
        }
        out.push(r);
        if (!r.ok && r.error === 'server_error') break;
      }
      if (changed) store.bump();
      return { out, before };
    });
    results = done.out;
    revBefore = done.before;
  } else revBefore = store.revision();

  // Read the revision before the data (as `list` does): a write landing in between is noticed by the next sync.
  const rev = results ? store.revision() : revBefore;
  const extra = results ? { results } : {};
  if (clientRev !== null && clientRev === revBefore) return { ok: true, rev, serverNow: stamp(now), unchanged: true, ...extra };
  return { ...listRange(store, from, to, now), rev, ...extra };
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
  const rawDetail = optString(o, 'detail', 64);
  const e = newEvent(o, type, rawDetail === '-' ? '' : rawDetail, optString(o, 'start', 16), optString(o, 'end', 16), now);
  validateEvent(e, now);
  checkMedicineKnown(e, store);
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
  if (next.type === 'medicine' && next.detail !== base.detail) checkMedicineKnown(next, store);
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
