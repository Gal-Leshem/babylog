import { byTimeAsc, lastFeed, live, nextSide, openSleep, vitaminDOnDate } from '../shared/domain';
import type { Change, Since } from './journal';
import { FEEDBACK_KINDS, FEEDBACK_LOG_MAX, FEEDBACK_TEXT_MAX, type FeedbackItem, type FeedbackKind } from '../shared/protocol';
import { type Medicine, VITAMIN_D_ID, normalizeMedicine, withVitaminD } from '../shared/medicines';
import { API_VERSION, type ApiOk, type ApiResponse, type EventPatch, type UsageTotal } from '../shared/protocol';
import { type Voice, voiceFor } from '../shared/speech';
import { QUESTION_STATES, type QuestionStateName, USAGE_LABELS, USAGE_MAX_DAYS, USAGE_QUESTIONS, type UsageDay } from '../shared/usage';
import { addDays, dayStart, formatLocal, isDateString, parseLocal } from '../shared/tz';
import {
  type BabyEvent,
  DIAPER_DETAILS,
  coreOf,
  EVENT_TYPES,
  FEED_DETAILS,
  type Settings,
} from '../shared/types';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const RECENT_ROWS = 500;
const MAX_FUTURE_MIN = 10;

/** Storage behind the API: a Google Sheet in production, memory in tests and in the app's offline cache. */
export interface Store {
  /** The last `n` rows in sheet order (oldest first). */
  recent(n: number): BabyEvent[];
  all(): BabyEvent[];
  /** How many rows there are (cheap: no data is read). */
  count(): number;
  find(id: string): BabyEvent | undefined;
  append(e: BabyEvent): void;
  replace(e: BabyEvent): boolean;
  getSettings(): Settings;
  setSettings(s: Settings): void;
  sheetUrl(): string;
  /** Changes whenever data is written through the API; lets clients poll cheaply. */
  revision(): string;
  /**
   * Moves the revision on by one. `change`: what this revision changed (events in their new state, settings), kept in the
   * journal of recent changes; without it the journal starts over (nobody is told "only this changed" across it).
   */
  bump(change?: Change): void;
  /** What changed after revision `rev` (from the journal of recent changes), or null when that cannot be told. */
  changesSince(rev: string): Since | null;
  /** (owner, F15) Stores the usage counts of one phone (`install`) and parent for whole days; a day already stored is replaced. */
  usageSave(user: string, install: string, version: string, days: readonly UsageDay[], now: string): void;
  /** (owner, family servers) The request counts summed per day over every phone, for these dates (oldest first; a day without rows is zeros). */
  usageTotals(dates: readonly string[]): UsageTotal[];
  /** (owner) Feedback items, oldest first. */
  feedbackAll(): FeedbackItem[];
  /** Stores one item under the next number of a sequence that is never reset (call under the lock). */
  feedbackAdd(item: Omit<FeedbackItem, 'no'>): FeedbackItem;
  /** Removes the items with these ids, or every item when `ids` is missing; the numbering goes on where it was (call under the lock). */
  feedbackClear(ids?: readonly string[]): void;
}

export interface Deps {
  store: Store;
  now(): number;
  checkKey(key: string): boolean;
  withLock<T>(fn: () => T): T;
  /**
   * A family's server (not the owner's): its sheet link is never given out (the sheet lives in the owner's Drive), and its own
   * key may send feedback but not read or clear it.
   */
  familyServer?: boolean;
  /** A family's server: the owner's admin key, which may only read and clear the feedback (never the log). */
  checkAdmin?(key: string): boolean;
}

/** What the owner's admin key may do on a family's server. */
const ADMIN_ACTIONS = new Set(['ping', 'feedbackList', 'feedbackClear', 'usageTotals']);
/** On a family's server only the owner's admin key may do these (the family's own key gets `send_only`). */
const FEEDBACK_READ = new Set(['feedbackList', 'feedbackClear', 'usageTotals']);

