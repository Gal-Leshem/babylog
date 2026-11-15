import type { BabyEvent, EventType, Settings, Source } from './types';

export const API_VERSION = '0.2.0';

export interface EventPatch {
  type?: EventType;
  detail?: string;
  start?: string;
  end?: string;
  note?: string;
}

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
  | { action: 'status' }
  | { action: 'settings'; set?: Partial<Settings> };

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
}

export type ApiResponse = ApiOk | ApiError;
