import type { BabyEvent } from '../shared/types';

/**
 * "Changes since your version" (owner, after reading the sync log): the last changes, kept next to the revision, so a phone
 * that is a little behind gets only what changed instead of the whole fortnight, and the server does not open the sheet.
 *
 * The journal covers the revisions after `base` up to `head`: every event changed in that span, in its newest state (an event
 * changed twice is kept once, at its later revision), and whether the settings changed. It is kept small enough for one script
 * property (`MAX_BYTES`); the oldest changes drop out first and `base` moves with them. Whenever the journal cannot vouch for
 * a revision (unknown, older than `base`, a journal that does not end at the current revision) the answer is the full list,
 * exactly as before.
 */
export interface Journal {
  base: number;
  head: number;
  items: JournalItem[];
}
/** One change: `r` the revision that made it; `e` an event in its new state, or `s` = the settings changed. */
export interface JournalItem {
  r: number;
  e?: BabyEvent;
  s?: 1;
}
/** What one revision changed. */
export interface Change {
  events: readonly BabyEvent[];
  settings?: boolean;
}
export interface Since {
  rev: string;
  events: BabyEvent[];
  settings: boolean;
}

/** A script property value holds about 9 KB (bytes: Hebrew letters take two). */
export const MAX_BYTES = 8_000;

const num = (s: string | null | undefined): number | null => (s !== null && s !== undefined && /^\d+$/.test(s) ? Number(s) : null);

/** UTF-8 length without TextEncoder (not available in Apps Script). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4; // a surrogate pair (emoji): four bytes for the two halves
      i++;
    } else n += 3;
  }
  return n;
}

export function parseJournal(json: string | null | undefined): Journal | null {
  if (!json) return null;
  try {
    const j = JSON.parse(json) as Journal;
    if (typeof j?.base === 'number' && typeof j.head === 'number' && Array.isArray(j.items) && j.base <= j.head) return j;
  } catch {
    /* unreadable: as if there were none */
  }
  return null;
}

/**
 * The journal after the revision moved from `prev` to `next`. Without `change` (a write that did not say what it changed) the
 * journal starts over empty at `next`, so nobody is told "only this changed" across it. A journal that does not end at `prev`
 * (lost, or written by an older server) also starts over, from `prev`.
 */
export function record(j: Journal | null, prev: string, next: string, change: Change | undefined, maxBytes = MAX_BYTES): Journal {
  const p = num(prev);
  const n = num(next);
  if (n === null) return { base: 0, head: 0, items: [] };
  if (!change || p === null) return { base: n, head: n, items: [] };
  const ids = new Set(change.events.map((e) => e.id));
  const kept = j && j.head === p ? j.items.filter((it) => !(it.e && ids.has(it.e.id)) && !(it.s && change.settings)) : [];
  const out: Journal = { base: j && j.head === p ? j.base : p, head: n, items: kept };
  for (const e of change.events) out.items.push({ r: n, e });
  if (change.settings) out.items.push({ r: n, s: 1 });
  while (out.items.length && utf8Bytes(JSON.stringify(out)) > maxBytes) out.base = out.items.shift()!.r;
  // one change too large for the journal on its own: nobody can be served from it
  if (utf8Bytes(JSON.stringify(out)) > maxBytes) return { base: n, head: n, items: [] };
  return out;
}

/** What changed after the phone's revision `rev`, or null when the journal cannot tell (then the full list is sent). */
export function since(j: Journal | null, rev: string, current: string): Since | null {
  const r = num(rev);
  const c = num(current);
  if (!j || r === null || c === null || j.head !== c || r < j.base || r > j.head) return null;
  const items = j.items.filter((it) => it.r > r);
  return { rev: String(j.head), events: items.flatMap((it) => (it.e ? [it.e] : [])), settings: items.some((it) => it.s) };
}
