import { useEffect, useRef, useState } from 'preact/hooks';
import { localHour } from '../shared/tz';
import type { BabyEvent } from '../shared/types';
import { EventForm, type Moment } from './screens/EventForm';
import { History } from './screens/History';
import { Home } from './screens/Home';
import { Install } from './screens/Install';
import { Settings } from './screens/Settings';
import { MedsWindow } from './screens/MedsWindow';
import { Summary } from './screens/Summary';
import { isNight } from './theme';
import { type Nav, followTheme, takeNav } from './statusbar';
import { EARLIER_MIN, TAP_TOAST_MS } from './actions';
import { engine, hideToast, updateToast, useEngine, useNow, usePrefs, useToast } from './state';

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
const hhmm = (t: number) => new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

/**
 * The quiet sync mark. It lives in the empty strip under the status bar, so nothing on the screen moves when it comes and goes,
 * and it is never a coloured band (at night iOS would tint the status bar with one). A small turning dot while something is
 * being sent or the first check after opening is on its way; words only when they help: "מתעדכן…" on opening, the number
 * waiting when sending takes long, and the reason when there is no connection (with the time of the last update when old).
 */
function SyncMark() {
  const st = useEngine();
  const [slow, setSlow] = useState(false);
  const sending = st.pending > 0;
  useEffect(() => {
    if (!sending) return setSlow(false);
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [sending]);

  const trouble = st.status === 'offline' || st.status === 'error';
  if (!trouble && !sending && !st.checking) return null;
  const waiting = st.pending > 0 ? ` · ${st.pending} ממתינים לסנכרון` : '';
  let text = '';
  if (trouble) {
    const old = st.lastSync !== null && Date.now() - st.lastSync > STALE_MS ? ` · עודכן ${hhmm(st.lastSync)}` : '';
    text = `${st.status === 'offline' ? 'אין חיבור' : 'שגיאת שרת, מנסה שוב'}${waiting}${old}`;
  } else if (sending) text = slow ? `מסנכרן${waiting}` : '';
  else text = 'מתעדכן…';
  return (
    <div class={`syncmark ${trouble ? 'bad' : ''}`} role="status" aria-label={text || 'מסנכרן'} data-testid="banner-sync" data-state={trouble ? st.status : sending ? 'sending' : 'checking'}>
      <i />
      {text && <span data-testid="sync-text">{text}</span>}
    </div>
  );
}

function ToastView() {
  const t = useToast();
  if (!t) return null;
  return (
    <div class={`toast ${t.tone ?? 'ok'}`} role="status" aria-live="polite" data-testid="toast" key={t.id}>
      <div class="trow">
      <span data-testid="toast-text">{t.text}</span>
      {t.undo && (
        <button
          type="button"
          data-testid="toast-undo"
          onClick={() => {
            t.undo?.();
            hideToast();
          }}
        >
          בטל
        </button>
      )}
      {t.action && (
        <button
          type="button"
          data-testid="toast-action"
          onClick={() => {
            hideToast();
            t.action?.run();
          }}
        >
          {t.action.label}
        </button>
      )}
      </div>
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
              data-testid={`toast-back-${m}`}
              onClick={() => {
                const text = t.earlier?.pick(m);
                if (text) updateToast(t.id, { text, earlier: { ...t.earlier!, chosen: m } }, TAP_TOAST_MS);
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

/** History has one row per sleep: a finished sleep opens on its wake-up (proposal, waiting for the owner), an open one on falling asleep. */
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
        {tab === 'home' && <Home onEdit={(event, focus) => setForm({ mode: 'edit', event, focus })} onAddLate={() => setForm({ mode: 'add' })} onOpenMeds={() => setMedsOpen(true)} onFixWake={(event) => setForm({ mode: 'edit', event, focus: 'end', wake: true })} />}
        {tab === 'history' && <History onEdit={(event) => setForm({ mode: 'edit', event, focus: historyFocus(event) })} />}
        {tab === 'summary' && <Summary />}
        {tab === 'settings' && <Settings />}
      </main>
      <ToastView />
      <nav class="tabs" aria-label="ניווט">
        {TABS.map(([id, icon, label]) => (
          <button type="button" key={id} class={tab === id ? 'on' : ''} data-testid={`tab-${id}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setNav((v) => ({ tab: id, n: v.tab === id ? v.n + 1 : v.n }))}>
            <span class="ti">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {medsOpen && <MedsWindow onClose={() => setMedsOpen(false)} />}
      {form && <EventForm mode={form.mode} event={form.event} focus={form.focus} wake={form.wake} onClose={() => setForm(null)} />}
    </>
  );
}
