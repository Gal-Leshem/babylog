/**
 * Privacy guard: finds forbidden words (names, e-mail addresses, ...) in text.
 * Matching never reveals the word itself: callers only learn WHERE it was found.
 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HEBREW = /[֐-׿]/;
const BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}])';
const BOUNDARY_AFTER = '(?![\\p{L}\\p{N}])';
/** Hebrew one-letter prefixes: and, in, the, like, to, from, that. */
const HEBREW_PREFIX = '[בהוכלמש]{0,2}';

export function parseDenylist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !w.startsWith('#'));
}

export function compileDenylist(words: string[]): RegExp[] {
  return words.map((w) => {
    if (w.includes('@')) return new RegExp(esc(w), 'iu'); // e-mail style: plain substring
    const prefix = HEBREW.test(w) && w.length >= 2 ? HEBREW_PREFIX : '';
    return new RegExp(`${BOUNDARY_BEFORE}${prefix}${esc(w)}${BOUNDARY_AFTER}`, 'iu');
  });
}

/** 1-based line numbers of lines containing any forbidden word. */
export function findLines(text: string, patterns: RegExp[]): number[] {
  const hits: number[] = [];
  text.split('\n').forEach((line, i) => {
    if (patterns.some((p) => p.test(line))) hits.push(i + 1);
  });
  return hits;
}

export const matches = (text: string, patterns: RegExp[]): boolean => patterns.some((p) => p.test(text));
