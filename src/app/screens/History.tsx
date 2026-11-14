import { useEffect, useState } from 'preact/hooks';
import { byTimeDesc, eventTime } from '../../shared/domain';
import { localDate } from '../../shared/tz';
import type { BabyEvent } from '../../shared/types';
import { FILTERS, eventIcon, eventLabel, eventTimeText, isBackfilled, sleepDurationText } from '../labels';
import { engine, useEngine, useNow } from '../state';
import { DayNav } from './DayNav';

export function History({ onEdit }: { onEdit: (e: BabyEvent) => void }) {
  const { events } = useEngine();
  const now = useNow(60_000);
  const today = localDate(now);
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (date >= engine.defaultRange().from) return;
    setLoading(true);
    void engine.ensureRange(date, date).finally(() => setLoading(false));
  }, [date]);

  const rows = events
    .filter((e) => localDate(eventTime(e)) === date && (filter === 'all' || e.type === filter))
    .sort(byTimeDesc);

  return (
    <section class="page" data-testid="history">
      <DayNav date={date} today={today} onChange={setDate} />
      <div class="chips small" role="tablist" aria-label="סינון">
        {FILTERS.map((f) => (
          <button type="button" key={f.id} class={`chip ${filter === f.id ? 'on' : ''}`} data-testid={`filter-${f.id}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {loading && <p class="muted">טוען…</p>}
      <ul class="list" data-testid="history-list">
        {rows.map((e) => (
          <li key={e.id}>
            <button type="button" class="hrow" data-testid="history-row" onClick={() => onEdit(e)}>
              <span class="ht">{eventTimeText(e)}</span>
              <span class="hi">{eventIcon(e)}</span>
              <span class="hl">
                {eventLabel(e)}
                {e.type === 'sleep' && sleepDurationText(e) && <small> · {sleepDurationText(e)}</small>}
                {e.type === 'sleep' && e.start && !e.end && <small> · ישן עכשיו</small>}
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
        ))}
        {!loading && rows.length === 0 && <li class="empty">אין אירועים ביום הזה</li>}
      </ul>
    </section>
  );
}
