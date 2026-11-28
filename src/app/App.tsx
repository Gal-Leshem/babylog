import { useEffect, useRef, useState } from 'preact/hooks';
import { localHour } from '../shared/tz';
import { POLL_IDLE_MS } from './engine';
import type { BabyEvent } from '../shared/types';
import { EventForm, type Moment } from './screens/EventForm';
import { History } from './screens/History';
import { Home } from './screens/Home';
import { Install, storageBlocked } from './screens/Install';
import { storageWorks } from './storage';
import { Settings } from './screens/Settings';
import { MedsWindow } from './screens/MedsWindow';
import { BottleWindow } from './screens/BottleWindow';
import { Summary } from './screens/Summary';
import { isNight } from './theme';
import { type Nav, followTheme, takeNav } from './statusbar';
import { BOTTLE_TOAST_MS, EARLIER_MIN, TOAST_ML } from './actions';
import { type Toast, TOAST_DONE_MS, count, engine, hideToast, holdToast, isToastGone, releaseToast, updateToast, useEngine, useNow, usePrefs, useToast } from './state';

type Tab = 'home' | 'history' | 'summary' | 'settings';
const TABS: [Tab, string, string][] = [
  ['home', '🏠', 'בית'],
  ['history', '📋', 'היסטוריה'],
  ['summary', '📊', 'סיכום'],
  ['settings', '⚙️', 'הגדרות'],
];

function useTheme(nav: () => Nav): void {
  const prefs = usePrefs();
  const now = useNow(60_000);
  useEffect(() => {
    const systemDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
    const h = localHour(now);
    const night = isNight(prefs.nightMode, h, systemDark);
    document.documentElement.dataset.theme = night ? 'night' : 'day';
    document.documentElement.dataset.tint = prefs.nightTint;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', night ? '#000000' : '#f7f2ea');
    followTheme(night ? 'night' : 'day', nav); // iPhone home-screen app: the status bar follows only after a reload
  }, [now, prefs.nightMode, prefs.nightTint]);
}

function Banner() {
  const st = useEngine();
  if (st.status === 'auth') {
    return (
      <div class="banner err" role="alert" data-testid="banner-auth">
        המפתח לא תקין. ב״הגדרות״ אפשר להתנתק ולהתחבר מחדש עם קוד חדש.
      </div>
    );
  }
  if (!storageWorks()) {
    return (
      <div class="banner err" role="alert" data-testid="banner-storage">
        {storageBlocked()}
      </div>
    );
  }
  if (st.lastError) {
    return (
      <div class="banner err" role="alert" data-testid="banner-rejected">
        פעולה אחת נדחתה בשרת ולא נשמרה ({st.lastError}).
        <button type="button" onClick={() => engine.clearError()}>
          הבנתי
        </button>
      </div>
    );
  }
  return <SyncMark />;
}

const SLOW_MS = 8_000;
const STALE_MS = 2 * 60_000;
/** (owner) "מתעדכן…" also says when the data was last updated once that is older than this (after a quiet while: opening, a touch) */
const UPDATING_OLD_MS = 60_000;
const hhmm = (t: number) => new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

/**
 * The quiet sync mark. It lives in the empty strip under the status bar, so nothing on the screen moves when it comes and goes,
 * and it is never a coloured band (at night iOS would tint the status bar with one). A small turning dot while something is
 * being sent or the first check after opening is on its way; words only when they help: "מתעדכן…" on opening, the number
 * waiting when sending takes long, and the reason when there is no connection (with the time of the last update when old).
 * (owner) After a quiet while (an opening, a touch on an app left open), "מתעדכן…" also says when the data was last updated.
 * (owner) While an app left untouched checks only every 30 s or more (`Engine.nextCheckIn`), the mark says quietly how current
 * the screen is: "עדכני לשעה HH:MM" (no dot); a touch brings back the usual pace and the words go.
 */
