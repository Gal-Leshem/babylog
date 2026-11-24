import { useEffect, useState } from 'preact/hooks';
import { type DailySummary, dailySummary } from '../../shared/domain';
import { type Medicine, dosesOf } from '../../shared/medicines';
import { addDays, localDate } from '../../shared/tz';
import type { BabyEvent } from '../../shared/types';
import { KIND_LABEL, dayName, hm } from '../labels';
import { count, engine, setSummaryView, useEngine, useNow, usePrefs } from '../state';
import { DayNav } from './DayNav';
import { Insights } from './Insights';
import { Week } from './Week';

type Row = [label: string, value: (s: DailySummary) => string];

const ROWS: Row[] = [
  ['הנקות (האכלות)', (s) => String(s.feeds.count)],
  ['רווח ממוצע בין האכלות', (s) => (s.feeds.avgGapMin === null ? '—' : hm(s.feeds.avgGapMin))],
  ['שמאל / ימין', (s) => `${s.feeds.left} / ${s.feeds.right}`],
  // "פיפי + קקי" is one pee AND one poop (owner), as in "תובנות": no row of its own
  [KIND_LABEL.wet, (s) => String(s.diapers.wet + s.diapers.both)],
  [KIND_LABEL.poop, (s) => String(s.diapers.poop + s.diapers.both)],
  ['שינה סה״כ', (s) => (s.sleep.totalMin ? hm(s.sleep.totalMin) : '—')],
  ['הרצף הארוך ביותר', (s) => (s.sleep.longestMin ? hm(s.sleep.longestMin) : '—')],
];

/** A medicine's day: once a day says given or not; other schedules count the doses. */
function medValue(m: Medicine, events: readonly BabyEvent[], date: string): string {
  const n = dosesOf(m, events).filter((e) => e.start.slice(0, 10) === date).length;
  return m.schedule === 'daily' ? (n ? 'ניתן' : 'לא ניתן') : String(n);
}

/** The summary tab: the day table ("סיכום") or the pattern insights ("תובנות"); the choice is remembered on the device. */
export function Summary() {
  const view = usePrefs().summaryView;
  useEffect(() => count(view === 'insights' ? 'summary.insights' : 'summary.table'), [view]); // (owner, F15)
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
      {view === 'insights' ? (
        <Insights />
      ) : (
        <>
          <DaySummary />
          {/* (owner) the week at a glance is a dashboard, not an insight: under the day table */}
          <Week />
        </>
      )}
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
  // a row per medicine that is active, or was given on one of the two days (an archived one keeps its history here)
  const meds = settings.medicines.filter((m) => m.status === 'active' || dosesOf(m, events).some((e) => [date, prev].includes(e.start.slice(0, 10))));

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
          {meds.map((m) => (
            <tr key={m.id} data-testid={`sum-${m.name}`}>
              <th scope="row">
                <span class="emo">{m.icon}</span> <bdi>{m.name}</bdi>
              </th>
              <td>{medValue(m, events, date)}</td>
              <td class="dim">{medValue(m, events, prev)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted">שינה שחוצה חצות מתחלקת בין שני הימים. הנקות בהפרש של עד {settings.mergeWindowMin} דקות נספרות כהאכלה אחת. {KIND_LABEL.both} נספר גם כפיפי וגם כקקי.</p>
    </div>
  );
}
