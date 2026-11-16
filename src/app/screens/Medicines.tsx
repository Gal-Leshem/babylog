import { useState } from 'preact/hooks';
import {
  CHEERFUL_ICONS,
  type CourseKind,
  DOSE_UNITS,
  type Medicine,
  type Schedule,
  STANDARD_ICONS,
  VITAMIN_D_ID,
  courseProgress,
  courseText,
  doseText,
  dosesOf,
  normalizeMedicine,
  pickIcon,
  scheduleText,
} from '../../shared/medicines';
import { addDays, localDate } from '../../shared/tz';
import { engine, useEngine, useNow } from '../state';
import { DateField } from './DateField';

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
  ['until', 'עד תאריך'],
];

/** Server/validator messages -> Hebrew. */
const ERRORS: [RegExp, string][] = [
  [/name/, 'צריך שם (עד 30 תווים)'],
  [/dose is too long/, 'המינון ארוך מדי (עד 40 תווים)'],
  [/times per day/, 'מספר הפעמים ביום צריך להיות בין 2 ל-12'],
  [/every X hours/, 'כל כמה שעות: מספר בין רבע שעה ל-72 (ברבעי שעה, למשל 8 או 1.5)'],
  [/minimum gap/, 'מרווח מינימלי: ריק, או עד 72 שעות (ברבעי שעה)'],
  [/maximum per day/, 'מקסימום ביום: ריק, או בין 1 ל-24'],
  [/course length/, 'משך מתן התרופה: בין 1 ל-365'],
  [/end date/, 'צריך לבחור תאריך סיום'],
  [/has doses/, 'כבר נרשמו מנות של התרופה: אפשר רק להעביר לארכיון'],
  [/cannot be removed/, 'את ויטמין D אפשר רק להעביר לארכיון'],
];
const errorHe = (e: string) => ERRORS.find(([re]) => re.test(e))?.[1] ?? 'לא נשמר, בדקו את השדות';

interface Draft {
  id: string;
  name: string;
  icon: string;
  dose: string;
  doseUnit: string;
  schedule: Schedule;
  timesPerDay: string;
  everyHours: string;
  minGapHours: string;
  maxPerDay: string;
  course: CourseKind;
  courseCount: string;
  courseUntil: string;
  status: Medicine['status'];
}

const numText = (n: number) => (n ? String(n) : '');
function toDraft(m: Medicine | undefined, all: readonly Medicine[], today: string): Draft {
  return {
    id: m?.id ?? uid(),
    name: m?.name ?? '',
    icon: m?.icon ?? pickIcon(all),
    dose: m?.dose ?? '',
    doseUnit: m?.doseUnit ?? '',
    schedule: m?.schedule ?? 'daily',
    timesPerDay: numText(m?.timesPerDay ?? 2),
    everyHours: numText(m?.everyHours ?? 0),
    minGapHours: numText(m?.minGapHours ?? 0),
    maxPerDay: numText(m?.maxPerDay ?? 0),
    course: m?.course ?? 'none',
    courseCount: numText(m?.courseCount ?? 0),
    courseUntil: m?.courseUntil || addDays(today, 7),
    status: m?.status ?? 'active',
  };
}
/** "1,5" and "1.5" both work; an empty field means none. */
const num = (s: string) => (s.trim() === '' ? 0 : Number(s.trim().replace(',', '.')));
const strip = (m: Medicine) => {
  const { created: _c, ...rest } = m;
  return rest;
};

function save(change: Parameters<typeof engine.dispatch>[0]): string | null {
  const res = engine.dispatch(change);
  return res.ok ? null : errorHe(res.detail ?? res.error);
}

function iconChips(group: readonly string[], value: string, set: (v: string) => void, testPrefix: string) {
  return (
    <div class="chips icons" role="radiogroup">
      {group.map((ic, i) => (
        <button type="button" key={ic} class={`chip ${value === ic ? 'on' : ''}`} data-testid={`${testPrefix}-${i}`} aria-pressed={value === ic} onClick={() => set(ic)}>
          <span class="emo">{ic}</span>
        </button>
      ))}
    </div>
  );
}

