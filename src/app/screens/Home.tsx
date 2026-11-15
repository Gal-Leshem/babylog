import { useState } from 'preact/hooks';
import { byTimeDesc, elapsedHM, lastFeed, nextSide, sleepState, vitaminDOnDate } from '../../shared/domain';
import { localDate, parseLocal } from '../../shared/tz';
import type { BabyEvent } from '../../shared/types';
import { quickLog, toggleSleep } from '../actions';
import { KIND_ICON, KIND_LABEL, type Kind, eventIcon, eventLabel, timeOf } from '../labels';
import { useEngine, useNow } from '../state';

const side = (s: string | null) => (s === 'left' ? 'שמאל' : s === 'right' ? 'ימין' : '');

export function Home({ onEdit, onAddLate }: { onEdit: (e: BabyEvent) => void; onAddLate: () => void }) {
  const { events } = useEngine();
  const now = useNow(15_000);
  const [locked, setLocked] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const press = (id: string, fn: () => void) => {
    if (locked) return;
    fn();
    setLocked(true);
    setFlash(id);
    setTimeout(() => setLocked(false), 1500);
    setTimeout(() => setFlash(null), 350);
  };

  const today = localDate(now);
  const last = lastFeed(events);
  const next = nextSide(events);
  const sleep = sleepState(events);
  const vit = vitaminDOnDate(events, today);
  const recent = [...events].sort(byTimeDesc).slice(0, 10);

  const feedValue = last ? `לפני ${elapsedHM(now - parseLocal(last.start))} · ${side(last.detail)}` : '—';
  const sleepValue =
    sleep.state === 'asleep' ? `ישן כבר ${elapsedHM(now - sleep.since)}` : sleep.since !== null ? `ער כבר ${elapsedHM(now - sleep.since)}` : '—';

  // A plain function (not a component defined here): a component type created on every render would make Preact
  // rebuild all the buttons each time, and a tap that straddles a re-render could be lost.
  const kindButton = (kind: Kind, extra = '') => (
    <button
      key={kind}
      type="button"
      class={`big ${extra} ${flash === kind ? 'flash' : ''} ${(kind === 'feed_left' && next === 'left') || (kind === 'feed_right' && next === 'right') ? 'next' : ''}`}
      data-testid={`btn-${kind}`}
      disabled={locked}
      onClick={() => press(kind, () => quickLog(kind))}
    >
      <span class="ico">{KIND_ICON[kind]}</span>
      <span class="lbl">{KIND_LABEL[kind]}</span>
    </button>
  );

  const asleep = sleep.state === 'asleep';
  return (
    <section class="home" data-testid="home">
      <div class="status">
        <div class="tile" data-testid="tile-feed">
          <div class="tl">האכלה</div>
          <div class="tv">{feedValue}</div>
          <div class="ts">{next ? `הבא: ${side(next)}` : 'אין עדיין'}</div>
        </div>
        <div class="tile" data-testid="tile-sleep">
          <div class="tl">שינה</div>
          <div class="tv">{sleepValue}</div>
          <div class="ts">{asleep ? '🌙' : '☀️'}</div>
        </div>
        <div class={`tile ${vit ? '' : 'warn'}`} data-testid="tile-vitamin">
          <div class="tl">ויטמין D</div>
          <div class="tv">{vit ? 'ניתן היום' : 'עדיין לא'}</div>
          <div class="ts">{vit ? timeOf(vit.start) : ''}</div>
        </div>
      </div>

      <div class="grid">
        {/* feed buttons keep their physical side: left on the left */}
        <div class="feedrow">
          {kindButton('feed_left')}
          {kindButton('feed_right')}
        </div>
        <div class="row2">
          {kindButton('wet')}
          {kindButton('poop')}
        </div>
        <div class="row2">
          {kindButton('both')}
          <button
            type="button"
            class={`big sleep ${asleep ? 'asleep' : ''} ${flash === 'sleep' ? 'flash' : ''}`}
            data-testid="btn-sleep"
            disabled={locked}
            onClick={() => press('sleep', toggleSleep)}
          >
            <span class="ico">{asleep ? '☀️' : '🌙'}</span>
            <span class="lbl">{asleep ? 'התעורר' : 'נרדם'}</span>
          </button>
        </div>
        <div class="row1">
          {kindButton('vitamin_d')}
        </div>
      </div>

      <button type="button" class="link" data-testid="add-late" onClick={onAddLate}>
        + הוספה בדיעבד
      </button>

      <ul class="recent" data-testid="recent">
        {recent.map((e) => (
          <li key={e.id}>
            <button type="button" class="rrow" data-testid="recent-row" onClick={() => onEdit(e)}>
              <span>{eventIcon(e)}</span>
              <span class="rl">{eventLabel(e)}</span>
              <span class="rt">{timeOf(e.start || e.end)}</span>
              <span class="rm">
                {e.user}
                {e.source === 'siri' ? ' 🎙' : ''}
              </span>
            </button>
          </li>
        ))}
        {recent.length === 0 && <li class="empty">עדיין לא תועד כלום</li>}
      </ul>
    </section>
  );
}
