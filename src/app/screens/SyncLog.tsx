import { useState } from 'preact/hooks';
import type { SyncLogEntry, SyncWhy } from '../engine';
import { engine } from '../state';

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
const PART: Record<string, string> = { open: 'פתיחת גיליון', read: 'קריאה', find: 'חיפוש', write: 'כתיבה', settings: 'הגדרות', props: 'מאפיינים', lock: 'נעילה' };
/** an entry this slow is marked */
const SLOW_MS = 3_000;

const s = (ms: number) => `${(ms / 1000).toFixed(1)} ש׳`;
const clock = (t: number) => new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem' });
const dayOf = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
/** "היום" / "אתמול" / "16.11": words keep the time and the date from being reordered in right-to-left text */
const day = (t: number) => {
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
    const parts = Object.entries(e.t)
      .filter(([k, v]) => !k.endsWith('#') && v >= 1)
      .map(([k, v]) => `${PART[k] ?? k} ${s(v)}`);
    if (parts.length) lines.push(`בשרת: ${parts.join(' · ')}`);
  }
  return lines;
}

/**
 * The sync log (owner: to see why catching up after opening is sometimes slow). Hidden behind a button in Settings >
 * advanced. Times and sizes only, kept on this phone.
 */
export function SyncLog({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState(() => engine.syncLog());
  const [msg, setMsg] = useState('');
  const copy = () => {
    const text = entries.map((e) => logLines(e).join('\n')).join('\n\n');
    void navigator.clipboard?.writeText(text).then(
      () => setMsg('הועתק'),
      () => setMsg('לא ניתן להעתיק'),
    );
  };
  return (
    <div data-testid="sync-log">
      <div class="actions">
        <button type="button" data-testid="log-back" onClick={onBack}>
          חזרה להגדרות
        </button>
        <button type="button" data-testid="log-refresh" onClick={() => setEntries(engine.syncLog())}>
          רענון
        </button>
        <button type="button" data-testid="log-copy" onClick={copy}>
          העתקה
        </button>
        {msg && <span class="muted">{msg}</span>}
      </div>
      <h2>יומן סנכרון</h2>
      <p class="muted">הבקשות האחרונות לשרת מהמכשיר הזה, החדשה למעלה. זמנים וגדלים בלבד. מסומן: מעל 3 שניות.</p>
      {entries.length === 0 && <p class="empty">עוד אין רישומים</p>}
      <ul class="loglist">
        {entries.map((e, i) => {
          const slow = e.totalMs > SLOW_MS || (e.sinceReturnMs ?? 0) > SLOW_MS || e.result !== 'ok';
          return (
            <li key={`${e.at}-${i}`} class={slow ? 'slow' : ''} data-testid="log-entry">
              {logLines(e).map((l, j) => (
                <div key={j} class={j === 0 ? 'lh' : 'ld'}>
                  <bdi>{l}</bdi>
                </div>
              ))}
            </li>
          );
        })}
      </ul>
      <div class="actions">
        <button
          type="button"
          class="danger"
          data-testid="log-clear"
          onClick={() => {
            engine.clearSyncLog();
            setEntries([]);
          }}
        >
          ניקוי היומן
        </button>
      </div>
    </div>
  );
}