/** A family's server never hands out its sheet link (also not inside the answers to a sync's operations). */
function withoutSheetUrl(r: ApiResponse): ApiResponse {
  if (!r.ok) return r;
  const { sheetUrl: _drop, ...rest } = r;
  return rest.results ? { ...rest, results: rest.results.map(withoutSheetUrl) } : rest;
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

/** A real calendar day from 2000 on, 'YYYY-MM-DD' (the app does not offer days after today). */
function isBirthDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '2000-01-01') return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function parseSettings(raw: unknown): Partial<Omit<Settings, 'medicines'>> & { medicines?: MedicinePatch[] } {
  if (!isObj(raw)) return fail('bad_request', 'set must be an object');
  const out: Partial<Omit<Settings, 'medicines'>> & { medicines?: MedicinePatch[] } = {};
  if (raw.medicines !== undefined) out.medicines = parseMedicines(raw.medicines);
  if (raw.babySex !== undefined) {
    if (raw.babySex !== 'boy' && raw.babySex !== 'girl') fail('bad_request', 'babySex must be boy or girl');
    out.babySex = raw.babySex as 'boy' | 'girl';
  }
  if (raw.babyBirth !== undefined) {
    const v = raw.babyBirth;
    if (typeof v !== 'string' || (v !== '' && !isBirthDate(v))) fail('bad_request', 'babyBirth must be YYYY-MM-DD');
    out.babyBirth = v as string;
  }
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
    const key = str(raw.key);
    const action = str(raw.action);
    if (deps.checkKey(key)) {
      if (deps.familyServer && FEEDBACK_READ.has(action)) return { ok: false, error: 'send_only' };
      const r = dispatch(raw, deps);
      if (!deps.familyServer) return r;
      // a send can be answered before the screen learnt from its list that this phone only sends: the answer says so too
      const out = withoutSheetUrl(r);
      return action === 'feedback' && out.ok ? { ...out, sendOnly: true } : out;
    }
    // the owner's admin key on a family's server: the feedback and nothing else
    if (deps.familyServer && deps.checkAdmin?.(key) && ADMIN_ACTIONS.has(action)) return dispatch(raw, deps);
    return { ok: false, error: 'unauthorized' };
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
      return { ok: true, speech: voiceOf(o, store).status(lastFeed(recent), now) };
    }

    // (owner) "Which side next?" for Siri: the side after the last feed, nothing else
    case 'next':
      return { ok: true, speech: voiceOf(o, store).nextSide(nextSide(store.recent(RECENT_ROWS))) };

    case 'settings': {
      if (o.set === undefined) return { ok: true, settings: settingsOf(store), sheetUrl: store.sheetUrl() };
      return deps.withLock(() => {
        const r = saveSettings(o.set, deps, now);
        store.bump({ events: [], settings: true });
        return r;
      });
    }

    case 'feedback':
      return deps.withLock(() => addFeedback(o, store, now));
    case 'feedbackList':
      return { ok: true, feedback: store.feedbackAll() };
    // (owner, F15) not log data and nobody waits for it: no lock (each phone writes only its own rows), no revision
    case 'usage':
      return saveUsage(o, store, now);
    case 'usageTotals': {
      const n = o.days === undefined ? 7 : o.days;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 14) return fail('bad_request', 'days must be 1-14');
      const today = stamp(now).slice(0, 10);
      const dates = Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
      return { ok: true, usageTotals: store.usageTotals(dates) };
    }
    case 'feedbackClear':
      return deps.withLock(() => {
        const ids = o.ids;
        if (ids !== undefined && (!Array.isArray(ids) || ids.length > 500 || ids.some((x) => typeof x !== 'string'))) fail('bad_request', 'ids must be a list of ids');
        store.feedbackClear(ids as string[] | undefined);
        return { ok: true, feedback: store.feedbackAll() };
      });

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
  const all = live(rowsSince(store, lo));
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

const TAIL_ROWS = 1500;
const TAIL_MARGIN = 2 * 24 * 60 * MIN;

