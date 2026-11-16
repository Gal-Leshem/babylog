import { useState } from 'preact/hooks';
import { type CourseKind, type Medicine, type Schedule, courseText, normalizeMedicine, scheduleText } from '../../shared/medicines';
import { live } from '../../shared/domain';
import { engine, useEngine } from '../state';

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const SCHEDULE_LABEL: [Schedule, string][] = [
  ['daily', 'פעם ביום'],
  ['times', 'כמה פעמים ביום'],
  ['interval', 'כל כמה שעות'],
  ['prn', 'לפי הצורך'],
];
const COURSE_LABEL: [CourseKind, string][] = [
  ['none', 'ללא הגבלה'],
  ['doses', 'מספר מנות'],
  ['days', 'מספר ימים'],
];

/** Server/validator messages -> Hebrew. */
const ERRORS: [RegExp, string][] = [
  [/name/, 'צריך שם (עד 30 תווים)'],
  [/dose is too long/, 'המינון ארוך מדי (עד 40 תווים)'],
  [/times per day/, 'מספר הפעמים ביום צריך להיות בין 2 ל-12'],
  [/every X hours/, 'כל כמה שעות: מספר בין רבע שעה ל-72 (ברבעי שעה, למשל 8 או 1.5)'],
  [/minimum gap/, 'מרווח מינימלי: ריק, או עד 72 שעות (ברבעי שעה)'],
  [/maximum per day/, 'מקסימום ביום: ריק, או בין 1 ל-24'],
  [/course length/, 'אורך הקורס: בין 1 ל-365'],
  [/has doses/, 'כבר נרשמו מנות של התרופה: אפשר רק להעביר לארכיון'],
];
const errorHe = (e: string) => ERRORS.find(([re]) => re.test(e))?.[1] ?? 'לא נשמר, בדקו את השדות';

interface Draft {
  id: string;
  name: string;
  dose: string;
  schedule: Schedule;
  timesPerDay: string;
  everyHours: string;
  minGapHours: string;
  maxPerDay: string;
  course: CourseKind;
  courseCount: string;
  status: Medicine['status'];
}

const numText = (n: number) => (n ? String(n) : '');
const toDraft = (m?: Medicine): Draft => ({
  id: m?.id ?? uid(),
  name: m?.name ?? '',
  dose: m?.dose ?? '',
  schedule: m?.schedule ?? 'daily',
  timesPerDay: numText(m?.timesPerDay ?? 2),
  everyHours: numText(m?.everyHours ?? 0),
  minGapHours: numText(m?.minGapHours ?? 0),
  maxPerDay: numText(m?.maxPerDay ?? 0),
  course: m?.course ?? 'none',
  courseCount: numText(m?.courseCount ?? 0),
  status: m?.status ?? 'active',
});
/** "1,5" and "1.5" both work; an empty field means none. */
const num = (s: string) => (s.trim() === '' ? 0 : Number(s.trim().replace(',', '.')));

function save(change: Parameters<typeof engine.dispatch>[0]): string | null {
  const res = engine.dispatch(change);
  return res.ok ? null : errorHe(res.detail ?? res.error);
}

