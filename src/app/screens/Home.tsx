import { useMemo, useState } from 'preact/hooks';
import { byTimeDesc, clock, elapsedHM, forgottenWake, lastFeed, nextSide, openSleep, sleepState } from '../../shared/domain';
import { GENERIC_ICON, type Medicine, VITAMIN_D_ID, doseWarnings, medicineToday, todayText } from '../../shared/medicines';
import { localDate, parseLocal } from '../../shared/tz';
import type { BabyEvent } from '../../shared/types';
import { logMedicine, quickLog, toggleSleep } from '../actions';
import { KIND_ICON, KIND_LABEL, type Kind, eventIcon, eventLabel, timeOf } from '../labels';
import { useEngine, useNow } from '../state';
import { ConfirmDose } from './ConfirmDose';

const LOCK_SAME_MS = 1500;
const LOCK_OTHERS_MS = 400;
const NEW_FOR_MS = 6_000;

const side = (s: string | null) => (s === 'left' ? 'שמאל' : s === 'right' ? 'ימין' : '');

interface RecentRow {
  key: string;
  e: BabyEvent;
  /** local time of this row */
  at: string;
  icon: string;
  label: string;
}

/**
 * The last 10 things that happened. A sleep is two moments here: "נרדם" when it started and "התעורר" when it ended (History keeps
 * one "שינה" row), so it is easy to check that a wake-up was logged. Tapping either opens the same sleep.
 */
function recentRows(events: readonly BabyEvent[], meds: readonly Medicine[]): RecentRow[] {
  const rows: RecentRow[] = [];
  // walk the newest entries first: the sort below is stable, so rows in the same minute stay newest-entered first
  for (const e of [...events].reverse()) {
    if (e.type === 'sleep') {
      if (e.start) rows.push({ key: `${e.id}:s`, e, at: e.start, icon: '🌙', label: 'נרדם' });
      if (e.end) rows.push({ key: `${e.id}:e`, e, at: e.end, icon: '☀️', label: 'התעורר' });
    } else rows.push({ key: e.id, e, at: e.start, icon: eventIcon(e, meds), label: eventLabel(e, meds) });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 10);
}

/** The medicines tile: one medicine shows its own state; several show what is missing, else the next allowed time, else "all given". */
function medsTile(meds: readonly Medicine[], events: readonly BabyEvent[], now: number) {
  const st = meds.map((m) => ({ m, t: medicineToday(m, events, now) }));
  if (meds.length === 1) {
    const { m, t } = st[0]!;
    return {
      title: m.name,
      value: todayText(m, t.count), // "ניתן היום" / "עדיין לא" once a day; "1 מתוך 2" several a day
      sub: t.nextAt !== null ? `הבאה מ-${clock(t.nextAt)}` : t.count > 0 && t.last ? timeOf(t.last.start) : '',
      warn: t.missing,
    };
  }
  const missing = st.filter((x) => x.t.missing);
  const next = st.map((x) => x.t.nextAt).filter((x): x is number => x !== null).sort((a, b) => a - b)[0];
  return {
    title: 'תרופות',
    value: missing.length ? `חסר: ${missing[0]!.m.name}` : next !== undefined ? `הבאה מ-${clock(next)}` : 'הכל ניתן',
    sub: missing.length > 1 ? `ועוד ${missing.length - 1}` : st.some((x) => x.t.course?.done) ? 'מתן תרופה הסתיים' : '',
    warn: missing.length > 0,
  };
}

