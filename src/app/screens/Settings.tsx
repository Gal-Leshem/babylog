import { useEffect, useState } from 'preact/hooks';
import type { NightMode } from '../config';
import { engine, setNightMode, useEngine, usePrefs } from '../state';

const NIGHT: [NightMode, string][] = [
  ['auto', 'אוטומטי'],
  ['always', 'תמיד'],
  ['never', 'אף פעם'],
];

export function Settings() {
  const st = useEngine();
  const prefs = usePrefs();
  const me = engine.getConfig()?.me ?? '';
  const [baby, setBaby] = useState(st.settings.babyName);
  const [p1, setP1] = useState(st.settings.parents[0]);
  const [p2, setP2] = useState(st.settings.parents[1]);
  const [win, setWin] = useState(String(st.settings.mergeWindowMin));
  const [msg, setMsg] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  // Pick up server changes (e.g. the other parent renamed something) when nothing is being edited.
  useEffect(() => {
    setBaby(st.settings.babyName);
    setP1(st.settings.parents[0]);
    setP2(st.settings.parents[1]);
    setWin(String(st.settings.mergeWindowMin));
  }, [st.settings.babyName, st.settings.parents[0], st.settings.parents[1], st.settings.mergeWindowMin]);

  const save = () => {
    const n = Number(win);
    const res = engine.dispatch({
      action: 'settings',
      set: { babyName: baby.trim(), parents: [p1.trim(), p2.trim()], mergeWindowMin: n },
    });
    if (!res.ok) return setMsg('לא נשמר: בדקו ששמות ההורים והתינוק מלאים, ושחלון האיחוד הוא בין 0 ל-180 דקות');
    // keep "who am I" pointing at the same parent if that name was edited
    const old = st.settings.parents;
    if (me === old[0] && p1.trim() !== old[0]) engine.setMe(p1.trim());
    else if (me === old[1] && p2.trim() !== old[1]) engine.setMe(p2.trim());
    setMsg('נשמר');
  };

  return (
    <section class="page" data-testid="settings">
      <h2>הגדרות</h2>

      <h3>מי אני (במכשיר הזה)</h3>
      <div class="chips" role="radiogroup">
        {st.settings.parents.map((p) => (
          <button type="button" key={p} class={`chip ${p === me ? 'on' : ''}`} data-testid="me-option" onClick={() => engine.setMe(p)}>
            {p}
          </button>
        ))}
      </div>

      <h3>פרטים (נשמרים בגיליון)</h3>
      <label class="fl">שם התינוק</label>
      <input data-testid="baby-name" value={baby} maxLength={40} onInput={(e) => setBaby((e.target as HTMLInputElement).value)} />
      <label class="fl">הורה 1</label>
      <input data-testid="parent-1" value={p1} maxLength={20} onInput={(e) => setP1((e.target as HTMLInputElement).value)} />
      <label class="fl">הורה 2</label>
      <input data-testid="parent-2" value={p2} maxLength={20} onInput={(e) => setP2((e.target as HTMLInputElement).value)} />
      <label class="fl">חלון איחוד הנקות (דקות)</label>
      <input data-testid="merge-window" type="number" inputMode="numeric" min={0} max={180} value={win} onInput={(e) => setWin((e.target as HTMLInputElement).value)} />
      <div class="actions">
        <button type="button" class="primary" data-testid="save-settings" onClick={save}>
          שמירה
        </button>
        {msg && <span data-testid="settings-msg">{msg}</span>}
      </div>

      <h3>מצב לילה</h3>
      <div class="chips" role="radiogroup">
        {NIGHT.map(([id, label]) => (
          <button type="button" key={id} class={`chip ${prefs.nightMode === id ? 'on' : ''}`} data-testid={`night-${id}`} onClick={() => setNightMode(id)}>
            {label}
          </button>
        ))}
      </div>
      <p class="muted">אוטומטי: בין 21:00 ל-07:00, או כשהמכשיר במצב כהה.</p>

      <h3>סנכרון</h3>
      <p class="muted" data-testid="sync-info">
        {st.pending ? `${st.pending} ממתינים לסנכרון` : 'הכל מסונכרן'}
        {st.lastSync ? ` · עודכן ${new Date(st.lastSync).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })}` : ''}
      </p>
      <div class="actions">
        <button type="button" data-testid="sync-now" onClick={() => void engine.flush().then(() => engine.refresh())}>
          סנכרן עכשיו
        </button>
        {st.sheetUrl && (
          <a class="btnlike" href={st.sheetUrl} target="_blank" rel="noopener noreferrer" data-testid="sheet-link">
            פתיחת הגיליון (במחשב)
          </a>
        )}
      </div>

      <h3>חיבור</h3>
      <div class="actions">
        <button
          type="button"
          class="danger"
          data-testid="reset"
          onClick={() => {
            if (!confirmReset) return setConfirmReset(true);
            engine.reset();
          }}
        >
          {confirmReset ? 'לחצו שוב לאישור — ינתק ויימחק מהמכשיר' : 'ניתוק מהחשבון'}
        </button>
      </div>
      <p class="muted">גרסה {__APP_COMMIT__}</p>
    </section>
  );
}
