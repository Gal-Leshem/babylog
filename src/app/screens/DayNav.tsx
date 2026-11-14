import { addDays } from '../../shared/tz';
import { dayHeading, dayName } from '../labels';

/** Previous/next day navigation. In a right-to-left layout "previous" is on the right. */
export function DayNav({ date, today, onChange }: { date: string; today: string; onChange: (d: string) => void }) {
  return (
    <div class="daynav" data-testid="daynav">
      <button type="button" aria-label="היום הקודם" data-testid="day-prev" onClick={() => onChange(addDays(date, -1))}>
        ›
      </button>
      <div class="dn-title">
        <strong data-testid="day-title">{dayName(date, today)}</strong>
        {date !== today && <small>{dayHeading(date)}</small>}
      </div>
      <button type="button" aria-label="היום הבא" data-testid="day-next" disabled={date >= today} onClick={() => onChange(addDays(date, 1))}>
        ‹
      </button>
      {date !== today && (
        <button type="button" class="today" data-testid="day-today" onClick={() => onChange(today)}>
          היום
        </button>
      )}
    </div>
  );
}
