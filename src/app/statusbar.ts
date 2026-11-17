import { reloadWhenSafe } from './update';

/**
 * iOS 26 colours the status bar of a home-screen app from the page, but reads that colour only when the page loads: switching
 * between day and night while the app stays open (in Settings, or at 21:00 / 07:00) left a white bar over the black night
 * screen and a black bar over the day screen (owner screenshots). Changing colours, theme-color or showing a strip at the top
 * does not make iOS read it again. So on an iPhone home-screen app a theme change reloads the page, at a moment when nothing
 * can be lost (`reloadWhenSafe`); the tab and its scroll position come back, the data is shown from the phone's own copy
 * at once, and the inline script in index.html paints the new theme before anything else.
 * Not testable here on a real iPhone: the owner confirms on the phone.
 */

const NAV_KEY = 'bl.nav';
const LAST_KEY = 'bl.themeReload';
/**
 * A loop guard: if a reload for a theme came back still showing the other theme (the two theme rules disagreeing), do not
 * reload for that same theme again within this time. Switching back and forth by hand is never blocked.
 */
const GUARD_MS = 15_000;

export interface Nav {
  tab: string;
  scroll: number;
}

/** True only in an app added to the iPhone / iPad home screen (`navigator.standalone` exists only there). */
export const iosHomeScreen = (): boolean => typeof navigator !== 'undefined' && (navigator as { standalone?: boolean }).standalone === true;

/** The theme the page was painted with when it loaded (set by the inline script before this module runs). */
const loadedTheme = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
let waiting = false;

const session = {
  get(k: string): string | null {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* private mode: the reload still happens, the tab is not kept */
    }
  },
  remove(k: string): void {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

/** Called after every theme decision. `nav` tells where the parent is, so the reload can bring them back there. */
export function followTheme(theme: 'day' | 'night', nav: () => Nav): void {
  if (!iosHomeScreen() || waiting || theme === loadedTheme) return;
  const [lastAt, lastTheme] = (session.get(LAST_KEY) ?? '0:').split(':');
  const age = Date.now() - Number(lastAt);
  if (lastTheme === theme && age >= 0 && age < GUARD_MS) return;
  waiting = true;
  reloadWhenSafe(
    document,
    () => {
      session.set(NAV_KEY, JSON.stringify(nav()));
      session.set(LAST_KEY, `${Date.now()}:${document.documentElement.dataset.theme}`);
      location.reload();
    },
    () => {
      const still = document.documentElement.dataset.theme !== loadedTheme; // switched back meanwhile: nothing to do
      if (!still) waiting = false;
      return still;
    },
  );
}

/** Where to return after a theme reload (read once). */
export function takeNav(): Nav | null {
  const raw = session.get(NAV_KEY);
  if (!raw) return null;
  session.remove(NAV_KEY);
  try {
    const v = JSON.parse(raw) as Nav;
    return typeof v.tab === 'string' && typeof v.scroll === 'number' ? v : null;
  } catch {
    return null;
  }
}
