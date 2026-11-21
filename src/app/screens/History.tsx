import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { byTimeDesc, eventTime } from '../../shared/domain';
import { formatLocal, localDate } from '../../shared/tz';
import type { BabyEvent } from '../../shared/types';
import { FILTERS, dayName, eventIcon, eventLabel, eventTimeText, isBackfilled, sleepDurationText } from '../labels';
import { engine, setHistoryView, useEngine, useNow, usePrefs } from '../state';
import { DayNav } from './DayNav';
import { babyWords } from '../words';

const DAY_MS = 24 * 3_600_000;

/** One history row (a plain function, not a component). */
function historyRow(e: BabyEvent, settings: ReturnType<typeof useEngine>['settings'], onEdit: (e: BabyEvent) => void) {
  return (
    <li key={e.id}>
      <button type="button" class="hrow" data-testid="history-row" onClick={() => onEdit(e)}>
        <span class="ht">{eventTimeText(e)}</span>
        <span class="hi">{eventIcon(e, settings.medicines)}</span>
        <span class="hl">
          {eventLabel(e, settings.medicines)}
          {e.type === 'sleep' && sleepDurationText(e) && <small> · {sleepDurationText(e)}</small>}
          {e.type === 'sleep' && e.start && !e.end && <small> · {babyWords(settings.babySex).sleepingNow}</small>}
          {e.note && <small class="note"> · {e.note}</small>}
        </span>
        <span class="hm">
          {e.user}
          {e.source === 'siri' ? ' 🎙' : ''}
          {isBackfilled(e) ? ' · בדיעבד' : ''}
          {e.edited ? ' · נערך' : ''}
        </span>
      </button>
    </li>
  );
}

/**
 * History: one day at a time (day navigation), or (owner) the last 24 hours across midnight, with a line where the day
 * changes. The choice is remembered on the device.
 */
export function History({ onEdit }: { onEdit: (e: BabyEvent) => void }) {
  const { events, settings } = useEngine();
  const now = useNow(60_000);
  const today = localDate(now);
  const view = usePrefs().historyView;
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (view !== 'day' || date >= engine.defaultRange().from) return;
    setLoading(true);
    void engine.ensureRange(date, date).finally(() => setLoading(false));
  }, [date, view]);

  const kind = (e: BabyEvent) => filter === 'all' || e.type === filter || (filter === 'vitamin_d' && e.type === 'medicine');
  const inView = (e: BabyEvent) => {
    if (view === 'day') return localDate(eventTime(e)) === date;
    const t = eventTime(e);
    return t > now - DAY_MS && t <= now + 60_000; // a minute ahead: a phone clock a little behind the other one
  };
  const rows = events.filter((e) => inView(e) && kind(e)).sort(byTimeDesc);

  // the last 24 hours: a line with the day's name where the day changes
  const items: JSX.Element[] = [];
  let shownDay = '';
  for (const e of rows) {
    const d = localDate(eventTime(e));
    if (view === 'last24' && d !== shownDay) {
      items.push(
        <li key={`day-${d}`} class="hday" data-testid="history-day">
          {dayName(d, today)}
        </li>,
      );
      shownDay = d;
    }
    items.push(historyRow(e, settings, onEdit));
  }

  return (
    <section class="page" data-testid="history">
      <div class="seg" role="tablist">
        <button type="button" role="tab" class={view === 'last24' ? 'on' : ''} aria-selected={view === 'last24'} data-testid="hview-last24" onClick={() => setHistoryView('last24')}>
          24 שעות אחרונות
        </button>
        <button type="button" role="tab" class={view === 'day' ? 'on' : ''} aria-selected={view === 'day'} data-testid="hview-day" onClick={() => setHistoryView('day')}>
          לפי יום
        </button>
      </div>
      {view === 'day' ? (
        <DayNav date={date} today={today} onChange={setDate} />
      ) : (
        <p class="muted hsince" data-testid="history-since">
          מ{dayName(localDate(now - DAY_MS), today)} {formatLocal(now - DAY_MS).slice(11)} עד עכשיו
        </p>
      )}
      <div class="chips small" role="tablist" aria-label="סינון">
        {FILTERS.map((f) => (
          <button type="button" key={f.id} class={`chip ${filter === f.id ? 'on' : ''}`} data-testid={`filter-${f.id}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {loading && <p class="muted">טוען…</p>}
      <ul class="list" data-testid="history-list">
        {items}
        {!loading && rows.length === 0 && <li class="empty">{view === 'day' ? 'אין אירועים ביום הזה' : 'אין אירועים ב-24 השעות האחרונות'}</li>}
      </ul>
    </section>
  );
}
