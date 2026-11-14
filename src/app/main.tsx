import { render } from 'preact';
import { App } from './App';
import { engine } from './state';
import './styles.css';

render(<App />, document.getElementById('app')!);
engine.start();

// Pick up new versions of the app: check whenever it comes back to the foreground,
// and reload once when a new version takes over.
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) location.reload();
  });
  void navigator.serviceWorker.ready.then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
    });
  });
}
