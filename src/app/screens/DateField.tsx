import { useState } from 'preact/hooks';
import { MONTHS, WEEKDAYS_SHORT, dateLabel } from '../labels';

interface Props {
  /** 'YYYY-MM-DD' */
  value: string;
  /** Latest selectable day, 'YYYY-MM-DD' (days after it are disabled). */
  max: string;
  onChange: (date: string) => void;
  testId: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const shiftMonth = (ym: string, delta: number): string => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
};

/**
 * A date picker in Hebrew (month names, Sunday-first weeks, right-to-left). The system date control follows the
 * phone's language and shows English month names, so the app draws its own small calendar instead.
 */
export function DateField({ value, max, onChange, testId }: Props) {
  const [open, setOpen] = useState(false);
  const [ym, setYm] = useState(value.slice(0, 7));

  const [y, m] = ym.split('-').map(Number) as [number, number];
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  const days = Array.from({ length: daysIn(y, m) }, (_, i) => `${ym}-${pad(i + 1)}`);
  const atLatestMonth = ym >= max.slice(0, 7);

  return (
    <div class="datefield">
      <button
        type="button"
        class="datebtn"
        data-testid={testId}
        aria-expanded={open}
        onClick={() => {
          setYm(value.slice(0, 7));
          setOpen(!open);
        }}
      >
        <span>{dateLabel(value)}</span>
        <span aria-hidden="true">📅</span>
      </button>
      {open && (
        <div class="cal" role="dialog" aria-label="בחירת תאריך" data-testid={`${testId}-cal`}>
          <div class="cal-head">
            <button type="button" aria-label="החודש הקודם" data-testid={`${testId}-prev`} onClick={() => setYm(shiftMonth(ym, -1))}>
              ›
            </button>
            <strong data-testid={`${testId}-month`} data-ym={ym}>
              {MONTHS[m - 1]} {y}
            </strong>
            <button type="button" aria-label="החודש הבא" data-testid={`${testId}-next`} disabled={atLatestMonth} onClick={() => setYm(shiftMonth(ym, 1))}>
              ‹
            </button>
          </div>
          <div class="cal-grid">
            {WEEKDAYS_SHORT.map((w) => (
              <span key={w} class="cal-wd">
                {w}
              </span>
            ))}
            {Array.from({ length: firstWeekday }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {days.map((d) => (
              <button
                type="button"
                key={d}
                class={`cal-day ${d === value ? 'sel' : ''} ${d === max ? 'today' : ''}`}
                data-testid={`${testId}-day-${d}`}
                disabled={d > max}
                aria-pressed={d === value}
                onClick={() => {
                  onChange(d);
                  setOpen(false);
                }}
              >
                {Number(d.slice(8))}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
