import { expect, test, type Page } from '@playwright/test';
import { install, resetServer } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const hide = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
const usageToday = (page: Page) =>
  page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('bl.usage.v1') ?? '{}') as { days?: Record<string, Record<string, number>> };
    const d = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    return s.days?.[d] ?? {};
  });

// Owner's sync log 3: on deploy days every return found a new version and the page reloaded on screen, which aborted the
// return's check ("אין חיבור") and cost about 2 s. A new version now waits until the app is hidden (or the next return).
test('a new version that takes over while the app is on screen waits; it is applied when the app is hidden, counted as a return', async ({ page }) => {
  await install(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload(); // now controlled by the service worker, like the installed app
  await expect(page.getByTestId('home')).toBeVisible();
  await page.evaluate(() => ((window as unknown as { beforeUpdate: boolean }).beforeUpdate = true));

  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))); // a new version took over
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => (window as unknown as { beforeUpdate?: boolean }).beforeUpdate), 'no reload while on screen').toBe(true);

  await hide(page); // leaving the app: now it is applied
  await page.waitForFunction(() => !(window as unknown as { beforeUpdate?: boolean }).beforeUpdate);
  await expect(page.getByTestId('home')).toBeVisible();
  // the usage counts were kept, and the reload counted as a return, not as another opening (features session)
  await hide(page); // leaving again stores this page's counts
  const counts = await usageToday(page);
  expect(counts.open, 'the first start and the manual reload').toBe(2);
  expect(counts.return).toBe(1);
});

test('a new version that takes over while the app is hidden is applied at once', async ({ page }) => {
  await install(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible();
  // already hidden when the new version takes over (iOS froze the page, then let it run on return)
  await page.evaluate(() => {
    (window as unknown as { beforeUpdate: boolean }).beforeUpdate = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  });
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  await page.waitForFunction(() => !(window as unknown as { beforeUpdate?: boolean }).beforeUpdate);
  await expect(page.getByTestId('home')).toBeVisible();
});
