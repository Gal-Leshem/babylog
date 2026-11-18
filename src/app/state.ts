import { useSyncExternalStore } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_PREFS, type NightMode, type NightTint, type Prefs, type SummaryView } from './config';
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
  action?: { label: string; run: () => void };
  tone?: 'ok' | 'warn' | 'error';
  /**
   * "It happened earlier": small buttons (minutes before the logged time) that move the entry just logged. `pick` moves it and
   * returns the toast's new text (null when it could not be moved); `chosen` is the button in effect.
   */
  earlier?: { pick: (mins: number) => string | null; chosen?: number };
}

let toast: Toast | null = null;
let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastListeners = new Set<() => void>();
const emitToast = () => toastListeners.forEach((l) => l());

export function showToast(t: Omit<Toast, 'id'>, ms = 5000): void {
  toast = { ...t, id: ++toastSeq };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
  emitToast();
}
/** Changes the toast on screen (if it is still the same one) and gives it a fresh `ms` before it goes. */
export function updateToast(id: number, patch: Partial<Omit<Toast, 'id'>>, ms = 5000): void {
  if (!toast || toast.id !== id) return;
  toast = { ...toast, ...patch };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
  emitToast();
}
export function hideToast(): void {
  clearTimeout(toastTimer);
  toast = null;
  emitToast();
}
export const useToast = (): Toast | null =>
  useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toast,
  );
