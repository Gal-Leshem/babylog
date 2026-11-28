import { useEffect, useState } from 'preact/hooks';
import { type Medicine, doneToday, doseText, doseWarnings, dosesPerDay, endsCourse, medicineToday, todayText } from '../../shared/medicines';
import { localDate } from '../../shared/tz';
import { EARLIER_MIN, type Mark, archiveMedicine, logMedicine, undoMarks } from '../actions';
import { dayName, timeOf } from '../labels';
import { count, engine, useEngine, useNow, useOlderDoses, withOlderDoses } from '../state';
import { ConfirmDose } from './ConfirmDose';

/**
 * Where a medicine stands, as separate parts: given today (when, by whom) or not yet; next allowed time; course progress.
 * Each part is shown isolated (<bdi>) so names and numbers cannot reorder each other in right-to-left text.
 */
function statusParts(m: Medicine, events: Parameters<typeof medicineToday>[1], now: number): string[] {
  const t = medicineToday(m, events, now);
  const parts: string[] = [];
  const today = localDate(now);
  if (t.count > 0 && t.last) {
    // once a day: "ניתן היום 08:10"; several a day: "היום 1 מתוך 2 · אחרון 08:10" (as needed: "היום 2 · אחרון ...")
    if (dosesPerDay(m) === 1) parts.push(`ניתן היום ${timeOf(t.last.start)}`, t.last.user);
    else parts.push(`היום ${todayText(m, t.count).replace(' היום', '')}`, `אחרון ${timeOf(t.last.start)}`, t.last.user);
  }
  else if (t.last) parts.push(`לא ניתן היום · אחרון: ${dayName(t.last.start.slice(0, 10), today)} ${timeOf(t.last.start)}`);
  else parts.push('עוד לא ניתן');
  if (t.course) parts.push(t.course.done ? `${t.course.text} · משך מתן התרופה הסתיים` : t.course.text);
  return parts;
}

const joined = (parts: string[]) =>
  parts.map((p, i) => (
    <span key={i}>
      {i > 0 ? ' · ' : ''}
      <bdi>{p}</bdi>
    </span>
  ));

/**
 * The medicines window (Home button "תרופות" when more than one medicine is active): a big row per active medicine; a tap logs a
 * dose now. It stays open to mark several; "ביטול" takes back everything marked in it; it refreshes from the server when opened.
 */
