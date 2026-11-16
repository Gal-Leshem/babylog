import { useEffect, useState } from 'preact/hooks';
import { localHour } from '../shared/tz';
import type { BabyEvent } from '../shared/types';
import { EventForm } from './screens/EventForm';
import { History } from './screens/History';
import { Home } from './screens/Home';
import { Install } from './screens/Install';
import { Settings } from './screens/Settings';
import { MedsWindow } from './screens/MedsWindow';
import { Summary } from './screens/Summary';
import { isNight } from './theme';
import { engine, hideToast, useEngine, useNow, usePrefs, useToast } from './state';

type Tab = 'home' | 'history' | 'summary' | 'settings';
const TABS: [Tab, string, string][] = [
  ['home', '🏠', 'בית'],
  ['history', '📋', 'היסטוריה'],
  ['summary', '📊', 'סיכום'],
  ['settings', '⚙️', 'הגדרות'],
];

function useTheme(): void {
  const prefs = usePrefs();
  const now = useNow(60_000);
  useEffect(() => {
    const systemDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
    const h = localHour(now);
    const night = isNight(prefs.nightMode, h, systemDark);
    document.documentElement.dataset.theme = night ? 'night' : 'day';
    document.documentElement.dataset.tint = prefs.nightTint;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', night ? '#000000' : '#f7f2ea');
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
  if (st.status === 'offline' || st.status === 'error' || st.pending > 0) {
    const waiting = st.pending > 0 ? ` · ${st.pending} ממתינים לסנכרון` : '';
    return (
      <div class="banner" data-testid="banner-sync">
        {st.status === 'offline' ? 'אין חיבור' : st.status === 'error' ? 'שגיאת שרת, מנסה שוב' : 'מסנכרן'}
        {waiting}
      </div>
    );
  }
  return null;
}

function ToastView() {
  const t = useToast();
  if (!t) return null;
  return (
    <div class={`toast ${t.tone ?? 'ok'}`} role="status" aria-live="polite" data-testid="toast" key={t.id}>
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
    </div>
  );
}

export function App() {
  useTheme();
  const st = useEngine();
  // `n` changes when the current tab is tapped again: its screen starts over (e.g. Settings > medicines back to Settings).
  const [{ tab, n }, setNav] = useState<{ tab: Tab; n: number }>({ tab: 'home', n: 0 });
  const [form, setForm] = useState<{ mode: 'add' | 'edit'; event?: BabyEvent } | null>(null);
  const [medsOpen, setMedsOpen] = useState(false);

  if (!st.configured) return <Install />;

  return (
    <>
      <Banner />
      {/* One scroll container per tab (no shared scroll offset). Home is a fixed screen: nothing on it can be dragged out of place. */}
      <main class={`main ${tab === 'home' ? 'fixed' : ''}`} key={`${tab}-${n}`}>
        {tab === 'home' && <Home onEdit={(event) => setForm({ mode: 'edit', event })} onAddLate={() => setForm({ mode: 'add' })} onOpenMeds={() => setMedsOpen(true)} />}
        {tab === 'history' && <History onEdit={(event) => setForm({ mode: 'edit', event })} />}
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
      {form && <EventForm mode={form.mode} event={form.event} onClose={() => setForm(null)} />}
    </>
  );
}
