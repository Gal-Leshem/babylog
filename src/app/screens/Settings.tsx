import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { NightMode, NightTint } from '../config';
import { engine, setNightMode, setNightTint, useEngine, usePrefs } from '../state';
import { Medicines } from './Medicines';
import { Feedback } from './Feedback';
import { Privacy } from './Privacy';
import { SyncLog } from './SyncLog';

const NIGHT: [NightMode, string][] = [
  ['auto', 'אוטומטי'],
  ['always', 'תמיד'],
  ['never', 'אף פעם'],
];

const SEX: ['boy' | 'girl', string][] = [
  ['boy', 'בן'],
  ['girl', 'בת'],
];

const TINT: [NightTint, string][] = [
  ['amber', 'ענבר'],
  ['red', 'אדום עמום'],
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
  const [msgWhere, setMsgWhere] = useState<'details' | 'behaviour'>('details');
  const [confirmReset, setConfirmReset] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [medsOpen, setMedsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const synced = useRef(JSON.stringify([st.settings.babyName, st.settings.parents[0], st.settings.parents[1], st.settings.mergeWindowMin]));

  // Pick up server changes (e.g. the other parent renamed something), but only when the values really
  // changed and never over something that is being typed.
  useEffect(() => {
    const now = JSON.stringify([st.settings.babyName, st.settings.parents[0], st.settings.parents[1], st.settings.mergeWindowMin]);
    if (now === synced.current) return;
    synced.current = now;
    if (dirty) return;
    setBaby(st.settings.babyName);
    setP1(st.settings.parents[0]);
    setP2(st.settings.parents[1]);
    setWin(String(st.settings.mergeWindowMin));
  }, [st.settings.babyName, st.settings.parents[0], st.settings.parents[1], st.settings.mergeWindowMin, dirty]);

  const edit = (set: (v: string) => void) => (e: Event) => {
    setDirty(true);
    setMsg('');
    set((e.target as HTMLInputElement).value);
  };

  const save = (where: 'details' | 'behaviour') => {
    setMsgWhere(where);
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
    setDirty(false);
    setMsg('נשמר');
  };

  if (fbOpen) {
    return (
      <section class="page" data-testid="settings">
        <Feedback onBack={() => setFbOpen(false)} />
      </section>
    );
  }

  if (privacyOpen) {
    return (
      <section class="page" data-testid="settings">
        <Privacy onBack={() => setPrivacyOpen(false)} />
      </section>
    );
  }

  if (logOpen) {
    return (
      <section class="page" data-testid="settings">
        <SyncLog onBack={() => setLogOpen(false)} />
      </section>
    );
  }

  if (medsOpen) {
    return (
      <section class="page" data-testid="settings">
        <Medicines onBack={() => setMedsOpen(false)} />
      </section>
    );
  }

  const activeMeds = st.settings.medicines.filter((m) => m.status === 'active');
  const msgAt = (where: 'details' | 'behaviour') => msg && msgWhere === where && <span data-testid="settings-msg">{msg}</span>;
  return (
    <section class="page" data-testid="settings">
      <h2>הגדרות</h2>

      {section('family', '👤', 'אני והמשפחה', [
        <h3 key="h1">מי אני (במכשיר הזה)</h3>,
        <div class="chips" role="radiogroup" key="me">
          {st.settings.parents.map((p) => (
            <button type="button" key={p} class={`chip ${p === me ? 'on' : ''}`} data-testid="me-option" onClick={() => engine.setMe(p)}>
              {p}
            </button>
          ))}
        </div>,
        <h3 key="h2">פרטים (נשמרים בגיליון)</h3>,
        <label class="fl" key="l1">
          שם התינוק
        </label>,
        <input key="i1" data-testid="baby-name" value={baby} maxLength={40} onInput={edit(setBaby)} />,
        // (owner) the wording follows it ("ישן" / "ישנה", "התעורר" / "התעוררה"); saved at once, for both phones
        <div class="chips" role="radiogroup" aria-label="בן או בת" key="sex">
          {SEX.map(([id, label]) => (
            <button
              type="button"
              key={id}
              role="radio"
              aria-checked={(st.settings.babySex ?? 'boy') === id}
              class={`chip ${(st.settings.babySex ?? 'boy') === id ? 'on' : ''}`}
              data-testid={`sex-${id}`}
              onClick={() => engine.dispatch({ action: 'settings', set: { babySex: id } })}
            >
              {label}
            </button>
          ))}
        </div>,
        <label class="fl" key="l2">
          הורה 1
        </label>,
        <input key="i2" data-testid="parent-1" value={p1} maxLength={20} onInput={edit(setP1)} />,
        <label class="fl" key="l3">
          הורה 2
        </label>,
        <input key="i3" data-testid="parent-2" value={p2} maxLength={20} onInput={edit(setP2)} />,
        <div class="actions" key="a">
          <button type="button" class="primary" data-testid="save-settings" onClick={() => save('details')}>
            שמירה
          </button>
          {msgAt('details')}
        </div>,
      ])}

      {section('medicines', '💊', 'תרופות', [
        <p class="muted" data-testid="meds-summary" key="s">
          {activeMeds.length ? activeMeds.map((m) => `${m.icon} ${m.name}`).join(' · ') : 'אין תרופות פעילות'}
        </p>,
        <div class="actions" key="a">
          <button type="button" data-testid="open-medicines" onClick={() => setMedsOpen(true)}>
            ניהול תרופות
          </button>
        </div>,
      ])}

      {section('behaviour', '🌙', 'תצוגה והתנהגות', [
        <h3 key="h1">מצב לילה</h3>,
        <div class="chips" role="radiogroup" key="n">
          {NIGHT.map(([id, label]) => (
            <button type="button" key={id} class={`chip ${prefs.nightMode === id ? 'on' : ''}`} data-testid={`night-${id}`} onClick={() => setNightMode(id)}>
              {label}
            </button>
          ))}
        </div>,
        <p class="muted" key="nm">
          אוטומטי: בין 21:00 ל-07:00, או כשהמכשיר במצב כהה.
        </p>,
        <h3 key="h2">צבע מצב לילה</h3>,
        <div class="chips" role="radiogroup" key="t">
          {TINT.map(([id, label]) => (
            <button type="button" key={id} class={`chip ${prefs.nightTint === id ? 'on' : ''}`} data-testid={`tint-${id}`} onClick={() => setNightTint(id)}>
              {label}
            </button>
          ))}
        </div>,
        <p class="muted" key="tm">
          אדום עמום: פחות אור בחדר חשוך. נשמר רק במכשיר הזה.
        </p>,
        <h3 key="h3">חלון איחוד הנקות (דקות)</h3>,
        <input key="w" data-testid="merge-window" type="number" inputMode="numeric" min={0} max={180} value={win} onInput={edit(setWin)} />,
        <p class="muted" key="wm">
          הנקות בהפרש של עד כמה דקות נספרות כהאכלה אחת (נשמר בגיליון, לשני ההורים).
        </p>,
        <div class="actions" key="a">
          <button type="button" class="primary" data-testid="save-merge" onClick={() => save('behaviour')}>
            שמירה
          </button>
          {msgAt('behaviour')}
        </div>,
      ])}

      {section('advanced', '🛠️', 'מתקדם', [
        <h3 key="h1">סנכרון</h3>,
        <p class="muted" data-testid="sync-info" key="si">
          {st.pending ? `${st.pending} ממתינים לסנכרון` : 'הכל מסונכרן'}
          {st.lastSync ? ` · עודכן ${new Date(st.lastSync).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })}` : ''}
        </p>,
        st.timing && (
          <p class="muted" data-testid="sync-timing" key="st">
            סנכרון אחרון: {secs(st.timing.totalMs)} ש׳{st.timing.serverMs !== null ? ` (מתוכן שרת ${secs(st.timing.serverMs)})` : ''}
            {st.timing.list ? ' · עם נתונים חדשים' : ' · בלי שינוי'}
          </p>
        ),
        <div class="actions" key="a1">
          <button type="button" data-testid="sync-now" onClick={() => void engine.refresh()}>
            סנכרן עכשיו
          </button>
          {st.sheetUrl && (
            <a class="btnlike" href={st.sheetUrl} target="_blank" rel="noopener noreferrer" data-testid="sheet-link">
              פתיחת הגיליון (במחשב)
            </a>
          )}
          {/* (owner) hidden behind a button: the times of the last syncs */}
          <button type="button" data-testid="open-sync-log" onClick={() => setLogOpen(true)}>
            יומן סנכרון
          </button>
          {/* (owner) a quick place to note a bug or an idea, next to the sync log */}
          <button type="button" data-testid="open-feedback" onClick={() => setFbOpen(true)}>
            <span class="emo">🐞</span> משוב
          </button>
        </div>,
        <h3 key="h2">חיבור</h3>,
        <div class="actions" key="a2">
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
          <button type="button" data-testid="open-privacy" onClick={() => setPrivacyOpen(true)}>
            פרטיות ותנאים
          </button>
        </div>,
        <p class="muted" key="v">
          גרסה {__APP_COMMIT__}
        </p>,
      ])}
    </section>
  );
}

/** Milliseconds as seconds with one decimal ("1.4"). */
const secs = (ms: number): string => (ms / 1000).toFixed(1);

/** A settings section: a card with its own icon and title (a plain function, not a component defined inside one). */
function section(id: string, icon: string, title: string, children: (JSX.Element | null | false)[]): JSX.Element {
  return (
    <div class="sect" data-testid={`sect-${id}`}>
      <div class="sect-h">
        <span class="emo">{icon}</span>
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}
