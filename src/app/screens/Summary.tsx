import { useEffect, useState } from 'preact/hooks';
import { type DailySummary, dailySummary } from '../../shared/domain';
import { addDays, localDate } from '../../shared/tz';
import { KIND_LABEL, dayName, hm } from '../labels';
import { engine, setSummaryView, useEngine, useNow, usePrefs } from '../state';
import { DayNav } from './DayNav';
import { Insights } from './Insights';

type Row = [label: string, value: (s: DailySummary) => string];

const ROWS: Row[] = [
  ['הנקות (האכלות)', (s) => String(s.feeds.count)],
  ['רווח ממוצע בין האכלות', (s) => (s.feeds.avgGapMin === null ? '—' : hm(s.feeds.avgGapMin))],
  ['שמאל / ימין', (s) => `${s.feeds.left} / ${s.feeds.right}`],
  [KIND_LABEL.wet, (s) => String(s.diapers.wet)],
  [KIND_LABEL.poop, (s) => String(s.diapers.poop)],
  [KIND_LABEL.both, (s) => String(s.diapers.both)],
  ['שינה סה״כ', (s) => (s.sleep.totalMin ? hm(s.sleep.totalMin) : '—')],
  ['הרצף הארוך ביותר', (s) => (s.sleep.longestMin ? hm(s.sleep.longestMin) : '—')],
  ['ויטמין D', (s) => (s.vitaminD ? 'ניתן' : 'לא ניתן')],
];

/** The summary tab: the day table ("סיכום") or the pattern insights ("תובנות"); the choice is remembered on the device. */
export function Summary() {
  const view = usePrefs().summaryView;
  return (
    <section class="page" data-testid="summary">
      <div class="seg" role="tablist">
        <button type="button" role="tab" class={view === 'day' ? 'on' : ''} aria-selected={view === 'day'} data-testid="view-day" onClick={() => setSummaryView('day')}>
          סיכום
        </button>
        <button type="button" role="tab" class={view === 'insights' ? 'on' : ''} aria-selected={view === 'insights'} data-testid="view-insights" onClick={() => setSummaryView('insights')}>
          תובנות
        </button>
      </div>
      {view === 'insights' ? <Insights /> : <DaySummary />}
    </section>
  );
}

function DaySummary() {
  const { events, settings } = useEngine();
  const now = useNow(60_000);
  const today = localDate(now);
  const [date, setDate] = useState(today);

  useEffect(() => {
    const from = addDays(date, -1);
    if (from < engine.defaultRange().from) void engine.ensureRange(from, date);
  }, [date]);

  const prev = addDays(date, -1);
  const a = dailySummary(events, date, now, settings.mergeWindowMin);
  const b = dailySummary(events, prev, now, settings.mergeWindowMin);

  return (
    <div data-testid="day-summary">
      <DayNav date={date} today={today} onChange={setDate} />
      <table class="sum">
        <thead>
          <tr>
            <th />
            <th data-testid="sum-col-a">{dayName(date, today)}</th>
            <th data-testid="sum-col-b">{dayName(prev, today)}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([label, value]) => (
            <tr key={label} data-testid={`sum-${label}`}>
              <th scope="row">{label}</th>
              <td>{value(a)}</td>
              <td class="dim">{value(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted">שינה שחוצה חצות מתחלקת בין שני הימים. הנקות בהפרש של עד {settings.mergeWindowMin} דקות נספרות כהאכלה אחת.</p>
    </div>
  );
}
