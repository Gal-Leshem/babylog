import { dateLabel } from '../labels';

interface Props {
  /** 'YYYY-MM-DD' */
  value: string;
  /** Latest selectable day, 'YYYY-MM-DD' (none when omitted). */
  max?: string;
  /** Earliest selectable day, 'YYYY-MM-DD' (none when omitted). */
  min?: string;
  onChange: (date: string) => void;
  testId: string;
  /** shown instead of a date while `value` is empty */
  placeholder?: string;
}

/**
 * The date, written in Hebrew ("14 בנובמבר 2026"). Tapping it opens the phone's own date picker, which appears only
 * then. The system control is laid invisibly over the label, so one tap on the date goes straight to it.
 */
export function DateField({ value, max, min, onChange, testId, placeholder }: Props) {
  return (
    <div class="datefield">
      <div class="datebtn" aria-hidden="true">
        <span data-testid={`${testId}-label`}>{value ? dateLabel(value) : (placeholder ?? '')}</span>
        <span>📅</span>
      </div>
      <input
        type="date"
        class="dateinput"
        data-testid={testId}
        aria-label="תאריך"
        value={value}
        max={max}
        min={min}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          if (/^\d{4}-\d{2}-\d{2}$/.test(v) && (!max || v <= max) && (!min || v >= min)) onChange(v);
        }}
      />
    </div>
  );
}