/**
 * The rows that can matter for days from `lo` on, without reading the whole sheet (it grows by some 25 rows a day, for good).
 * Rows are appended in the order they are created, and nothing can be logged for a time later than "now", so everything that
 * happened from `lo` on sits after the last row created before `lo`. The tail is enough when its oldest row was created at
 * least two days before `lo` (the margin covers a sleep that began earlier and reaches into the range). Whenever that cannot
 * be shown (an older range, a short sheet, rows not in creation order because someone sorted the sheet) everything is read.
 * Known limit: a sleep left open for longer than the tail reaches back is not reported as open any more.
 */
function rowsSince(store: Store, lo: number): BabyEvent[] {
  if (store.count() <= TAIL_ROWS) return store.all();
  const tail = store.recent(TAIL_ROWS);
  const first = tail[0] ? parseLocal(tail[0].created) : NaN;
  const last = tail.length ? parseLocal(tail[tail.length - 1]!.created) : NaN;
  if (Number.isNaN(first) || Number.isNaN(last) || first > last || first >= lo - TAIL_MARGIN) return store.all();
  return tail;
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
  if (merged.babyBirth === '') delete merged.babyBirth; // cleared
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
      const change: { events: BabyEvent[]; settings: boolean } = { events: [], settings: false };
      for (const raw of ops as unknown[]) {
        let r: ApiResponse;
        try {
          if (!isObj(raw)) fail('bad_request', 'an operation must be an object');
          r = applyWrite(raw as Obj, deps, now) ?? fail('bad_request', 'only write actions can be sent in ops');
        } catch (e) {
          r = e instanceof ApiException ? { ok: false, error: e.code, ...(e.detail ? { detail: e.detail } : {}) } : { ok: false, error: 'server_error', detail: e instanceof Error ? e.message : String(e) };
        }
        if (r.ok) {
          if (!r.duplicate && !r.noop) {
            changed = true;
            if (r.event) change.events = [...change.events.filter((e) => e.id !== r.event!.id), r.event];
            if ((raw as Obj).action === 'settings') change.settings = true;
          }
          delete r.speech; // only Siri needs sentences
        }
        out.push(r);
        if (!r.ok && r.error === 'server_error') break;
      }
      if (changed) store.bump(change);
      return { out, before };
    });
    results = done.out;
    revBefore = done.before;
  } else revBefore = store.revision();

  // Read the revision before the data (as `list` does): a write landing in between is noticed by the next sync.
  const rev = results ? store.revision() : revBefore;
  const extra = results ? { results } : {};
  if (clientRev !== null && clientRev === revBefore) return { ok: true, rev, serverNow: stamp(now), unchanged: true, ...extra };
  // (API 0.5.0) a phone a little behind gets only what changed since its revision: no sheet read, a tiny answer
  if (clientRev !== null && o.delta === true) {
    const d = store.changesSince(clientRev);
    if (d) return { ok: true, rev: d.rev, serverNow: stamp(now), changes: d.events, ...(d.settings ? { settings: settingsOf(store) } : {}), ...extra };
  }
  return { ...listRange(store, from, to, now), rev, ...extra };
}

