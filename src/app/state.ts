import { useSyncExternalStore } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_PREFS, type NightMode, type NightTint, type Prefs } from './config';
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
  tone?: 'ok' | 'warn' | 'error';
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
