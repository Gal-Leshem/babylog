export interface Config {
  url: string;
  key: string;
  /** The display name of this device's user (one of the two parent names). */
  me: string;
}

export type NightMode = 'auto' | 'always' | 'never';

/** Colour of the night theme: the original amber, or a dim red for a dark room. */
export type NightTint = 'amber' | 'red';

/** Which part of the summary tab is shown (remembered per device). */
export type SummaryView = 'day' | 'insights';

/** History: one day at a time, or the last 24 hours across midnight (owner; remembered per device). */
export type HistoryView = 'day' | 'last24';

export interface Prefs {
  nightMode: NightMode;
  nightTint: NightTint;
  summaryView: SummaryView;
  historyView: HistoryView;
}

export const DEFAULT_PREFS: Prefs = { nightMode: 'auto', nightTint: 'amber', summaryView: 'day', historyView: 'day' };

/** An address the app may talk to: https, or plain http only for local development. */
export const isServerUrl = (u: string): boolean => /^https:\/\//.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)/.test(u);

/** The editor's private test address of a script. It only works for the owner inside the browser, never from a phone. */
export const isEditorTestUrl = (u: string): boolean => /\/dev\/?$/.test(u);

/** Setup code: "BL1." + base64url(JSON {u: web app url, k: key}). */
export const decodeSetupCode = (code: string): { url: string; key: string } | null => decodeCode(code, 'BL1.');

/**
 * (family servers) The owner's admin code for one family's server: "BLA." + the same shape. It opens that family's feedback
 * only (read and clear), never its log. Printed by setup() in the family's script, kept only on the owner's phone.
 */
export const decodeAdminCode = (code: string): { url: string; key: string } | null => decodeCode(code, 'BLA.');

function decodeCode(code: string, prefix: string): { url: string; key: string } | null {
  const trimmed = code.trim().replace(/\s+/g, '');
  if (!trimmed.startsWith(prefix)) return null;
  try {
    const b64 = trimmed.slice(4).replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const o = JSON.parse(json) as { u?: unknown; k?: unknown };
    if (typeof o.u !== 'string' || typeof o.k !== 'string' || !isServerUrl(o.u) || o.k.length < 8) return null;
    return { url: o.u, key: o.k };
  } catch {
    return null;
  }
}

export const encodeAdminCode = (url: string, key: string): string => `BLA.${encodeSetupCode(url, key).slice(4)}`;

export function encodeSetupCode(url: string, key: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ u: url, k: key }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `BL1.${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
