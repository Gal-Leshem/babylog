/**
 * Bottles (F18, owner): expressed milk and formula. A bottle is an event of type `bottle` whose detail holds the kind and the
 * amounts: `formula:120` (120 ml given, all of it eaten) or `formula:120:30` (30 ml left in the bottle). Keeping the amounts in
 * the detail means nothing else changes: the sheet, the sync protocol, edits and "take back the edit" (`prev`) carry them as
 * they carry any detail.
 */
import type { Settings } from './types';

export type BottleKind = 'expressed' | 'formula';
export const BOTTLE_KINDS: readonly BottleKind[] = ['expressed', 'formula'];

/** Amounts in ml: a bottle is 5 to 500 ml; the leftover is 0 up to what was given. */
export const BOTTLE_MIN_ML = 5;
export const BOTTLE_MAX_ML = 500;
/** One tap of − / + in the window, the toast and the form. */
export const BOTTLE_STEP_ML = 10;

export interface Bottle {
  kind: BottleKind;
  /** ml given (prepared) */
  given: number;
  /** ml left in the bottle */
  left: number;
}

const isInt = (s: string | undefined) => s !== undefined && /^\d{1,3}$/.test(s);

/** The bottle in an event's detail, or null when the detail is not a valid bottle. */
export function parseBottle(detail: string): Bottle | null {
  const [kind, given, left, ...rest] = detail.split(':');
  if (rest.length || !BOTTLE_KINDS.includes(kind as BottleKind) || !isInt(given) || (left !== undefined && !isInt(left))) return null;
  const g = Number(given);
  const l = left === undefined ? 0 : Number(left);
  if (g < BOTTLE_MIN_ML || g > BOTTLE_MAX_ML || l > g) return null;
  return { kind: kind as BottleKind, given: g, left: l };
}

/** The detail for a bottle (the leftover only when there is one). */
export const bottleDetail = (b: Bottle): string => `${b.kind}:${b.given}${b.left ? `:${b.left}` : ''}`;

/** ml eaten */
export const eaten = (b: Bottle): number => b.given - b.left;

export const clampGiven = (ml: number): number => Math.min(BOTTLE_MAX_ML, Math.max(BOTTLE_MIN_ML, Math.round(ml)));

// ---------- the family's feeding settings ----------

/** Which kinds of feeding the family uses, and the amount each new bottle starts from (shared by both phones). */
export interface Feeding {
  breast: boolean;
  expressed: boolean;
  formula: boolean;
  expressedMl: number;
  formulaMl: number;
}

/** Families set up before bottles: breastfeeding only (nothing changes for them). */
export const DEFAULT_FEEDING: Feeding = { breast: true, expressed: false, formula: false, expressedMl: 60, formulaMl: 90 };

export const feedingOf = (s: Pick<Settings, 'feeding'>): Feeding => ({ ...DEFAULT_FEEDING, ...(s.feeding ?? {}) });

/** The bottle kinds turned on, in the order shown. */
export const bottleKindsOn = (f: Feeding): BottleKind[] => BOTTLE_KINDS.filter((k) => f[k]);

export const defaultMl = (f: Feeding, kind: BottleKind): number => (kind === 'formula' ? f.formulaMl : f.expressedMl);
