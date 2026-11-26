/**
 * A new version of the app took over: the page must reload to use it. Reloading at once could throw away something half
 * typed (a note, a new medicine), so it waits until nothing can be lost: the app is in the background, or no form or window
 * is open and nothing is being typed.
 */
export interface PageState {
  visible: boolean;
  /** a bottom sheet / window / the medicine form is open */
  formOpen: boolean;
  /** the cursor is in a field */
  typing: boolean;
}

export const safeToReload = (s: PageState): boolean => !s.visible || (!s.formOpen && !s.typing);

export function pageState(doc: Document): PageState {
  const tag = doc.activeElement?.tagName ?? '';
  return {
    visible: doc.visibilityState === 'visible',
    formOpen: doc.querySelector('.sheet-backdrop, .medform, .install') !== null,
    typing: tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT',
  };
}

/**
 * Reloads now if that is safe, otherwise as soon as it becomes safe (checked when the app is hidden and every few seconds).
 * `stillNeeded` (optional) is asked first each time: when it says no, the wait ends without a reload.
 */
export function reloadWhenSafe(doc: Document, reload: () => void, stillNeeded: () => boolean = () => true): void {
  let done = false;
  const stop = () => {
    done = true;
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', attempt);
  };
  const attempt = () => {
    if (done) return;
    if (!stillNeeded()) return stop();
    if (!safeToReload(pageState(doc))) return;
    stop();
    reload();
  };
  const timer = setInterval(attempt, 3_000);
  doc.addEventListener('visibilitychange', attempt);
  attempt();
}

/**
 * (owner's sync log 3) A new version that takes over while the app is on screen waits. Reloading at once aborted the check
 * that the return had just started and cost about 2 s on every opening after a deploy (and showed a reload while looking).
 * It is applied when the app is next hidden, or, if that moment passed without running (iOS freezes hidden pages), at once
 * on the next return, before anything is looked at. Not used for the theme reload (`statusbar.ts`).
 */
export function applyWhenAway(doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>, apply: () => void): void {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    doc.removeEventListener('visibilitychange', go);
    apply();
  };
  if (doc.visibilityState !== 'visible') return go();
  doc.addEventListener('visibilitychange', go);
}

/** Marks the next page load as an update reload (features session: the usage counts it as a return, not an opening). */
const UPDATE_FLAG = 'bl.updateReload';
type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const session = (): SessionStore | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null; // storage blocked: the opening is then counted as an opening
  }
};
export function markUpdateReload(store: SessionStore | null = session()): void {
  try {
    store?.setItem(UPDATE_FLAG, '1');
  } catch {
    /* private mode */
  }
}
/** True once, on the first start after an update reload. */
export function cameFromUpdateReload(store: SessionStore | null = session()): boolean {
  try {
    const was = store?.getItem(UPDATE_FLAG) === '1';
    if (was) store!.removeItem(UPDATE_FLAG);
    return was;
  } catch {
    return false;
  }
}
