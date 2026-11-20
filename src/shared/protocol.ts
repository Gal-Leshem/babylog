import type { MedicineChange } from './medicines';
import type { BabyEvent, EventType, Settings, Source } from './types';

export const API_VERSION = '0.5.0';

export interface EventPatch {
  type?: EventType;
  detail?: string;
  start?: string;
  end?: string;
  note?: string;
}

/** The actions that change data; only these may travel inside `sync`. */
export type WriteRequest = Extract<ApiRequest, { action: 'log' | 'asleep' | 'awake' | 'update' | 'delete' | 'restore' | 'settings' }>;

export type ApiRequest =
  | { action: 'ping' }
  /** Cheap check: returns only the data revision, so clients can tell whether anything changed. */
  | { action: 'poll' }
  | {
      action: 'log';
      id: string;
      type: EventType;
      detail: string;
      start: string;
      end?: string;
      user: string;
      source: Source;
      note?: string;
    }
  | { action: 'asleep'; id: string; user: string; source: Source; start: string }
  | { action: 'awake'; id: string; user: string; source: Source; end: string }
  | { action: 'update'; id: string; patch: EventPatch }
  | { action: 'delete'; id: string }
  | { action: 'restore'; id: string }
  | { action: 'list'; from: string; to: string }
  /**
   * One round trip (API 0.4.0): applies `ops` in order, then answers `unchanged` when nothing else changed since `rev`
   * (the revision the phone holds), otherwise the list for the range. Without `rev` the list is always returned.
   * An operation marked `fresh` is leaving the phone for the first time, so the server skips the slow "seen this id?" lookup;
   * a retry says when it was queued (`queuedAt`), which usually spares that lookup too.
   */
  /**
   * `delta` (API 0.5.0): the phone can take `changes` instead of the list: when the server's journal of recent changes reaches
   * back to `rev`, the answer carries only the events changed since then (in their new state, deleted ones too, marked).
   */
  | { action: 'sync'; from: string; to: string; rev?: string; ops?: (ApiRequest & { fresh?: true; queuedAt?: number })[]; debug?: true; delta?: true }
  | { action: 'status' }
  /**
   * (owner) Feedback: a bug, an idea or anything else, kept in the sheet's "משוב" tab with a number the server assigns (never
   * reused, also not after clearing). `id` makes a retried send harmless. Sent directly by the app, not through `sync`.
   */
  | { action: 'feedback'; id: string; kind: FeedbackKind; text: string; user: string; version?: string; log?: string }
  | { action: 'feedbackList' }
  | { action: 'feedbackClear' }
  /** `medicines` saves medicines one by one (by id); a removal is allowed only before any dose was logged. */
  | { action: 'settings'; set?: Partial<Omit<Settings, 'medicines'>> & { medicines?: MedicineChange[] } };

export type FeedbackKind = 'bug' | 'idea' | 'other';
export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['bug', 'idea', 'other'];
/** Longest feedback text, and longest attached sync log (characters). */
export const FEEDBACK_TEXT_MAX = 2000;
export const FEEDBACK_LOG_MAX = 4000;

/** One feedback item as stored: `no` is the server's number (#N), `created` local time "YYYY-MM-DD HH:mm". */
export interface FeedbackItem {
  no: number;
  id: string;
  created: string;
  user: string;
  kind: FeedbackKind;
  text: string;
  version: string;
  log: string;
}

/** What goes over the wire: the request plus the shared secret. */
export type WireRequest = ApiRequest & { key: string };

export type ErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'unknown_action'
  | 'invalid_event'
  | 'not_found'
  | 'sleep_already_open'
  | 'server_error';

export interface ApiError {
  ok: false;
  error: ErrorCode;
  detail?: string;
}

export interface ApiOk {
  ok: true;
  /** Sentence for Siri to say (English). */
  speech?: string;
  /** The request id had already been recorded; nothing was written again. */
  duplicate?: boolean;
  /** Nothing needed to change (e.g. asleep while already asleep). */
  noop?: boolean;
  warning?: string;
  event?: BabyEvent;
  events?: BabyEvent[];
  settings?: Settings;
  serverNow?: string;
  /** Data revision: changes whenever an event or a setting is written through the API. */
  rev?: string;
  sheetUrl?: string;
  version?: string;
  /** `sync`: one answer per operation sent, in order (shorter when the batch stopped on a server error). */
  results?: ApiResponse[];
  /** `feedback`: the item as stored (with its number); `feedbackList` / `feedbackClear`: all items, oldest first. */
  item?: FeedbackItem;
  feedback?: FeedbackItem[];
  /** `sync`: nothing changed on the server since the revision the phone sent (apart from its own operations). */
  unchanged?: true;
  /**
   * `sync` with `delta`: instead of the list, the events changed since the phone's revision (deleted ones marked `deleted`),
   * and `settings` only when they changed. Anything else the phone holds stays as it is.
   */
  changes?: BabyEvent[];
  /** Time the server spent on the request, in milliseconds (the real server only). */
  ms?: number;
  /** With `debug: true` in the request: where the server spent its time (milliseconds and calls per kind of work). */
  t?: Record<string, number>;
}

export type ApiResponse = ApiOk | ApiError;
