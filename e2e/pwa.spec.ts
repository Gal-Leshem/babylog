import { expect, test } from '@playwright/test';
import { control, install, resetServer } from './helpers';

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

// Opening the app at night used to paint day colours first (the theme was set after the first render) and the buttons faded to dark:
// a short flash of light in a dark room. The theme must be on the page before any app code runs.
test('at night the page is dark before the app code runs (no flash of day colours)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-14T21:00:00Z')); // 23:00 in Israel
  await page.addInitScript(() => localStorage.setItem('bl.prefs.v1', JSON.stringify({ nightMode: 'auto', nightTint: 'red' })));
  await page.route(/\.(js|tsx?)(\?.*)?$/, (r) => r.abort()); // the app bundle never runs
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await expect(page.locator('html')).toHaveAttribute('data-tint', 'red');
  expect(await bg(page)).toBe('rgb(0, 0, 0)');
});

// Owner screenshot: at night the iPhone status bar was coloured (gold). iOS 26 ignores theme-color and tints the bar from the
// page: the full-screen container's background or a coloured element at the top (the "מסנכרן" banner was a bright strip).
// At night everything at the top is black: the container has a black background and banners are dark with coloured text.
test('night: the full-screen container is black and the sync banner is dark, in both night colours', async ({ page, request }) => {
  await page.clock.setFixedTime(new Date('2026-11-14T21:00:00Z')); // 23:00 in Israel
  await install(page);
  const dark = (c: string) => Math.max(...c.match(/\d+/g)!.slice(0, 3).map(Number)) < 40;
  for (const tint of ['amber', 'red']) {
    await page.getByTestId('tab-settings').click();
    await page.getByTestId(`tint-${tint}`).click();
    await page.getByTestId('tab-home').click();
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('app')!).backgroundColor)).toBe('rgb(0, 0, 0)');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(0, 0, 0)');
    await control(request, 'offline=1');
    await page.getByTestId('btn-wet').click();
    const banner = page.getByTestId('banner-sync');
    await expect(banner).toBeVisible();
    const bg = await banner.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(dark(bg), `${tint} banner background ${bg}`).toBe(true);
    await control(request, 'offline=0');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(banner).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId('btn-wet')).toBeEnabled({ timeout: 3000 });
  }
});

// Owner screenshots: switching day / night while the app stayed open (in Settings, or when 21:00 came) left the iPhone status
// bar in the old colour (white over the night screen, black over the day screen). iOS 26 reads that colour only when the page
// loads, so in a home-screen app a theme change reloads the page when nothing can be lost, and the parent stays where they were.
test.describe('the iPhone status bar follows a theme change while the app is open', () => {
  const homeScreen = (page: import('@playwright/test').Page) =>
    page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true }));
  const countLoads = (page: import('@playwright/test').Page) => {
    const loads = { n: 0 };
    page.on('load', () => loads.n++);
    return loads;
  };

  test('switching night mode in Settings reloads once and returns to Settings, scrolled where it was', async ({ page }) => {
    await homeScreen(page);
    await page.clock.setFixedTime(new Date('2026-11-14T10:00:00Z')); // 12:00 in Israel: day
    await install(page);
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('night-always').scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(() => document.querySelector('.main')!.scrollTop);
    expect(scrolled).toBeGreaterThan(0);
    const loads = countLoads(page);
    await page.getByTestId('night-always').click();
    await expect.poll(() => loads.n).toBe(1);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
    await expect(page.getByTestId('tab-settings')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => page.evaluate(() => document.querySelector('.main')!.scrollTop)).toBe(scrolled);
    await page.waitForTimeout(1_500);
    expect(loads.n, 'exactly one reload, no loop').toBe(1);

    await page.getByTestId('night-never').click(); // and back to day
    await expect.poll(() => loads.n).toBe(2);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  });

  test('at 21:00 the open app reloads by itself, but not while a form is open', async ({ page }) => {
    await homeScreen(page);
    await page.clock.install({ time: new Date('2026-11-14T18:58:00Z') }); // 20:58 in Israel
    await install(page);
    await page.getByTestId('add-late').click(); // a form is open
    await expect(page.getByTestId('event-form')).toBeVisible();
    const loads = countLoads(page);
    await page.clock.runFor(3 * 60_000); // 21:01
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night'); // the colours change at once
    await page.clock.runFor(10_000);
    expect(loads.n, 'nothing is lost: no reload while the form is open').toBe(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('event-form').click({ position: { x: 10, y: 10 } }); // tap outside closes it
    await expect(page.getByTestId('event-form')).toHaveCount(0);
    await page.clock.runFor(4_000);
    await expect.poll(() => loads.n).toBe(1);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
    await expect(page.getByTestId('home')).toBeVisible();
  });

  test('if a reload ever came back in the old theme, it does not reload again and again', async ({ page }) => {
    await homeScreen(page);
    await page.clock.setFixedTime(new Date('2026-11-14T10:00:00Z'));
    // simulate the inline theme script and the app disagreeing: the script always paints day
    await page.addInitScript(() => {
      const fix = () => document.documentElement.setAttribute('data-theme', 'day');
      document.addEventListener('readystatechange', fix);
    });
    await install(page);
    await page.getByTestId('tab-settings').click();
    const loads = countLoads(page);
    await page.getByTestId('night-always').click();
    await page.waitForTimeout(3_000);
    expect(loads.n, "one reload, then the guard stops it").toBe(1);
  });

  test('in a browser tab (not a home-screen app) nothing reloads', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-14T10:00:00Z'));
    await install(page);
    await page.getByTestId('tab-settings').click();
    const loads = countLoads(page);
    await page.getByTestId('night-always').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
    await page.waitForTimeout(1_500);
    expect(loads.n).toBe(0);
  });
});