/** Add or edit one medicine. */
function MedicineForm({ initial, onDone }: { initial?: Medicine; onDone: () => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const [error, setError] = useState('');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD({ ...d, [k]: v });
    setError('');
  };
  const field = (k: keyof Draft) => (e: Event) => set(k, (e.target as HTMLInputElement).value as never);

  const submit = () => {
    const checked = normalizeMedicine({
      ...d,
      timesPerDay: num(d.timesPerDay),
      everyHours: num(d.everyHours),
      minGapHours: num(d.minGapHours),
      maxPerDay: num(d.maxPerDay),
      courseCount: num(d.courseCount),
    });
    if (!checked.ok) return setError(errorHe(checked.error));
    const err = save({ action: 'settings', set: { medicines: [checked.medicine] } });
    if (err) return setError(err);
    onDone();
  };

  return (
    <div class="medform" data-testid="med-form">
      <h3>{initial ? 'עריכת תרופה' : 'תרופה חדשה'}</h3>
      <label class="fl">שם</label>
      <input data-testid="med-name" value={d.name} maxLength={30} onInput={field('name')} />
      <label class="fl">מינון (לא חובה)</label>
      <input data-testid="med-dose" value={d.dose} maxLength={40} placeholder="למשל 0.5 מ״ל" onInput={field('dose')} />

      <label class="fl">מתי נותנים</label>
      <div class="chips" role="radiogroup">
        {SCHEDULE_LABEL.map(([id, label]) => (
          <button type="button" key={id} class={`chip ${d.schedule === id ? 'on' : ''}`} data-testid={`med-schedule-${id}`} onClick={() => set('schedule', id)}>
            {label}
          </button>
        ))}
      </div>
      {d.schedule === 'times' && (
        <>
          <label class="fl">כמה פעמים ביום</label>
          <input data-testid="med-times" type="number" inputMode="numeric" min={2} max={12} value={d.timesPerDay} onInput={field('timesPerDay')} />
        </>
      )}
      {d.schedule === 'interval' && (
        <>
          <label class="fl">כל כמה שעות</label>
          <input data-testid="med-every" type="text" inputMode="decimal" value={d.everyHours} onInput={field('everyHours')} />
        </>
      )}
      {(d.schedule === 'times' || d.schedule === 'prn') && (
        <>
          <label class="fl">מרווח מינימלי בין מנות, בשעות (לא חובה)</label>
          <input data-testid="med-gap" type="text" inputMode="decimal" value={d.minGapHours} onInput={field('minGapHours')} />
        </>
      )}
      {d.schedule === 'prn' && (
        <>
          <label class="fl">מקסימום מנות ביום (לא חובה)</label>
          <input data-testid="med-max" type="number" inputMode="numeric" min={0} max={24} value={d.maxPerDay} onInput={field('maxPerDay')} />
        </>
      )}

      <label class="fl">משך</label>
      <div class="chips" role="radiogroup">
        {COURSE_LABEL.map(([id, label]) => (
          <button type="button" key={id} class={`chip ${d.course === id ? 'on' : ''}`} data-testid={`med-course-${id}`} onClick={() => set('course', id)}>
            {label}
          </button>
        ))}
      </div>
      {d.course !== 'none' && (
        <>
          <label class="fl">{d.course === 'doses' ? 'כמה מנות' : 'כמה ימים'} (נספר מהמנה הראשונה)</label>
          <input data-testid="med-count" type="number" inputMode="numeric" min={1} max={365} value={d.courseCount} onInput={field('courseCount')} />
        </>
      )}

      {error && (
        <p class="err" role="alert" data-testid="med-error">
          {error}
        </p>
      )}
      <div class="actions">
        <button type="button" class="primary" data-testid="med-save" onClick={submit}>
          שמירה
        </button>
        <button type="button" data-testid="med-cancel" onClick={onDone}>
          ביטול
        </button>
      </div>
    </div>
  );
}

function medLine(m: Medicine): string {
  return [m.dose, scheduleText(m), courseText(m)].filter(Boolean).join(' · ');
}

/** Settings > תרופות: the medicines besides vitamin D (which is built in and always there). */
export function Medicines({ onBack }: { onBack: () => void }) {
  const { settings, allEvents } = useEngine();
  const [editing, setEditing] = useState<Medicine | 'new' | null>(null);
  const [error, setError] = useState('');
  const active = settings.medicines.filter((m) => m.status === 'active');
  const archived = settings.medicines.filter((m) => m.status === 'archived');
  const hasDoses = (id: string) => live(allEvents).some((e) => e.type === 'medicine' && e.detail === id);
  const change = (m: Medicine, status: Medicine['status']) => {
    const { created: _created, ...rest } = m;
    setError(save({ action: 'settings', set: { medicines: [{ ...rest, status }] } }) ?? '');
  };

  if (editing) return <MedicineForm initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />;

  return (
    <div data-testid="medicines">
      <div class="medhead">
        <h2>תרופות</h2>
        <button type="button" class="link" data-testid="med-back" onClick={onBack}>
          חזרה להגדרות
        </button>
      </div>
      <p class="muted" data-testid="med-disclaimer">
        המינונים והמרווחים לפי הנחיית הרופא או העלון.
      </p>

      <ul class="medlist">
        <li class="med" data-testid="med-vitamin-d">
          <div class="mt">
            <span class="emo">☀️</span> ויטמין D
          </div>
          <div class="ms">פעם ביום · תמיד פעיל</div>
        </li>
        {active.map((m) => (
          <li class="med" key={m.id} data-testid="med-row">
            <div class="mt">{m.name}</div>
            <div class="ms">{medLine(m)}</div>
            <div class="actions">
              <button type="button" data-testid="med-edit" onClick={() => setEditing(m)}>
                עריכה
              </button>
              <button type="button" data-testid="med-archive" onClick={() => change(m, 'archived')}>
                העברה לארכיון
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div class="actions">
        <button type="button" class="primary" data-testid="med-add" onClick={() => setEditing('new')}>
          + הוספת תרופה
        </button>
      </div>
      {error && (
        <p class="err" role="alert">
          {error}
        </p>
      )}

      {archived.length > 0 && (
        <>
          <h3>בארכיון</h3>
          <ul class="medlist">
            {archived.map((m) => (
              <li class="med archived" key={m.id} data-testid="med-archived-row">
                <div class="mt">{m.name}</div>
                <div class="ms">{medLine(m)}</div>
                <div class="actions">
                  <button type="button" data-testid="med-restore" onClick={() => change(m, 'active')}>
                    החזרה לשימוש
                  </button>
                  {!hasDoses(m.id) && (
                    <button type="button" class="danger" data-testid="med-delete" onClick={() => setError(save({ action: 'settings', set: { medicines: [{ id: m.id, remove: true }] } }) ?? '')}>
                      מחיקה
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
