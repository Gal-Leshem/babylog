import type { Medicine } from './medicines';

/** `medicine`: a dose of a medicine defined in Settings (detail = the medicine's id); vitamin D keeps its own type. */
export type EventType = 'feed' | 'diaper' | 'sleep' | 'vitamin_d' | 'medicine';
export type Source = 'app' | 'siri';

export const EVENT_TYPES: readonly EventType[] = ['feed', 'diaper', 'sleep', 'vitamin_d', 'medicine'];
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
  /**
   * What the event was before its last edit (JSON of type, detail, start, end, note), so one edit can be taken back later,
   * from either phone (owner). Empty or missing = never edited. Rows written before this field existed have none.
   */
  prev?: string;
}

/** The parts of an event an edit can change (and that `prev` keeps). */
export interface EventCore {
  type: EventType;
  detail: string;
  start: string;
  end: string;
  note: string;
}

export const coreOf = (e: EventCore): EventCore => ({ type: e.type, detail: e.detail, start: e.start, end: e.end, note: e.note });

/** The version before the last edit, or null (none, or unreadable). */
export function previousOf(e: BabyEvent): EventCore | null {
  if (!e.prev) return null;
  try {
    const p = JSON.parse(e.prev) as Partial<EventCore>;
    if (typeof p !== 'object' || p === null || typeof p.type !== 'string') return null;
    return { type: p.type as EventType, detail: String(p.detail ?? ''), start: String(p.start ?? ''), end: String(p.end ?? ''), note: String(p.note ?? '') };
  } catch {
    return null;
  }
}

/** The baby's sex, for the Hebrew wording only ("ישן" / "ישנה", "התעורר" / "התעוררה"). */
export type BabySex = 'boy' | 'girl';

export interface Settings {
  babyName: string;
  /** (owner) chosen in Settings; the wording follows it. Missing (older sheets) = boy, the wording used before. */
  babySex?: BabySex;
  /** (owner) the baby's date of birth, 'YYYY-MM-DD', set in Settings; missing until the parents set it. */
  babyBirth?: string;
  mergeWindowMin: number;
  /** The two parents' display names, as chosen in the app (kept only in the private sheet). */
  parents: [string, string];
  /** Medicines besides vitamin D, active and archived (kept in the sheet's "Medicines" tab). */
  medicines: Medicine[];
}

export const DEFAULT_SETTINGS: Settings = {
  babyName: 'התינוק',
  mergeWindowMin: 20,
  parents: ['הורה 1', 'הורה 2'],
  medicines: [],
};
