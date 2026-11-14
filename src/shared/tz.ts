/**
 * Israel time (Asia/Jerusalem), implemented by rule so that the exact same code
 * runs in browsers, Node (tests) and Apps Script without depending on Intl.
 * Verified against ICU in tests/tz.test.ts.
 *
 * DST: starts on the Friday before the last Sunday of March at 02:00 local
 * (UTC+2), ends on the last Sunday of October at 02:00 local (UTC+3).
 */
export const TZ_NAME = 'Asia/Jerusalem';
const MIN = 60_000;
const DAY = 86_400_000;

function lastSundayOfMonth(year: number, month0: number): number {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const dow = new Date(Date.UTC(year, month0, lastDay)).getUTCDay();
  return lastDay - dow;
}

function dstStartUtc(year: number): number {
  return Date.UTC(year, 2, lastSundayOfMonth(year, 2) - 2, 0, 0);
}

function dstEndUtc(year: number): number {
  return Date.UTC(year, 9, lastSundayOfMonth(year, 9) - 1, 23, 0);
}

export function offsetMinutesAt(epochMs: number): number {
  const y = new Date(epochMs).getUTCFullYear();
  return epochMs >= dstStartUtc(y) && epochMs < dstEndUtc(y) ? 180 : 120;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** epoch ms -> 'YYYY-MM-DD HH:mm' in Israel time */
export function formatLocal(epochMs: number): string {
  const d = new Date(epochMs + offsetMinutesAt(epochMs) * MIN);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** epoch ms -> 'YYYY-MM-DD' in Israel time */
export function localDate(epochMs: number): string {
  return formatLocal(epochMs).slice(0, 10);
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateString(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

/**
 * 'YYYY-MM-DD HH:mm' (Israel time) -> epoch ms, or NaN if malformed or the
 * wall-clock time does not exist (spring-forward gap). Ambiguous times
 * (autumn repeat hour) resolve to the first occurrence (summer time).
 */
export function parseLocal(s: string): number {
  const m = LOCAL_RE.exec(s);
  if (!m) return NaN;
  const [y, mo, d, h, mi] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return NaN;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  for (const off of [180, 120]) {
    const candidate = wall - off * MIN;
    if (offsetMinutesAt(candidate) === off && formatLocal(candidate) === s) return candidate;
  }
  return NaN;
}

/** Start of the given local date (00:00 Israel time) as epoch ms. */
export function dayStart(date: string): number {
  return parseLocal(`${date} 00:00`);
}

/** Shift a 'YYYY-MM-DD' date by n days (calendar arithmetic, DST-safe). */
export function addDays(date: string, n: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`bad date: ${date}`);
  const t = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) + n * DAY;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Local hour (0-23) at the given instant. */
export function localHour(epochMs: number): number {
  return +formatLocal(epochMs).slice(11, 13);
}