/** Runs a write under the lock and bumps the revision only when something actually changed. */
function write(deps: Deps, fn: () => ApiResponse): ApiResponse {
  return deps.withLock(() => {
    const r = fn();
    if (r.ok && !r.duplicate && !r.noop) deps.store.bump({ events: r.event ? [r.event] : [] });
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

/**
 * Was this request id recorded before? Looking an id up in the whole sheet is slow (measured: 0.3 to 1.1 s), so the recent rows
 * (read anyway) are looked at first. A phone knows when an operation leaves it for the very first time (`fresh: true`): then
 * the recent rows are enough. A retry says when it was queued (`queuedAt`, epoch ms): it cannot have been written before that,
 * so when the recent rows reach back further (a day of margin for the phone's clock) or are the whole sheet, they are enough
 * too (owner's sync log: an opening waited 1.1 s for this search). Anything else (Siri, an older app) gets the full lookup.
 */
function known(o: Obj, id: string, store: Store): BabyEvent | undefined {
  const tail = store.recent(RECENT_ROWS);
  const hit = tail.find((e) => e.id === id);
  if (hit || o.fresh === true) return hit;
  if (store.count() <= RECENT_ROWS) return undefined; // the recent rows are the whole sheet
  const queuedAt = typeof o.queuedAt === 'number' ? o.queuedAt : NaN;
  const oldest = tail[0] ? parseLocal(tail[0].created) : NaN;
  if (!Number.isNaN(queuedAt) && !Number.isNaN(oldest) && oldest < queuedAt - DAY) return undefined;
  return store.find(id);
}

function logEvent(o: Obj, deps: Deps, now: number): ApiResponse {
  const { store } = deps;
  const id = reqString(o, 'id', 64);
  const existing = known(o, id, store);
  if (existing) return { ok: true, duplicate: true, event: existing, speech: voiceOf(o, store).logged(existing, store.recent(RECENT_ROWS)) };

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
      speech = voiceOf(o, store).vitaminAgain(already);
    } else speech = voiceOf(o, store).logged(e, recent);
  } else speech = voiceOf(o, store).logged(e, [...recent, e]);

  store.append(e);
  return { ok: true, event: e, speech, ...(warning ? { warning } : {}) };
}

function asleep(o: Obj, deps: Deps, now: number): ApiResponse {
  const { store } = deps;
  const id = reqString(o, 'id', 64);
  const existing = known(o, id, store);
  if (existing) return { ok: true, duplicate: true, event: existing, speech: voiceOf(o, store).logged(existing, []) };
  const recent = store.recent(RECENT_ROWS);
  const open = openSleep(recent);
  if (open) return { ok: true, noop: true, event: open, speech: voiceOf(o, store).alreadyAsleep(open) };
  const e = newEvent(o, 'sleep', '', optString(o, 'start', 16), '', now);
  validateEvent(e, now);
  store.append(e);
  return { ok: true, event: e, speech: voiceOf(o, store).logged(e, [e]) };
}

function awake(o: Obj, deps: Deps, now: number): ApiResponse {
  const { store } = deps;
  const id = reqString(o, 'id', 64);
  // Shortcuts always send "start" (their current time); accept it as the wake-up time when no "end" is given.
  const end = optString(o, 'end', 16) || optString(o, 'start', 16);
  const existing = known(o, id, store);
  if (existing) return { ok: true, duplicate: true, event: existing, speech: voiceOf(o, store).awake(sleepMinutes(existing)) };

  const recent = store.recent(RECENT_ROWS);
  const open = openSleep(recent);
  if (open) {
    const closed = { ...open, end };
    validateEvent(closed, now);
    store.replace(closed);
    return { ok: true, event: closed, speech: voiceOf(o, store).awake(sleepMinutes(closed)) };
  }
  // Retry of a request that already closed the latest sleep: nothing to do.
  const latestClosed = live(recent)
    .filter((e) => e.type === 'sleep' && e.end)
    .sort((a, b) => parseLocal(b.end) - parseLocal(a.end))[0];
  if (latestClosed && latestClosed.end === end) {
    return { ok: true, duplicate: true, event: latestClosed, speech: voiceOf(o, store).awake(sleepMinutes(latestClosed)) };
  }
  const e = newEvent(o, 'sleep', '', '', end, now);
  validateEvent(e, now);
  store.append(e);
  return { ok: true, event: e, speech: voiceOf(o, store).awake(null) };
}

function sleepMinutes(e: BabyEvent): number | null {
  if (!e.start || !e.end) return null;
  return (parseLocal(e.end) - parseLocal(e.start)) / MIN;
}

/**
 * (owner) One feedback item: checked, cut to size, stored with the next number. A send that was retried (the same `id`) gets
 * the stored item back and writes nothing. Feedback is not log data: the data revision does not move.
 */
function saveUsage(o: Obj, store: Store, now: number): ApiResponse {
  const user = reqString(o, 'user', 20);
  const install = reqString(o, 'install', 40);
  const version = typeof o.version === 'string' ? o.version.slice(0, 40) : '';
  const days = o.days;
  if (!Array.isArray(days) || days.length === 0 || days.length > USAGE_MAX_DAYS) return fail('bad_request', `days must be 1-${USAGE_MAX_DAYS} days`);
  const out: UsageDay[] = [];
  for (const d of days) {
    if (!isObj(d) || !isDateString(str(d.date)) || !isObj(d.counts)) return fail('bad_request', 'a day needs a date and counts');
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(d.counts)) {
      // a name this server does not know (an app version that still counts something removed or renamed since) is skipped,
      // so the rest of the day is kept
      if (!(k in USAGE_LABELS)) continue;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100_000) return fail('bad_request', 'counts must be whole numbers');
      counts[k] = v;
    }
    // (owner) the state of each insight question that day: shown / on / off by hand / waiting for data
    let states: Record<string, QuestionStateName> | undefined;
    if (d.states !== undefined) {
      if (!isObj(d.states)) return fail('bad_request', 'states must be an object');
      states = {};
      for (const [k, v] of Object.entries(d.states)) {
        if (!(k in USAGE_QUESTIONS)) continue; // a question removed since (an older app version): skipped, not refused
        if (typeof v !== 'string' || !(v in QUESTION_STATES)) return fail('bad_request', `bad question state ${k.slice(0, 40)}`);
        states[k] = v as QuestionStateName;
      }
    }
    out.push({ date: str(d.date), counts, ...(states ? { states } : {}) });
  }
  store.usageSave(user, install, version, out, stamp(now));
  return { ok: true };
}