export function MedsWindow({ onClose }: { onClose: () => void }) {
  const { events, settings } = useEngine();
  const now = useNow(15_000);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [pending, setPending] = useState<Medicine | null>(null);
  // (owner, feedback #6 / #7) a medicine archived from here: its own line with "בטל" (a toast would cover the window's buttons)
  const [archived, setArchived] = useState<{ name: string; undo: () => void } | null>(null);
  const archive = (m: Medicine) => {
    const undo = archiveMedicine(m, false);
    if (!undo) return;
    setMarks(marks.filter((k) => k.medicineId !== m.id)); // "ביטול הסימונים" no longer touches its doses
    setArchived({ name: m.name, undo });
  };
  const give = (m: Medicine) => {
    const r = logMedicine(m);
    if (r) setMarks([...marks, r]);
  };
  useEffect(() => {
    void engine.resume(); // the other parent may have just given something (one small request)
  }, []);
  useOlderDoses();
  const meds = withOlderDoses(settings.medicines.filter((m) => m.status === 'active')); // (long courses: their older doses from the server)
  // (owner) the dose just marked can be moved earlier or taken back from its own row, like the toast after a tap
  const moveEarlier = (mk: Mark, mins: number) => {
    if (mk.pick?.(mins) === null) return;
    count('toast.earlier');
    setMarks(marks.map((x) => (x === mk ? { ...x, chosen: mins } : x)));
  };
  const takeBack = (mk: Mark) => {
    count('toast.undo');
    undoMarks([mk]);
    setMarks(marks.filter((x) => x !== mk));
  };

  return (
    <div class="sheet-backdrop" data-testid="meds-window" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="תרופות">
        <h2>תרופות</h2>
        {archived && (
          <div class="tback medback" data-testid="meds-archived">
            <span>
              הועבר לארכיון: <bdi>{archived.name}</bdi>
            </span>
            <button
              type="button"
              class="undo"
              data-testid="meds-unarchive"
              onClick={() => {
                archived.undo();
                setArchived(null);
              }}
            >
              בטל
            </button>
          </div>
        )}
        <ul class="medpick">
          {meds.map((m) => {
            const mine = marks.filter((k) => k.medicineId === m.id);
            const marked = mine.length;
            const latest = mine[mine.length - 1];
            const t = medicineToday(m, events, now);
            const warn = doseWarnings(m, events, now);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  class={`medbtn ${marked ? 'marked' : ''} ${t.missing ? 'missing' : ''} ${warn.length ? 'warned' : ''}`}
                  data-testid="meds-row"
                  data-id={m.id}
                  onClick={() => (warn.length ? setPending(m) : give(m))}
                >
                  {/* (owner) a medicine done for today shows a ✓ instead of its icon */}
                  {doneToday(m, events, now) ? (
                    <span class="mi done" data-testid="meds-done-mark">
                      ✓
                    </span>
                  ) : (
                    <span class="mi emo">{m.icon}</span>
                  )}
                  <span class="mtext">
                    <span class="mn">
                      <bdi>{m.name}</bdi>
                      {doseText(m) ? (
                        <small>
                          {' · '}
                          <bdi>{doseText(m)}</bdi>
                        </small>
                      ) : null}
                    </span>
                    {warn.length > 0 && (
                      <span class="mwarn" data-testid="meds-warning">
                        {joined(warn)}
                      </span>
                    )}
                    <span class="mst" data-testid="meds-status">
                      {joined([...(marked ? [`✓ סומן עכשיו${marked > 1 ? ` ×${marked}` : ''}`] : []), ...statusParts(m, events, now)])}
                    </span>
                  </span>
                </button>
                {latest && (
                  <div class="tback medback" data-testid="meds-earlier">
                    <span>היה לפני</span>
                    {EARLIER_MIN.map((mins) => (
                      <button
                        type="button"
                        key={mins}
                        class={latest.chosen === mins ? 'on' : ''}
                        aria-pressed={latest.chosen === mins}
                        data-testid={`meds-back-${mins}`}
                        onClick={() => moveEarlier(latest, mins)}
                      >
                        {mins}
                      </button>
                    ))}
                    <span>דק׳</span>
                    <button type="button" class="undo" data-testid="meds-undo" onClick={() => takeBack(latest)}>
                      בטל
                    </button>
                  </div>
                )}
                {latest && endsCourse(m, events, now) && (
                  // (owner, feedback #6) the dose just marked ended the course (still true after "היה לפני"): archive it from here
                  <div class="tback medback" data-testid="meds-last">
                    <span>זו הייתה המנה האחרונה</span>
                    <button type="button" data-testid="meds-archive" onClick={() => archive(m)}>
                      העברה לארכיון
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div class="actions">
          <button type="button" class="primary" data-testid="meds-done" onClick={onClose}>
            סיום
          </button>
          <button
            type="button"
            data-testid="meds-cancel"
            disabled={marks.length === 0}
            onClick={() => {
              undoMarks(marks);
              onClose();
            }}
          >
            ביטול הסימונים
          </button>
        </div>
      </div>
      {pending && (
        <ConfirmDose
          medicine={pending}
          warnings={doseWarnings(pending, events, now)}
          last={medicineToday(pending, events, now).last}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            give(pending);
            setPending(null);
          }}
          onArchive={medicineToday(pending, events, now).course?.done ? () => (setPending(null), archive(pending)) : undefined}
        />
      )}
    </div>
  );
}

