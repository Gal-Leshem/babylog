export type EventType = 'feed' | 'diaper' | 'sleep' | 'vitamin_d';
export type Source = 'app' | 'siri';

export const EVENT_TYPES: readonly EventType[] = ['feed', 'diaper', 'sleep', 'vitamin_d'];
export const FEED_DETAILS = ['left', 'right'] as const;
export const DIAPER_DETAILS = ['wet', 'poop', 'both'] as const;

/** One row of the Events sheet. Times are 'YYYY-MM-DD HH:mm' in Israel time; '' when unset. */
export interface BabyEvent {
  id: string;
  type: EventType;
  detail: string;
  start: string;
  end: string;
  user: string;
  source: Source;
  note: string;
  created: string;
  edited: string;
  deleted: boolean;
}

export interface Settings {
  babyName: string;
  mergeWindowMin: number;
  /** The two parents' display names, as chosen in the app (kept only in the private sheet). */
  parents: [string, string];
}

export const DEFAULT_SETTINGS: Settings = {
  babyName: 'התינוק',
  mergeWindowMin: 20,
  parents: ['הורה 1', 'הורה 2'],
};
