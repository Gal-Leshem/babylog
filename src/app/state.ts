import { useSyncExternalStore } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_PREFS, type NightMode, type NightTint, type Prefs, type SummaryView, type HistoryView } from './config';
import { Engine } from './engine';
import { browserStorage } from './storage';

export const engine = new Engine({ storage: browserStorage });

export const useEngine = () => useSyncExternalStore(engine.subscribe, engine.getState);

/** Re-renders on a timer; returns the current time. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// ---------- preferences (per device) ----------

const PREFS_KEY = 'bl.prefs.v1';
let prefs: Prefs = { ...DEFAULT_PREFS, ...(browserStorage.get<Partial<Prefs>>(PREFS_KEY) ?? {}) };
const prefListeners = new Set<() => void>();

function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch };
  browserStorage.set(PREFS_KEY, prefs);
  for (const l of prefListeners) l();
}
export const setNightMode = (mode: NightMode): void => setPrefs({ nightMode: mode });
export const setNightTint = (tint: NightTint): void => setPrefs({ nightTint: tint });
export const setSummaryView = (view: SummaryView): void => setPrefs({ summaryView: view });
export const setHistoryView = (view: HistoryView): void => setPrefs({ historyView: view });
export const usePrefs = (): Prefs =>
  useSyncExternalStore(
    (fn) => {
      prefListeners.add(fn);
      return () => prefListeners.delete(fn);
    },
    () => prefs,
  );

// ---------- toast with undo ----------

export interface Toast {
  id: number;
  text: string;
  undo?: () => void;
  /** a second button, e.g. "התעורר" after logging a feed while the baby is marked asleep */
  action?: { label: string; run: () => void; /** shown with the button on a row of its own, set apart from the message */ note?: string };
  tone?: 'ok' | 'warn' | 'error';
  /**
   * "It happened earlier": small buttons (minutes before the logged time) that move the entry just logged. `pick` moves it and
   * returns the toast's new text (null when it could not be moved); `chosen` is the button in effect.
   */
  earlier?: { pick: (mins: number) => string | null; chosen?: number };
  /**
   * (owner) A button in the toast was used: the toast stays for TOAST_DONE_MS with that button lit, so the parent sees the tap
   * worked, and then goes. 'undo': taken back (nothing else can be used any more); 'earlier': moved (another minute can still be
   * picked in that moment, counted from the logged time as before).
   */
  done?: 'undo' | 'earlier';
}

/** How long the toast stays after one of its buttons was used (owner: a moment of feedback, then gone). */
export const TOAST_DONE_MS = 1_000;
/**
 * (owner bug) A tap aimed at the toast just as it went landed on what lay under it (an entry in the recent list opened its edit
 * window; near the bottom, a tab). So a toast that goes by itself is first only made invisible: its place keeps catching taps
 * for this long, and only then is it removed.
 */
export const TOAST_SHIELD_MS = 600;
/** After a finger leaves a toast it was resting on, the toast stays at least this long. */
const TOAST_AFTER_TOUCH_MS = 1_500;

let toast: Toast | null = null;
/** The toast on screen has gone by itself: invisible, still catching taps (TOAST_SHIELD_MS). */
let toastGone = false;
let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastListeners = new Set<() => void>();
const emitToast = () => toastListeners.forEach((l) => l());

/** The toast's time is up: invisible at once, removed after the shield time. */
function fadeToast(): void {
  clearTimeout(toastTimer);
  if (!toast) return;
  toastGone = true;
  toast = { ...toast };
  emitToast();
  toastTimer = setTimeout(hideToast, TOAST_SHIELD_MS);
}

export function showToast(t: Omit<Toast, 'id'>, ms = 5000): void {
  toast = { ...t, id: ++toastSeq };
  toastGone = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(fadeToast, ms);
  emitToast();
}
/** Changes the toast on screen (if it is still the same one and still shown) and gives it a fresh `ms` before it goes. */
export function updateToast(id: number, patch: Partial<Omit<Toast, 'id'>>, ms = 5000): void {
  if (!toast || toast.id !== id || toastGone) return;
  toast = { ...toast, ...patch };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(fadeToast, ms);
  emitToast();
}
/** A finger is on the toast: it does not go from under it. */
export function holdToast(id: number): void {
  if (!toast || toast.id !== id || toastGone) return;
  clearTimeout(toastTimer);
}
/** The finger left the toast (a button's own action, which comes right after, may set its own time). */
export function releaseToast(id: number): void {
  if (!toast || toast.id !== id || toastGone) return;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(fadeToast, TOAST_AFTER_TOUCH_MS);
}
/** Removes the toast at once (e.g. a form is opening: its buttons must be reachable right away). */
export function hideToast(): void {
  clearTimeout(toastTimer);
  toast = null;
  toastGone = false;
  emitToast();
}
export const isToastGone = (): boolean => toastGone;
export const useToast = (): Toast | null =>
  useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toast,
  );
