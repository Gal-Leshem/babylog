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
