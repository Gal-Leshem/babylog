import { expect, test } from '@playwright/test';
import { actionsSeen, api, install, installExisting, nowLocal, resetServer, serverEvents } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('the other parent logs something: it appears by itself within seconds (nothing is tapped or triggered)', async ({ page, browser, request }) => {
  await install(page, 1);
  const ctx2 = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: 'he-IL' });
  const other = await ctx2.newPage();
  await installExisting(other, 2);
  await expect(other.getByTestId('tile-feed')).toContainText('אין עדיין');

  await other.getByTestId('btn-feed_left').click(); // she logs on her phone
  await expect.poll(async () => (await serverEvents(request)).length).toBe(1);

  // ...and the first phone shows it without anyone touching it: no tap, no "online" event, no reload
  await expect(page.getByTestId('tile-feed')).toContainText('שמאל', { timeout: 20_000 });
  await expect(page.getByTestId('btn-feed_right')).toHaveClass(/next/);
  await expect(page.getByTestId('recent-row').first()).toContainText('Parent Two');
  await ctx2.close();
});

test('checking for changes is cheap: tiny polls, no repeated list downloads while nothing changes', async ({ page, request }) => {
  await install(page);
  await resetServer(request); // forget the setup traffic (also clears data; the app keeps its local copy)
  await page.waitForTimeout(23_000);
  const seen = await actionsSeen(request);
  expect(seen.filter((a) => a === 'poll').length, JSON.stringify(seen)).toBeGreaterThanOrEqual(2);
  expect(seen.filter((a) => a === 'list').length, 'idle app must not keep downloading the list').toBeLessThanOrEqual(1);
});

test('a hidden app does not talk to the server; coming back refreshes at once', async ({ page, request }) => {
  await install(page);
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);

  await setVisibility('hidden');
  await page.waitForTimeout(1_500); // let a request that was already on its way finish before counting
  await resetServer(request);
  await api(request, { action: 'log', id: 'away-1', type: 'diaper', detail: 'wet', start: nowLocal(), user: 'Parent Two', source: 'siri' });
  await page.waitForTimeout(12_000);
  expect(await actionsSeen(request), 'no requests while hidden').toEqual(['log']);
  await expect(page.getByTestId('recent-row')).toHaveCount(0);

  await setVisibility('visible'); // she opens the app again
  await expect(page.getByTestId('recent-row')).toHaveCount(1, { timeout: 5_000 });
});

test('after an offline period it catches up without any tap once the connection is back', async ({ page, request }) => {
  await install(page);
  await request.get('http://127.0.0.1:8787/__control?offline=1');
  await page.waitForTimeout(11_000);
  await expect(page.getByTestId('banner-sync')).toContainText('אין חיבור', { timeout: 5_000 });
  await request.get('http://127.0.0.1:8787/__control?offline=0');
  await api(request, { action: 'log', id: 'back-1', type: 'feed', detail: 'right', start: nowLocal(), user: 'Parent Two', source: 'app' });
  await expect(page.getByTestId('banner-sync')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('tile-feed')).toContainText('ימין', { timeout: 20_000 });
});
