import type { UsageTotal } from './protocol';

/**
 * (owner, family servers) Every server (the owner's and each family's) runs as the owner's free Google account, and they share
 * one daily quota of property reads/writes (50,000 on a free account, Google's quotas page, November 2026). When it runs out every
 * server fails until the next day. Nothing reports what is left, so the phones count their requests and the owner's phone
 * estimates the calls from them (the performance session's estimate, REFACTOR_PLAN section 8).
 */
export const DAILY_PROPS_QUOTA = 50_000;
export const WARN_SHARE = 0.75;
/** One family is "far above the others" at this many times the median (only with three servers or more). */
export const HEAVY_FACTOR = 3;

/** About how many property calls a day of requests cost: one per request, three more per operation, two per phone's usage beacon. */
export const propsEstimate = (t: Pick<UsageTotal, 'requests' | 'ops' | 'phones'>): number => t.requests + 3 * t.ops + 2 * t.phones;

export interface Load {
  label: string;
  /** Estimated property calls for the day, or null when that server did not answer. */
  calls: number | null;
}

export function quotaCheck(loads: readonly Load[]): { total: number; share: number; over: boolean; heavy: string[] } {
  const known = loads.filter((l): l is Load & { calls: number } => l.calls !== null);
  const total = known.reduce((a, l) => a + l.calls, 0);
  const share = total / DAILY_PROPS_QUOTA;
  const sorted = known.map((l) => l.calls).sort((a, b) => a - b);
  const median = sorted.length ? (sorted[(sorted.length - 1) >> 1]! + sorted[sorted.length >> 1]!) / 2 : 0;
  const heavy = known.length >= 3 && median > 0 ? known.filter((l) => l.calls > HEAVY_FACTOR * median).map((l) => l.label) : [];
  return { total, share, over: share > WARN_SHARE, heavy };
}
