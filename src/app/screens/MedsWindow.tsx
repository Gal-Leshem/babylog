import { useEffect, useState } from 'preact/hooks';
import { clock } from '../../shared/domain';
import { type Medicine, doseText, medicineToday } from '../../shared/medicines';
import { localDate } from '../../shared/tz';
import { type Mark, logMedicine, undoMarks } from '../actions';
import { dayName, timeOf } from '../labels';
import { engine, useEngine, useNow } from '../state';

/**
 * Where a medicine stands, as separate parts: given today (when, by whom) or not yet; next allowed time; course progress.
 * Each part is shown isolated (<bdi>) so names and numbers cannot reorder each other in right-to-left text.
 */
function statusParts(m: Medicine, events: Parameters<typeof medicineToday>[1], now: number): string[] {
  const t = medicineToday(m, events, now);
  const parts: string[] = [];
  const today = localDate(now);
  if (t.count > 0 && t.last) parts.push(`ניתן היום ${timeOf(t.last.start)}${t.count > 1 ? ` (${t.count} פעמים)` : ''}`, t.last.user);
  else if (t.last) parts.push(`לא ניתן היום · אחרון: ${dayName(t.last.start.slice(0, 10), today)} ${timeOf(t.last.start)}`);
  else parts.push('עוד לא ניתן');
  if (t.nextAt !== null) parts.push(`הבאה מ-${clock(t.nextAt)}`);
  if (t.course) parts.push(t.course.done ? `${t.course.text} · הקורס הסתיים` : t.course.text);
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
  useEffect(() => {
    void engine.refresh(); // the other parent may have just given something
  }, []);
  const meds = settings.medicines.filter((m) => m.status === 'active');

  return (
    <div class="sheet-backdrop" data-testid="meds-window" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="תרופות">
        <h2>תרופות</h2>
        <ul class="medpick">
          {meds.map((m) => {
            const marked = marks.filter((k) => k.medicineId === m.id).length;
            const t = medicineToday(m, events, now);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  class={`medbtn ${marked ? 'marked' : ''} ${t.missing ? 'missing' : ''}`}
                  data-testid="meds-row"
                  data-id={m.id}
                  onClick={() => {
                    const r = logMedicine(m);
                    if (r) setMarks([...marks, r]);
                  }}
                >
                  <span class="mi emo">{m.icon}</span>
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
                    <span class="mst" data-testid="meds-status">
                      {joined([...(marked ? [`✓ סומן עכשיו${marked > 1 ? ` ×${marked}` : ''}`] : []), ...statusParts(m, events, now)])}
                    </span>
                  </span>
                </button>
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
    </div>
  );
}

