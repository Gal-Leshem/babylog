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
