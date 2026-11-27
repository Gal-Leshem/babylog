import type { UsageDayRow } from '../shared/protocol';
import { QUESTION_STATES, USAGE_LABELS, USAGE_QUESTIONS } from '../shared/usage';
import { type KV, browserStorage } from './storage';

/**
 * (owner, family servers) The other families' servers whose feedback the owner reads: a private label (only on this phone, never
 * sent anywhere), the server's address and its admin key (feedback only, never the log). Kept on the owner's phone only.
 */
export interface FamilySource {
  label: string;
  url: string;
  key: string;
}

export const FAMILIES_KEY = 'bl.families.v1';

export function loadFamilies(storage: KV = browserStorage): FamilySource[] {
  const v = storage.get<FamilySource[]>(FAMILIES_KEY);
  return Array.isArray(v) ? v.filter((f) => f && typeof f.url === 'string' && typeof f.key === 'string' && typeof f.label === 'string') : [];
}

export function saveFamilies(list: readonly FamilySource[], storage: KV = browserStorage): void {
  if (list.length) storage.set(FAMILIES_KEY, list);
  else storage.remove(FAMILIES_KEY);
}

/** One server's usage days as the owner's phone got them, or why there are none. */
export interface UsageGroup {
  label: string;
  rows: readonly UsageDayRow[] | 'old' | 'error';
}

/**
 * (owner, F15 option B) Every server's usage days as one text for pasting into a chat: per server, per phone and day, the counts in
 * the order of `USAGE_LABELS` and the questions' states, in Hebrew. No names (the server sends "הורה 1" / "הורה 2").
 */
export function usageText(groups: readonly UsageGroup[]): string {
  const order = Object.keys(USAGE_LABELS);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const day = (r: UsageDayRow): string => {
    const head = [r.date, r.parent, `טלפון ${r.phone}`, r.version ? `גרסה ${r.version}` : ''].filter(Boolean).join(' · ');
    const counts = Object.entries(r.counts)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([k, n]) => `${USAGE_LABELS[k] ?? k} ${n}`);
    const states = Object.entries(r.states ?? {}).map(
      ([q, st]) => `${USAGE_QUESTIONS[q as keyof typeof USAGE_QUESTIONS] ?? q}: ${QUESTION_STATES[st as keyof typeof QUESTION_STATES] ?? st}`,
    );
    return [head, counts.length ? counts.join(' · ') : 'אין פעולות', ...(states.length ? [`שאלות: ${states.join(' · ')}`] : [])].join('\n');
  };
  return groups
    .map((g) => {
      const body = g.rows === 'old' ? 'השרת עוד לא מעודכן' : g.rows === 'error' ? 'לא ענה' : g.rows.length ? g.rows.map(day).join('\n\n') : 'אין נתונים';
      return `== ${g.label} ==\n${body}`;
    })
    .join('\n\n');
}
