import type { BabyEvent } from '../../shared/types';
import type { Medicine } from '../../shared/medicines';
import { timeOf } from '../labels';

/**
 * The one case where logging takes a second tap: the parents' own limits say "not now" (too early, today's doses given, the daily
 * maximum, or the medicine's period is over). It never blocks: "לרשום בכל זאת" logs anyway.
 */
export function ConfirmDose({
  medicine,
  warnings,
  last,
  onConfirm,
  onCancel,
  onArchive,
}: {
  medicine: Medicine;
  warnings: string[];
  /** the latest dose, to say when and by whom */
  last: BabyEvent | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  /** (owner, feedback #7) the medicine's course is over: offer to archive it instead of logging */
  onArchive?: () => void;
}) {
  return (
    <div class="sheet-backdrop confirm" data-testid="confirm-dose" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div class="sheet" role="alertdialog" aria-modal="true" aria-label="אישור מנה">
        <h2>
          <span class="emo">{medicine.icon}</span> <bdi>{medicine.name}</bdi>
        </h2>
        <ul class="warnlist" data-testid="confirm-warnings">
          {warnings.map((w) => (
            <li key={w}>
              <bdi>{w}</bdi>
            </li>
          ))}
        </ul>
        {last && (
          <p class="muted" data-testid="confirm-last">
            אחרון: <bdi>{timeOf(last.start)}</bdi> · <bdi>{last.user}</bdi>
          </p>
        )}
        <p>לרשום בכל זאת?</p>
        <div class="actions">
          <button type="button" class="primary" data-testid="confirm-yes" onClick={onConfirm}>
            לרשום בכל זאת
          </button>
          {onArchive && (
            <button type="button" data-testid="confirm-archive" onClick={onArchive}>
              העברה לארכיון
            </button>
          )}
          <button type="button" data-testid="confirm-no" onClick={onCancel}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