/** Add or edit one medicine. */
function MedicineForm({ initial, onDone, onBack }: { initial?: Medicine; onDone: () => void; onBack: () => void }) {
  const { settings } = useEngine();
  const today = localDate(useNow(60_000));
  const [d, setD] = useState<Draft>(() => toDraft(initial, settings.medicines, today));
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
      <div class="medhead">
        <h2>{initial ? 'עריכת תרופה' : 'תרופה חדשה'}</h2>
        <button type="button" class="link" data-testid="med-back-settings" onClick={onBack}>
          חזרה להגדרות
        </button>
      </div>
      <label class="fl">שם</label>
      <input data-testid="med-name" value={d.name} maxLength={30} onInput={field('name')} />

      <label class="fl">אייקון</label>
      {iconChips(CHEERFUL_ICONS, d.icon, (v) => set('icon', v), 'med-icon-cheerful')}
      {iconChips(STANDARD_ICONS, d.icon, (v) => set('icon', v), 'med-icon-standard')}

      <label class="fl">מינון (לא חובה)</label>
      <div class="dose">
        <input data-testid="med-dose" type="text" inputMode="decimal" value={d.dose} maxLength={40} placeholder="כמות" onInput={field('dose')} />
        <select data-testid="med-unit" value={d.doseUnit} onChange={field('doseUnit')} aria-label="יחידה">
          <option value="">יחידה</option>
          {DOSE_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>

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

      <label class="fl">משך מתן התרופה</label>
      <div class="chips" role="radiogroup">
        {COURSE_LABEL.map(([id, label]) => (
          <button type="button" key={id} class={`chip ${d.course === id ? 'on' : ''}`} data-testid={`med-course-${id}`} onClick={() => set('course', id)}>
            {label}
          </button>
        ))}
      </div>
      {(d.course === 'doses' || d.course === 'days') && (
        <>
          <label class="fl">{d.course === 'doses' ? 'כמה מנות' : 'כמה ימים'} (נספר מהמנה הראשונה)</label>
          <input data-testid="med-count" type="number" inputMode="numeric" min={1} max={365} value={d.courseCount} onInput={field('courseCount')} />
        </>
      )}
      {d.course === 'until' && (
        <>
          <label class="fl">היום האחרון (כולל)</label>
          <DateField testId="med-until" value={d.courseUntil} min={today} onChange={(v) => set('courseUntil', v)} />
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

/** Dose and schedule; the course too unless a progress line below already tells it. */
function medLine(m: Medicine, withCourse: boolean): string {
  return [doseText(m), scheduleText(m), withCourse ? courseText(m) : ''].filter(Boolean).join(' · ');
}

/** Settings > תרופות: every medicine, vitamin D first (it can be archived, not deleted). */
export function Medicines({ onBack }: { onBack: () => void }) {
  const { settings, allEvents } = useEngine();
  const now = useNow(60_000);
  const [editing, setEditing] = useState<Medicine | 'new' | null>(null);
  const [error, setError] = useState('');
  const active = settings.medicines.filter((m) => m.status === 'active');
  const archived = settings.medicines.filter((m) => m.status === 'archived');
  const change = (m: Medicine, status: Medicine['status']) => setError(save({ action: 'settings', set: { medicines: [{ ...strip(m), status }] } }) ?? '');

  if (editing) return <MedicineForm initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} onBack={onBack} />;

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
        {active.map((m) => {
          const course = courseProgress(m, allEvents, now);
          return (
            <li class="med" key={m.id} data-testid="med-row" data-id={m.id}>
              <div class="mt">
                <span class="emo">{m.icon}</span> <bdi>{m.name}</bdi>
              </div>
              <div class="ms">{medLine(m, !course)}</div>
              {course && (
                <div class={`ms ${course.done ? 'done' : ''}`} data-testid="med-course">
                  {course.done ? `${course.text} · משך מתן התרופה הסתיים: להעביר לארכיון או להאריך?` : course.text}
                </div>
              )}
              <div class="actions">
                <button type="button" data-testid="med-edit" onClick={() => setEditing(m)}>
                  {course?.done ? 'הארכה' : 'עריכה'}
                </button>
                <button type="button" data-testid="med-archive" onClick={() => change(m, 'archived')}>
                  העברה לארכיון
                </button>
              </div>
            </li>
          );
        })}
        {active.length === 0 && <li class="empty">אין תרופות פעילות</li>}
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
              <li class="med archived" key={m.id} data-testid="med-archived-row" data-id={m.id}>
                <div class="mt">
                  <span class="emo">{m.icon}</span> <bdi>{m.name}</bdi>
                </div>
                <div class="ms">{medLine(m, true)}</div>
                <div class="actions">
                  <button type="button" data-testid="med-restore" onClick={() => change(m, 'active')}>
                    החזרה לשימוש
                  </button>
                  {m.id !== VITAMIN_D_ID && dosesOf(m, allEvents).length === 0 && (
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