function SyncMark() {
  const st = useEngine();
  useNow(30_000); // the slow pace begins with no event of its own: look again every 30 s (only the mark redraws)
  const [slow, setSlow] = useState(false);
  const sending = st.pending > 0;
  useEffect(() => {
    if (!sending) return setSlow(false);
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [sending]);

  const trouble = st.status === 'offline' || st.status === 'error';
  const lazy = !trouble && !sending && !st.checking && st.lastSync !== null && engine.nextCheckIn() > POLL_IDLE_MS;
  if (!trouble && !sending && !st.checking && !lazy) return null;
  const waiting = st.pending > 0 ? ` · ${st.pending} ממתינים לסנכרון` : '';
  let text = '';
  if (trouble) {
    const old = st.lastSync !== null && Date.now() - st.lastSync > STALE_MS ? ` · עודכן ${hhmm(st.lastSync)}` : '';
    text = `${st.status === 'offline' ? 'אין חיבור' : 'שגיאת שרת, מנסה שוב'}${waiting}${old}`;
  } else if (sending) text = slow ? `מסנכרן${waiting}` : '';
  else if (lazy) text = `עדכני לשעה ${hhmm(st.lastSync!)}`;
  else text = st.lastSync !== null && Date.now() - st.lastSync > UPDATING_OLD_MS ? `מתעדכן… · עודכן לאחרונה ${hhmm(st.lastSync)}` : 'מתעדכן…';
  return (
    <div class={`syncmark ${trouble ? 'bad' : ''}`} role="status" aria-label={text || 'מסנכרן'} data-testid="banner-sync" data-state={trouble ? st.status : sending ? 'sending' : lazy ? 'current' : 'checking'}>
      {!lazy && <i />}
      {text && <span data-testid="sync-text">{text}</span>}
    </div>
  );
}

/** One − / + button of the toast after a bottle (a plain function, not a component). */
function amountButton(t: Toast, delta: number) {
  return (
    <button
      type="button"
      key={delta}
      disabled={t.done === 'undo'}
      data-testid={`toast-ml-${delta > 0 ? 'plus' : 'minus'}-${Math.abs(delta)}`}
      onClick={() => {
        count('toast.amount');
        const r = t.amount?.step(delta);
        if (r) updateToast(t.id, { text: r.text, amount: { ...t.amount!, ml: r.ml, suggest: r.suggest }, done: 'amount' }, BOTTLE_TOAST_MS);
      }}
    >
      {delta > 0 ? `+${delta}` : `−${-delta}`}
    </button>
  );
}

function ToastView() {
  const t = useToast();
  if (!t) return null;
  // gone by itself: invisible, but its place still catches a tap that was aimed at it (owner bug: the tap opened what lay under it)
  const gone = isToastGone();
  return (
    <div
      class={`toast ${t.tone ?? 'ok'}${gone ? ' gone' : ''}`}
      role="status"
      aria-live="polite"
      aria-hidden={gone}
      data-testid="toast"
      data-gone={gone ? '1' : undefined}
      key={t.id}
      onPointerDown={() => holdToast(t.id)}
      onPointerUp={() => releaseToast(t.id)}
      onPointerCancel={() => releaseToast(t.id)}
    >
      <div class="trow">
      <span data-testid="toast-text">{t.text}</span>
      {t.undo && (
        <button
          type="button"
          data-testid="toast-undo"
          class={t.done === 'undo' ? 'on' : ''}
          aria-pressed={t.done === 'undo'}
          disabled={t.done === 'undo'}
          onClick={() => {
            count('toast.undo');
            t.undo?.();
            // (owner) a moment with "בטל" lit, then gone; a failure has already put its own toast in place (another id: no change)
            updateToast(t.id, { text: 'בוטל', done: 'undo' }, TOAST_DONE_MS);
          }}
        >
          בטל
        </button>
      )}
      {t.action && !t.action.note && (
        <button
          type="button"
          data-testid="toast-action"
          disabled={t.done === 'undo'}
          onClick={() => {
            count('toast.wake');
            hideToast();
            t.action?.run();
          }}
        >
          {t.action.label}
        </button>
      )}
      </div>
      {t.action?.note && (
        // (owner) e.g. a feed while the baby is marked asleep: the offer to mark the wake-up, set apart from the confirmation
        <div class="tact" data-testid="toast-asleep">
          <span>
            <span class="emo">🌙</span> <span data-testid="toast-asleep-text">{t.action.note}</span>
          </span>
          <button
            type="button"
            data-testid="toast-action"
            disabled={t.done === 'undo'}
            onClick={() => {
              count('toast.wake');
              hideToast();
              t.action?.run();
            }}
          >
            <span class="emo">☀️</span> {t.action.label}
          </button>
        </div>
      )}
      {t.amount && (
        // (owner, F18) the amount of the bottle just logged; each tap keeps the toast a little longer
        <div class="tback tamt" data-testid="toast-amount">
          {TOAST_ML.filter((d) => d < 0).map((d) => amountButton(t, d))}
          <b data-testid="toast-ml">{t.amount.ml} מ״ל</b>
          {TOAST_ML.filter((d) => d > 0).map((d) => amountButton(t, d))}
        </div>
      )}
      {t.amount?.suggest && t.done !== 'undo' && (
        // (owner, F18) the same amount again and again: offer to make it the default of this kind
        <div class="tact" data-testid="toast-suggest">
          <span data-testid="toast-suggest-text">{t.amount.suggest.text}</span>
          <span class="tbtns">
            <button
              type="button"
              data-testid="toast-suggest-yes"
              onClick={() => {
                t.amount!.suggest!.yes();
                updateToast(t.id, { text: `ברירת המחדל עודכנה ל-${t.amount!.ml} מ״ל`, amount: { ...t.amount!, suggest: null } }, BOTTLE_TOAST_MS);
              }}
            >
              עדכון
            </button>
            <button
              type="button"
              data-testid="toast-suggest-no"
              onClick={() => {
                t.amount!.suggest!.no();
                updateToast(t.id, { amount: { ...t.amount!, suggest: null } }, BOTTLE_TOAST_MS);
              }}
            >
              לא עכשיו
            </button>
          </span>
        </div>
      )}
      {t.offer && t.done !== 'undo' && (
        // (owner, feedback #6) after a medicine's last dose: archive it from here (it replaces this toast with its own)
        <div class="tact" data-testid="toast-offer">
          <span data-testid="toast-offer-text">{t.offer.text}</span>
          <span class="tbtns">
            <button type="button" data-testid="toast-offer-yes" onClick={() => t.offer!.act()}>
              {t.offer.label}
            </button>
          </span>
        </div>
      )}
      {t.earlier && (
        // two taps to log something that happened a little while ago: the button, then one of these (owner)
        <div class="tback" data-testid="toast-earlier">
          <span>היה לפני</span>
          {EARLIER_MIN.map((m) => (
            <button
              type="button"
              key={m}
              class={t.earlier?.chosen === m ? 'on' : ''}
              aria-pressed={t.earlier?.chosen === m}
              disabled={t.done === 'undo'}
              data-testid={`toast-back-${m}`}
              onClick={() => {
                count('toast.earlier');
                const text = t.earlier?.pick(m);
                // (owner) the new time with the minute lit for a moment, then the toast goes; after a bottle it stays a little
                // longer, so the amount can still be set
                if (text) updateToast(t.id, { text, earlier: { ...t.earlier!, chosen: m }, done: 'earlier' }, t.sticky ? BOTTLE_TOAST_MS : TOAST_DONE_MS);
              }}
            >
              {m}
            </button>
          ))}
          <span>דק׳</span>
        </div>
      )}
    </div>
  );
}

/** History has one row per sleep: a finished sleep opens on its wake-up (owner agreed), an open one on falling asleep. */
const historyFocus = (e: BabyEvent): Moment | undefined => (e.type === 'sleep' ? (e.end ? 'end' : 'start') : undefined);

/** After a reload for the theme, the parent is back on the tab they were on, scrolled where they were. */
const restored = takeNav();
const startTab: Tab = TABS.some(([id]) => id === restored?.tab) ? (restored!.tab as Tab) : 'home';

export function App() {
  const st = useEngine();
  // `n` changes when the current tab is tapped again: its screen starts over (e.g. Settings > medicines back to Settings).
  const [{ tab, n }, setNav] = useState<{ tab: Tab; n: number }>({ tab: startTab, n: 0 });
  const tabNow = useRef(tab);
  tabNow.current = tab;
  useTheme(() => ({ tab: tabNow.current, scroll: document.querySelector('.main')?.scrollTop ?? 0 }));
  useEffect(() => {
    if (!restored?.scroll) return;
    requestAnimationFrame(() => document.querySelector('.main')?.scrollTo(0, restored.scroll));
  }, []);
  const [form, setFormState] = useState<{ mode: 'add' | 'edit'; event?: BabyEvent; focus?: Moment; wake?: boolean } | null>(null);
  const [medsOpen, setMedsState] = useState(false);
  // A form or the medicines window takes the screen: the toast of the last tap would lie over its buttons (owner: "ביטול"
  // must always be reachable), so it goes, at the moment of opening (not in an effect: an effect that ran late could also
  // remove the toast that saving the form shows).
  const setForm = (f: typeof form) => {
    if (f) hideToast();
    setFormState(f);
  };
  const [bottleOpen, setBottleState] = useState(false);
  const setBottleOpen = (open: boolean) => {
    if (open) hideToast();
    setBottleState(open);
  };
  const setMedsOpen = (open: boolean) => {
    if (open) hideToast();
    setMedsState(open);
  };

  if (!st.configured) return <Install />;

  return (
    <>
      <Banner />
      {/* One scroll container per tab (no shared scroll offset). Home is a fixed screen: nothing on it can be dragged out of place. */}
      <main class={`main ${tab === 'home' ? 'fixed' : ''}`} key={`${tab}-${n}`}>
        {tab === 'home' && <Home onEdit={(event, focus) => setForm({ mode: 'edit', event, focus })} onAddLate={() => setForm({ mode: 'add' })} onOpenMeds={() => (count('meds.window'), setMedsOpen(true))} onOpenBottle={() => (count('bottle.window'), setBottleOpen(true))} onFixWake={(event) => (count('sleep.forgotWake'), setForm({ mode: 'edit', event, focus: 'end', wake: true }))} />}
        {tab === 'history' && <History onEdit={(event) => setForm({ mode: 'edit', event, focus: historyFocus(event) })} />}
        {tab === 'summary' && <Summary />}
        {tab === 'settings' && <Settings />}
      </main>
      <ToastView />
      <nav class="tabs" aria-label="ניווט">
        {TABS.map(([id, icon, label]) => (
          <button type="button" key={id} class={tab === id ? 'on' : ''} data-testid={`tab-${id}`} aria-current={tab === id ? 'page' : undefined} onClick={() => (count(`tab.${id}`), setNav((v) => ({ tab: id, n: v.tab === id ? v.n + 1 : v.n })))}>
            <span class="ti">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {medsOpen && <MedsWindow onClose={() => setMedsOpen(false)} />}
      {bottleOpen && <BottleWindow onClose={() => setBottleOpen(false)} />}
      {form && <EventForm mode={form.mode} event={form.event} focus={form.focus} wake={form.wake} onClose={() => setForm(null)} />}
    </>
  );
}
