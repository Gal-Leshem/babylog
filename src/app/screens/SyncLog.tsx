import { useState } from 'preact/hooks';
import { engine } from '../state';
import { SLOW_MS, logLines } from '../synclog';

export { day, logLines } from '../synclog';

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
