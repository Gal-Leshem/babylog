import { expect, test } from '@playwright/test';
import { install, resetServer } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const bg = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('night mode: automatic by time of day, with black background and no white surfaces', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-14T21:00:00Z')); // 23:00 in Israel
  await install(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  expect(await bg(page)).toBe('rgb(0, 0, 0)');
  const surfaces = await page.evaluate(() => [...document.querySelectorAll('.big, .tile, .tabs')].map((e) => getComputedStyle(e).backgroundColor));
  for (const c of surfaces) {
    const [r, g, b] = c.match(/\d+/g)!.map(Number) as [number, number, number];
    expect(Math.max(r, g, b)).toBeLessThan(60); // nothing bright
  }
});

test('day mode at midday, and the setting can force either mode', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-14T10:00:00Z')); // 12:00 in Israel
  await install(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('night-always').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await page.getByTestId('night-never').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await page.getByTestId('night-auto').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
});

test('"never" overrides the night hours', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-14T21:00:00Z'));
  await install(page);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('night-never').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
});

test('the 21:00 to 07:00 boundary', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-14T04:59:00Z')); // 06:59 in Israel
  await install(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await page.clock.setFixedTime(new Date('2026-11-14T05:01:00Z')); // 07:01
  await page.waitForTimeout(100);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
});

test('the app is installable and works offline once loaded', async ({ page, context, request }) => {
  await install(page);
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'BabyLog', lang: 'he', dir: 'rtl', display: 'standalone' });
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /');

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload(); // now controlled by the service worker
  await expect(page.getByTestId('home')).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible(); // loaded from the cache, no network at all
  await page.getByTestId('btn-wet').click();
  await expect(page.getByTestId('recent-row')).toHaveCount(1);
  await context.setOffline(false);
});

test('the page declares a Hebrew right-to-left document', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

// F4: an optional dim red night theme, per device. Every colour on screen must be red-dominant and dim, including the colour emoji.
test('night colour: dim red can be chosen, tints the emoji, survives a reload and leaves day mode alone', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-14T21:00:00Z')); // 23:00 in Israel
  await install(page);
  const fg = () => page.evaluate(() => getComputedStyle(document.body).color);
  const amber = await fg();
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('tint-amber')).toHaveClass(/\bon\b/); // amber stays the default
  await page.getByTestId('tint-red').click();
  await expect(page.locator('html')).toHaveAttribute('data-tint', 'red');
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-tint', 'red');
  const red = await fg();
  expect(red).not.toBe(amber);
  // colours not red-dominant or not dim (polled: buttons fade between themes)
  const offenders = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('body, .big, .tile, .tv, .tl, .ts, .tabs, .rrow, .link')].flatMap((e) => {
        const s = getComputedStyle(e);
        return [s.color, s.backgroundColor]
          .filter((c) => !c.endsWith(', 0)'))
          .filter((c) => {
            const [r, g, b] = c.match(/\d+/g)!.map(Number) as [number, number, number];
            return g > r * 0.45 + 1 || b > r * 0.45 + 1 || r >= 220;
          })
          .map((c) => `${c} ${e.className}`);
      }),
    );
  await expect.poll(offenders).toEqual([]);
  const emoji = await page.evaluate(() => [...document.querySelectorAll('.ico, .ti, .emo')].map((e) => getComputedStyle(e).filter));
  expect(emoji.length).toBeGreaterThan(8);
  for (const f of emoji) expect(f).toContain('hue-rotate');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('night-never').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.ti')!).filter)).toBe('none');
  expect(await bg(page)).not.toBe('rgb(0, 0, 0)');
});