function addFeedback(o: Obj, store: Store, now: number): ApiResponse {
  const id = reqString(o, 'id', 64);
  const kind = o.kind as FeedbackKind;
  if (!FEEDBACK_KINDS.includes(kind)) return fail('bad_request', 'kind must be bug, idea or other');
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (!text) return fail('bad_request', 'text missing');
  if (text.length > FEEDBACK_TEXT_MAX) return fail('bad_request', `text longer than ${FEEDBACK_TEXT_MAX}`);
  const user = reqString(o, 'user', 20);
  const seen = store.feedbackAll().find((f) => f.id === id);
  if (seen) return { ok: true, duplicate: true, item: seen };
  const version = typeof o.version === 'string' ? o.version.slice(0, 40) : '';
  const log = typeof o.log === 'string' ? o.log.slice(0, FEEDBACK_LOG_MAX) : '';
  return { ok: true, item: store.feedbackAdd({ id, created: stamp(now), user, kind, text, version, log }) };
}

/** The sentences for Siri in the language the request asks for (owner: Hebrew for one phone). */
const voiceOf = (o: Obj, store: Store): Voice => voiceFor(o.lang, () => settingsOf(store).babySex);

/**
 * An event that is about to be changed. Usually it is recent (owner's sync log: "היה לפני" moves the entry just logged), and the
 * recent rows are one fast read; searching the whole sheet for the id took 0.3 to 0.8 s, so that comes only when they lack it.
 */
const lookUp = (store: Store, id: string): BabyEvent | undefined => store.recent(RECENT_ROWS).find((e) => e.id === id) ?? store.find(id);

function update(o: Obj, deps: Deps, now: number): ApiResponse {
  const { store } = deps;
  const id = reqString(o, 'id', 64);
  const base = lookUp(store, id);
  if (!base) return fail('not_found');
  // the version before this edit is kept with the event (one step back), so it can be restored later (owner)
  const next = { ...applyPatch(base, parsePatch(o.patch)), edited: stamp(now), prev: JSON.stringify(coreOf(base)) };
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
  const base = lookUp(deps.store, id);
  if (!base) return fail('not_found');
  if (base.deleted === deleted) return { ok: true, noop: true, event: base };
  const next = { ...base, deleted, edited: stamp(now) };
  deps.store.replace(next);
  return { ok: true, event: next };
}