export function Home({ onEdit, onAddLate, onOpenMeds, onFixWake }: { onEdit: (e: BabyEvent, focus?: 'start' | 'end') => void; onAddLate: () => void; onOpenMeds: () => void; onFixWake: (sleep: BabyEvent) => void }) {
  const { events, settings, arrived } = useEngine();
  const now = useNow(15_000);
  // After a tap the same button rests for 1.5 s (a double tap must not log twice); the others only for a moment, so
  // "פיפי" and then "נרדם" do not feel blocked.
  const [locked, setLocked] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Medicine | null>(null);

  const press = (id: string, fn: () => void) => {
    if (locked || held === id) return;
    fn();
    setLocked(true);
    setHeld(id);
    setFlash(id);
    setTimeout(() => setLocked(false), LOCK_OTHERS_MS);
    setTimeout(() => setHeld((h) => (h === id ? null : h)), LOCK_SAME_MS);
    setTimeout(() => setFlash(null), 350);
  };

  const today = localDate(now);
  const last = lastFeed(events);
  const next = nextSide(events);
  const sleep = sleepState(events);
  const meds = settings.medicines.filter((m) => m.status === 'active');
  const tile = meds.length ? medsTile(meds, events, now) : null;
  const recent = useMemo(() => recentRows(events, settings.medicines), [events, settings.medicines]);

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
      disabled={locked || held === kind}
      onClick={() => press(kind, () => quickLog(kind))}
    >
      <span class="ico">{KIND_ICON[kind]}</span>
      <span class="lbl">{KIND_LABEL[kind]}</span>
    </button>
  );

  // One medicine: its own icon and name, one tap logs it. Several: their icons (more than three: one friendly icon) above
  // "תרופות", and a tap opens the medicines window. None: no button at all.
  const medsButton = (list: readonly Medicine[]) => {
    if (list.length === 1) {
      const m = list[0]!;
      const id = m.id === VITAMIN_D_ID ? 'vitamin_d' : 'med';
      const give = () => (m.id === VITAMIN_D_ID ? quickLog('vitamin_d') : void logMedicine(m, true));
      return (
        <button
          type="button"
          class={`big ${flash === id ? 'flash' : ''}`}
          data-testid={`btn-${id}`}
          disabled={locked || held === id}
          // the parents' own limits say "not now": ask first (the only case with a second tap)
          onClick={() => (doseWarnings(m, events, now).length ? setConfirm(m) : press(id, give))}
        >
          <span class="ico">{m.icon}</span>
          <span class="lbl">{m.name}</span>
        </button>
      );
    }
    return (
      <button type="button" class="big" data-testid="btn-meds" onClick={onOpenMeds}>
        <span class="ico" data-testid="btn-meds-icons">
          {list.length > 3 ? GENERIC_ICON : list.map((m) => m.icon).join('')}
        </span>
        <span class="lbl">תרופות</span>
      </button>
    );
  };

  const asleep = sleep.state === 'asleep';
  const openStart = asleep ? openSleep(events)?.start : undefined;
  const forgotten = forgottenWake(events, now);
  // entries that just arrived from the other phone glow briefly
  const isNew = (id: string) => arrived.ids.has(id) && Date.now() - arrived.at < NEW_FOR_MS;
  return (
    <section class="home" data-testid="home">
      <div class={`status ${meds.length ? '' : 'two'}`}>
        <div class="tile" data-testid="tile-feed">
          <div class="tl">האכלה</div>
          <div class="tv">{feedValue}</div>
          <div class="ts">{next ? `הבא: ${side(next)}` : 'אין עדיין'}</div>
        </div>
        {forgotten ? (
          // (owner) open much longer than usual: probably a wake-up that was not logged; a tap opens it on waking up
          <button type="button" class="tile warn" data-testid="tile-sleep" onClick={() => onFixWake(forgotten)}>
            <div class="tl">שינה</div>
            <div class="tv">{sleepValue}</div>
            <div class="ts" data-testid="tile-sleep-sub">שכחתם התעוררות?</div>
          </button>
        ) : (
          <div class="tile" data-testid="tile-sleep">
            <div class="tl">שינה</div>
            <div class="tv">{sleepValue}</div>
            <div class="ts" data-testid="tile-sleep-sub">
              <span class="emo">{asleep ? '🌙' : '☀️'}</span>
              {/* (owner) while asleep: since when */}
              {asleep && openStart && ` נרדם ב-${timeOf(openStart)}`}
            </div>
          </div>
        )}
        {tile && (
          <div class={`tile ${tile.warn ? 'warn' : ''}`} data-testid="tile-vitamin">
            <div class="tl">{tile.title}</div>
            <div class="tv">{tile.value}</div>
            <div class="ts">{tile.sub}</div>
          </div>
        )}
      </div>

      <div class={`grid ${meds.length ? '' : 'nomeds'}`}>
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
            disabled={locked || held === 'sleep'}
            onClick={() => press('sleep', toggleSleep)}
          >
            <span class="ico">{asleep ? '☀️' : '🌙'}</span>
            <span class="lbl">{asleep ? 'התעורר' : 'נרדם'}</span>
          </button>
        </div>
        {meds.length > 0 && <div class="row1">{medsButton(meds)}</div>}
      </div>

      <button type="button" class="link" data-testid="add-late" onClick={onAddLate}>
        + הוספה בדיעבד
      </button>

      <ul class="recent" data-testid="recent">
        {recent.map(({ key, e, at, icon, label }) => (
          <li key={key}>
            <button type="button" class={`rrow ${isNew(e.id) ? 'new' : ''}`} data-testid="recent-row" onClick={() => onEdit(e, key.endsWith(':e') ? 'end' : key.endsWith(':s') ? 'start' : undefined)}>
              <span class="ri emo">{icon}</span>
              <span class="rl">{label}</span>
              <span class="rt">{timeOf(at)}</span>
              <span class="rm">
                {e.user}
                {e.source === 'siri' ? ' 🎙' : ''}
              </span>
            </button>
          </li>
        ))}
        {recent.length === 0 && <li class="empty">עדיין לא תועד כלום</li>}
      </ul>
      {confirm && (
        <ConfirmDose
          medicine={confirm}
          warnings={doseWarnings(confirm, events, now)}
          last={medicineToday(confirm, events, now).last}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            if (confirm.id === VITAMIN_D_ID) quickLog('vitamin_d');
            else logMedicine(confirm, true);
          }}
        />
      )}
    </section>
  );
}
