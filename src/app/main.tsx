import { render } from 'preact';
import { App } from './App';
import { count, engine, leaveUsage } from './state';
import './styles.css';
import { applyWhenAway, cameFromUpdateReload, markUpdateReload } from './update';

render(<App />, document.getElementById('app')!);
engine.start();

// (owner, F15) usage: an opening and every return count; leaving keeps the counts and sends whole past days once.
// A start that is only the reload to a new version counts as a return (otherwise deploy days inflate the openings).
count(cameFromUpdateReload() ? 'return' : 'open');
document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? count('return') : leaveUsage()));
window.addEventListener('pagehide', leaveUsage);

// Pick up new versions of the app: check whenever it comes back to the foreground, and reload once when a new version has
// taken over: when the app is next hidden or returned to, never while it is on screen (see `applyWhenAway` in update.ts).
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    applyWhenAway(document, () => {
      leaveUsage(); // the counts are kept before the page goes
      markUpdateReload();
      location.reload();
    });
  });
  void navigator.serviceWorker.ready.then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
    });
  });
}
