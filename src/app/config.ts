export interface Config {
  url: string;
  key: string;
  /** The display name of this device's user (one of the two parent names). */
  me: string;
}

export type NightMode = 'auto' | 'always' | 'never';

export interface Prefs {
  nightMode: NightMode;
}

export const DEFAULT_PREFS: Prefs = { nightMode: 'auto' };

/** Setup code: "BL1." + base64url(JSON {u: web app url, k: key}). */
export function decodeSetupCode(code: string): { url: string; key: string } | null {
  const trimmed = code.trim().replace(/\s+/g, '');
  if (!trimmed.startsWith('BL1.')) return null;
  try {
    const b64 = trimmed.slice(4).replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const o = JSON.parse(json) as { u?: unknown; k?: unknown };
    if (typeof o.u !== 'string' || typeof o.k !== 'string' || !/^https:\/\//.test(o.u) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(o.u) || o.k.length < 8) return null;
    return { url: o.u, key: o.k };
  } catch {
    return null;
  }
}

export function encodeSetupCode(url: string, key: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ u: url, k: key }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `BL1.${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
