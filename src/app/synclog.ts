import type { SyncLogEntry, SyncWhy } from './engine';

/** The words of the sync log (Settings > מתקדם > "יומן סנכרון"), also used when it is copied or attached to feedback. */
const WHY: Record<SyncWhy, string> = {
  open: 'פתיחה',
  return: 'חזרה לאפליקציה',
  poll: 'בדיקה',
  tap: 'רישום',
  full: 'רענון מלא',
  retry: 'ניסיון חוזר',
  online: 'חזרת רשת',
  manual: 'סנכרן עכשיו',
};
const RESULT: Record<Exclude<SyncLogEntry['result'], 'ok'>, string> = { offline: 'אין חיבור', timeout: 'פג הזמן', error: 'שגיאת שרת', auth: 'מפתח לא תקין' };
/** where the server spent its time */
const PART: Record<string, string> = { open: 'פתיחת גיליון', sheet: 'לשונית ושורות', read: 'קריאה', find: 'חיפוש', write: 'כתיבה', settings: 'הגדרות', props: 'מאפיינים', lock: 'נעילה', unlock: 'שחרור נעילה' };
/** an entry this slow is marked */
export const SLOW_MS = 3_000;

const s = (ms: number) => `${(ms / 1000).toFixed(1)} ש׳`;
const clock = (t: number) => new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem' });
const dayOf = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
/** "היום" / "אתמול" / "16.11": words keep the time and the date from being reordered in right-to-left text (also the feedback list) */
export const day = (t: number) => {
  const d = dayOf(t);
  const today = dayOf(Date.now());
  if (d === today) return 'היום';
  if (d === dayOf(Date.now() - 86_400_000)) return 'אתמול';
  return `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`;
};

/** The lines of one entry (also used for copying as text). */
export function logLines(e: SyncLogEntry): string[] {
  const lines = [`${clock(e.at)} · ${day(e.at)} · ${WHY[e.why]} · ${s(e.totalMs)}${e.result === 'ok' ? '' : ` · ${RESULT[e.result]}`}`];
  if (e.sinceReturnMs !== undefined) lines.push(`מהפתיחה עד שהנתונים הוצגו: ${s(e.sinceReturnMs)}`);
  if (e.result === 'ok') {
    const what = e.list ? `${e.delta ? 'שינויים בלבד' : 'נתונים חדשים'}${e.events !== undefined ? `: ${e.events} אירועים` : ''}${e.kb !== undefined ? `, ${e.kb}KB` : ''}` : 'בלי שינוי';
    lines.push(`${e.serverMs !== null ? `שרת ${s(e.serverMs)} · רשת וגוגל ${s(Math.max(0, e.totalMs - e.serverMs))} · ` : ''}${what}${e.ops ? ` · ${e.ops} נשלחו` : ''}`);
  }
  if (e.t) {
    const timed = Object.entries(e.t).filter(([k]) => !k.endsWith('#'));
    // parts that would read "0.0" are left out (owner's log 3 had "פתיחת גיליון 0.0 ש׳" on every line)
    const parts = timed.filter(([, v]) => v >= 50).map(([k, v]) => `${PART[k] ?? k} ${s(v)}`);
    // (owner's sync log 3) what the server did not time, so a slow request shows how much of it is still unexplained
    const rest = e.serverMs !== null ? e.serverMs - timed.reduce((sum, [, v]) => sum + v, 0) : 0;
    if (rest >= 100) parts.push(`לא מדוד ${s(rest)}`);
    if (parts.length) lines.push(`בשרת: ${parts.join(' · ')}`);
  }
  return lines;
}
