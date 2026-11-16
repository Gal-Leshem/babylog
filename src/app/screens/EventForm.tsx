import { useState } from 'preact/hooks';
import { openSleep } from '../../shared/domain';
import { addDays, localDate, parseLocal } from '../../shared/tz';
import type { BabyEvent } from '../../shared/types';
import { deleteEvent } from '../actions';
import { KINDS, KIND_ICON, KIND_LABEL, type Kind, errorText, fromKind, kindOf, nowLocal, timeOf } from '../labels';
import { engine, showToast, useEngine } from '../state';
import { DateField } from './DateField';

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const BACK: [string, number][] = [
  ['לפני 10 דק׳', 10],
  ['לפני 15 דק׳', 15],
  ['לפני 30 דק׳', 30],
  ['לפני שעה', 60],
  ['לפני שעתיים', 120],
];

interface Props {
  mode: 'add' | 'edit';
  event?: BabyEvent;
  onClose: () => void;
}

export function EventForm({ mode, event, onClose }: Props) {
  const { events } = useEngine();
  const nowStr = nowLocal();
  const initStart = event?.start || nowStr;
  const [kind, setKind] = useState<Kind>(event ? kindOf(event) : 'feed_left');
  const [sDate, setSDate] = useState(initStart.slice(0, 10));
  const [sTime, setSTime] = useState(timeOf(initStart));
  // which "X minutes ago" button is active (cleared as soon as the time or date is changed by hand)
  const [quick, setQuick] = useState<number | null>(null);
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

  const setBack = (mins: number) => {
    const t = nowLocal(Date.now() - mins * 60_000);
    setSDate(t.slice(0, 10));
    setSTime(timeOf(t));
    setUnknownStart(false);
    setQuick(mins);
  };

  const save = () => {
    const start = isSleep && unknownStart ? '' : `${sDate} ${sTime}`;
    const end = isSleep && !stillAsleep ? `${eDate} ${eTime}` : '';
    if (Number.isNaN(parseLocal(start || end))) return setError('תאריך או שעה לא תקינים');
    const { type, detail } = fromKind(kind);
    const me = engine.getConfig()?.me ?? '?';
    const res =
      mode === 'add'
        ? engine.dispatch({ action: 'log', id: uid(), type, detail, start, ...(end ? { end } : {}), user: me, source: 'app', note })
        : engine.dispatch({ action: 'update', id: event!.id, patch: { type, detail, start, end, note } });
    if (!res.ok) return setError(errorText(res.error, res.detail));
    showToast({ text: mode === 'add' ? `נוסף: ${KIND_LABEL[kind]} ${timeOf(start || end)}` : 'השינויים נשמרו' }, 3000);
    onClose();
  };

  return (
    <div class="sheet-backdrop" data-testid="event-form" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={mode === 'add' ? 'הוספה בדיעבד' : 'עריכת אירוע'}>
        <h2>{mode === 'add' ? 'הוספה בדיעבד' : 'עריכת אירוע'}</h2>

        <div class="chips" role="radiogroup" aria-label="סוג">
          {KINDS.map((k) => (
            <button type="button" key={k} class={`chip ${k === kind ? 'on' : ''}`} data-testid={`kind-${k}`} onClick={() => setKind(k)}>
              <span class="emo">{KIND_ICON[k]}</span> {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {isSleep && unknownStart ? null : (
          <>
            <label class="fl">{isSleep ? 'נרדם ב' : 'מתי'}</label>
            <div class="when">
              <DateField
                testId="start-date"
                value={sDate}
                max={today}
                onChange={(d) => {
                  setSDate(d);
                  setQuick(null);
                }}
              />
              <input
                type="time"
                data-testid="start-time"
                value={sTime}
                onInput={(e) => {
                  setSTime((e.target as HTMLInputElement).value);
                  setQuick(null);
                }}
              />
            </div>
            <div class="chips small">
              <button
                type="button"
                class={`chip ${quick === null && sDate === today ? 'on' : ''}`}
                data-testid="chip-today"
                onClick={() => {
                  setSDate(today);
                  setQuick(null);
                }}
              >
                היום
              </button>
              <button
                type="button"
                class={`chip ${quick === null && sDate === addDays(today, -1) ? 'on' : ''}`}
                data-testid="chip-yesterday"
                onClick={() => {
                  setSDate(addDays(today, -1));
                  setQuick(null);
                }}
              >
                אתמול
              </button>
              {BACK.map(([label, m]) => (
                <button type="button" key={m} class={`chip ${quick === m ? 'on' : ''}`} aria-pressed={quick === m} data-testid={`back-${m}`} onClick={() => setBack(m)}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {isSleep && (
          <>
            {event && !event.start && (
              <label class="check">
                <input type="checkbox" checked={unknownStart} onChange={(e) => setUnknownStart((e.target as HTMLInputElement).checked)} /> שעת ההירדמות לא ידועה
              </label>
            )}
            <label class="check">
              <input type="checkbox" data-testid="still-asleep" checked={stillAsleep} onChange={(e) => setStillAsleep((e.target as HTMLInputElement).checked)} /> עדיין ישן
            </label>
            {!stillAsleep && (
              <>
                <label class="fl">התעורר ב</label>
                <div class="when">
                  <DateField testId="end-date" value={eDate} max={today} onChange={setEDate} />
                  <input type="time" data-testid="end-time" value={eTime} onInput={(e) => setETime((e.target as HTMLInputElement).value)} />
                </div>
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
