import { useState } from 'preact/hooks';
import { openSleep } from '../../shared/domain';
import { localDate, parseLocal } from '../../shared/tz';
import type { BabyEvent } from '../../shared/types';
import { deleteEvent } from '../actions';
import { VITAMIN_D_ID } from '../../shared/medicines';
import { KINDS, KIND_ICON, KIND_LABEL, type Kind, dayName, errorText, fromKind, kindOf, nowLocal, timeOf } from '../labels';
import { engine, showToast, useEngine } from '../state';
import { DateField } from './DateField';

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
// (owner) no "today" / "yesterday" buttons: another day is chosen in the date field; these are the quick ones
const BACK: [string, number][] = [
  ['לפני 5 דק׳', 5],
  ['לפני 10 דק׳', 10],
  ['לפני 15 דק׳', 15],
  ['לפני 30 דק׳', 30],
  ['לפני שעה', 60],
  ['לפני שעתיים', 120],
];

/** A sleep has two moments; the form edits one at a time. */
export type Moment = 'start' | 'end';

interface Props {
  mode: 'add' | 'edit';
  event?: BabyEvent;
  /** which moment of a sleep to show first (the row that was tapped: "נרדם" or "התעורר") */
  focus?: Moment;
  onClose: () => void;
}

export function EventForm({ mode, event, focus, onClose }: Props) {
  const { events, settings } = useEngine();
  const nowStr = nowLocal();
  const initStart = event?.start || nowStr;
  // what is being recorded: one of the kinds, or a medicine ("med:<id>"; vitamin D is "med:vitamin_d")
  const [sel, setSel] = useState<string>(() => (event?.type === 'vitamin_d' ? `med:${VITAMIN_D_ID}` : event?.type === 'medicine' ? `med:${event.detail}` : event ? kindOf(event) : 'feed_left'));
  const medId = sel.startsWith('med:') ? sel.slice(4) : null;
  const kind: Kind = medId === null ? (sel as Kind) : medId === VITAMIN_D_ID ? 'vitamin_d' : 'medicine';
  // active medicines, plus the one this entry belongs to even if it was archived since
  const medChoices = settings.medicines.filter((m) => m.status === 'active' || m.id === medId);
  const [sDate, setSDate] = useState(initStart.slice(0, 10));
  const [sTime, setSTime] = useState(timeOf(initStart));
  // The "X minutes ago" button that set the time, and the time it set: it stays lit exactly as long as the time is still that one
  // (a late event from the phone's time wheel with the same value cannot switch it off; a change by hand does).
  const [quick, setQuick] = useState<{ moment: Moment; mins: number; at: string } | null>(null);
  const [moment, setMoment] = useState<Moment>(focus ?? (event?.type === 'sleep' && !event.start ? 'end' : 'start'));
  const [unknownStart, setUnknownStart] = useState(Boolean(event && event.type === 'sleep' && !event.start));
  const initEnd = event?.end || nowStr;
  // A new sleep added after the fact is usually a baby who fell asleep a little while ago and is still asleep, so that is the
  // default (otherwise it was saved as over and the home button stayed on "נרדם"). If a sleep is already open, the added one
  // must be a finished one, so then the end time is asked for.
  const [stillAsleep, setStillAsleep] = useState(event ? event.type === 'sleep' && !event.end && Boolean(event.start) : !openSleep(events));
  const [eDate, setEDate] = useState(initEnd.slice(0, 10));
  const [eTime, setETime] = useState(timeOf(initEnd));
  const [note, setNote] = useState(event?.note ?? '');
  const [error, setError] = useState('');

  const today = localDate(Date.now());
  const isSleep = kind === 'sleep';

  const setBack = (m: Moment, mins: number) => {
    const t = nowLocal(Date.now() - mins * 60_000);
    if (m === 'start') {
      setSDate(t.slice(0, 10));
      setSTime(timeOf(t));
      setUnknownStart(false);
    } else {
      setEDate(t.slice(0, 10));
      setETime(timeOf(t));
      setStillAsleep(false);
    }
    setQuick({ moment: m, mins, at: t });
  };
  const valueOf = (m: Moment) => (m === 'start' ? `${sDate} ${sTime}` : `${eDate} ${eTime}`);
  const lit = (m: Moment, mins: number) => quick !== null && quick.moment === m && quick.mins === mins && quick.at === valueOf(m);

  // One moment's date, time and quick buttons (a plain function returning JSX, not a component).
  const timeEditor = (m: Moment, label: string) => {
    const [date, time, setDate, setTime] = m === 'start' ? [sDate, sTime, setSDate, setSTime] : [eDate, eTime, setEDate, setETime];
    return (
      <>
        <label class="fl">{label}</label>
        <div class="when">
          <DateField testId={`${m}-date`} value={date} max={today} onChange={setDate} />
          <input type="time" data-testid={`${m}-time`} value={time} onInput={(e) => setTime((e.target as HTMLInputElement).value)} />
        </div>
        <div class="chips small">
          {BACK.map(([text, mins]) => (
            <button type="button" key={mins} class={`chip ${lit(m, mins) ? 'on' : ''}`} aria-pressed={lit(m, mins)} data-testid={m === 'start' ? `back-${mins}` : `end-back-${mins}`} onClick={() => setBack(m, mins)}>
              {text}
            </button>
          ))}
        </div>
      </>
    );
  };
  const when = (date: string, time: string) => (date === today ? time : `${time} · ${dayName(date, today)}`);

  const save = () => {
    const start = isSleep && unknownStart ? '' : `${sDate} ${sTime}`;
    const end = isSleep && !stillAsleep ? `${eDate} ${eTime}` : '';
    if (Number.isNaN(parseLocal(start || end))) return setError('תאריך או שעה לא תקינים');
    if (start && end && parseLocal(end) < parseLocal(start)) {
      setMoment('end');
      return setError(errorText('invalid_event', 'end is before start')); // the wording stays as it was until the owner picks one
    }
    const { type, detail: kindDetail } = fromKind(kind);
    const detail = kind === 'medicine' ? medId! : kindDetail;
    const label = medId !== null ? (settings.medicines.find((m) => m.id === medId)?.name ?? KIND_LABEL[kind]) : KIND_LABEL[kind];
    const me = engine.getConfig()?.me ?? '?';
    const res =
      mode === 'add'
        ? engine.dispatch({ action: 'log', id: uid(), type, detail, start, ...(end ? { end } : {}), user: me, source: 'app', note })
        : engine.dispatch({ action: 'update', id: event!.id, patch: { type, detail, start, end, note } });
    if (!res.ok) return setError(errorText(res.error, res.detail));
    showToast({ text: mode === 'add' ? `נוסף: ${label} ${timeOf(start || end)}` : 'השינויים נשמרו' }, 3000);
    onClose();
  };

  return (
    <div class="sheet-backdrop" data-testid="event-form" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={mode === 'add' ? 'הוספה בדיעבד' : 'עריכת אירוע'}>
        <h2>{mode === 'add' ? 'הוספה בדיעבד' : 'עריכת אירוע'}</h2>

        <div class="chips" role="radiogroup" aria-label="סוג">
          {KINDS.filter((k) => k !== 'vitamin_d').map((k) => (
            <button type="button" key={k} class={`chip ${k === sel ? 'on' : ''}`} data-testid={`kind-${k}`} onClick={() => setSel(k)}>
              <span class="emo">{KIND_ICON[k]}</span> {KIND_LABEL[k]}
            </button>
          ))}
          {/* every medicine is its own choice (no warnings here: this is something that already happened) */}
          {medChoices.map((m) => (
            <button type="button" key={m.id} class={`chip ${sel === `med:${m.id}` ? 'on' : ''}`} data-testid={m.id === VITAMIN_D_ID ? 'kind-vitamin_d' : `kind-med-${m.id}`} onClick={() => setSel(`med:${m.id}`)}>
              <span class="emo">{m.icon}</span> <bdi>{m.name}</bdi>
            </button>
          ))}
        </div>

        {!isSleep && timeEditor('start', 'מתי')}

        {isSleep && (
          <>
            {/* the two moments of a sleep, each edited on its own; the one that was tapped opens first */}
            <div class="seg moments" role="tablist" aria-label="שינה">
              <button type="button" role="tab" class={moment === 'start' ? 'on' : ''} aria-selected={moment === 'start'} data-testid="moment-start" onClick={() => setMoment('start')}>
                <span>נרדם</span>
                <b data-testid="moment-start-value">{unknownStart ? 'לא ידוע' : when(sDate, sTime)}</b>
              </button>
              <button type="button" role="tab" class={moment === 'end' ? 'on' : ''} aria-selected={moment === 'end'} data-testid="moment-end" onClick={() => setMoment('end')}>
                <span>התעורר</span>
                <b data-testid="moment-end-value">{stillAsleep ? 'עדיין ישן' : when(eDate, eTime)}</b>
              </button>
            </div>
            {moment === 'start' && (
              <>
                {event && !event.start && (
                  <label class="check">
                    <input type="checkbox" checked={unknownStart} onChange={(e) => setUnknownStart((e.target as HTMLInputElement).checked)} /> שעת ההירדמות לא ידועה
                  </label>
                )}
                {!unknownStart && timeEditor('start', 'נרדם ב')}
              </>
            )}
            {moment === 'end' && (
              <>
                <label class="check">
                  <input type="checkbox" data-testid="still-asleep" checked={stillAsleep} onChange={(e) => setStillAsleep((e.target as HTMLInputElement).checked)} /> עדיין ישן
                </label>
                {!stillAsleep && timeEditor('end', 'התעורר ב')}
              </>
            )}
          </>
        )}

        <label class="fl">הערה</label>
        <textarea data-testid="note" rows={2} maxLength={200} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />

        {error && (
          <p class="err" role="alert" data-testid="form-error">
            {error}
          </p>
        )}

        <div class="actions">
          <button type="button" class="primary" data-testid="save" onClick={save}>
            שמירה
          </button>
          <button type="button" onClick={onClose}>
            ביטול
          </button>
          {mode === 'edit' && event && (
            <button
              type="button"
              class="danger"
              data-testid="delete"
              onClick={() => {
                deleteEvent(event);
                onClose();
              }}
            >
              מחיקה
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
