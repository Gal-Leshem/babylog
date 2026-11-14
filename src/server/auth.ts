/** Constant-time string comparison (best effort in JS). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Builds the key check. `stored` is the secret from the script properties;
 * `fixed` is only ever non-empty in the TEST build, where CI derives it.
 * An empty key never matches anything.
 */
export function makeCheckKey(stored: string | null, fixed: string): (k: string) => boolean {
  return (k: string) => {
    if (!k) return false;
    if (stored && safeEqual(k, stored)) return true;
    if (fixed && safeEqual(k, fixed)) return true;
    return false;
  };
}

export function encodeInstallCode(url: string, key: string, b64: (s: string) => string): string {
  return `BL1.${b64(JSON.stringify({ u: url, k: key }))}`;
}
