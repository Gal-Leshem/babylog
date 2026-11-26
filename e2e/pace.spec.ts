import { expect, test, type Page } from '@playwright/test';
import { control, install, resetServer } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

/** The reasons in the sync log, newest first (read from the phone's storage; the screen shows the same). */
const reasons = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('bl.synclog.v1') ?? '[]') as { why: string }[]).map((e) => e.why).reverse());

// Owner (performance session): an app left open untouched checks less often; the next touch checks at once and the log says why.
test('a touch on the screen after a quiet minute checks the server at once (logged as "נגיעה במסך"); a touch right after a check does not', async ({ page, request }) => {
  await page.clock.install();
  await install(page);
  await page.clock.runFor(1_000);

  // right after a check: a touch asks nothing
  await page.getByTestId('home').click({ position: { x: 5, y: 5 } });
  await page.clock.runFor(600);
  expect(await reasons(page)).not.toContain('touch');

  // a minute later by the phone's clock, with no check since (the slow pace of an untouched app). (CI) The server refuses
  // requests meanwhile, so no regular check can make the last update fresh again; the touch's check is logged all the same.
  await control(request, 'offline=1');
  await page.waitForTimeout(1_000);
  await page.clock.setSystemTime(Date.now() + 60_000);
  await page.getByTestId('home').click({ position: { x: 5, y: 5 } });
  await page.clock.runFor(600);
  await expect.poll(() => reasons(page)).toContain('touch');
  await control(request, 'offline=0');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('open-sync-log').click();
  await expect(page.getByTestId('log-entry').filter({ hasText: 'נגיעה במסך' })).toHaveCount(1);
});

// Owner: while an app left untouched checks only every 30 s or more, the top says how current the screen is ("עדכני לשעה HH:MM").
// (features session's conditions for the mark) one line, nothing moves at 360 x 560, the muted colour at night.
for (const night of [false, true]) {
  test(`an app left untouched for 10 minutes says "עדכני לשעה HH:MM" at the top; a touch takes it away (360 x 560, ${night ? 'night' : 'day'})`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 560 });
    const start = new Date(night ? '2026-11-14T21:00:00Z' : '2026-11-14T10:00:00Z'); // 23:00 / 12:00 in Israel
    await page.clock.install({ time: start });
    await install(page);
    const top = () => page.getByTestId('tile-feed').evaluate((e) => e.getBoundingClientRect().top);
    const before = await top();
    const mark = page.getByTestId('banner-sync');
    // the page's clock moves in small steps, so that real requests on their way finish before their own time limit is reached
    const advance = async (ms: number) => {
      for (let t = 0; t < ms; t += 1_000) {
        await page.clock.runFor(1_000);
        await page.waitForTimeout(40);
      }
    };
    await advance(16_000);
    await expect(mark, 'not while the app is in use').toBeHidden();

    await page.clock.setSystemTime(start.getTime() + 11 * 60_000); // nobody touched it for eleven minutes
    await advance(16_000);
    await expect(mark).toHaveAttribute('data-state', 'current');
    const text = page.getByTestId('sync-text');
    await expect(text).toHaveText(/^עדכני לשעה \d\d:\d\d$/);
    await expect(mark.locator('i'), 'no turning dot: nothing is happening').toHaveCount(0);
    expect(await top(), 'the tiles stay where they were').toBe(before);
    const look = await text.evaluate((e) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--muted)';
      document.body.appendChild(probe);
      const muted = getComputedStyle(probe).color;
      probe.remove();
      const r = e.getBoundingClientRect();
      return { lines: e.getClientRects().length, inside: r.left >= 0 && r.right <= window.innerWidth, color: getComputedStyle(e).color, muted, theme: document.documentElement.dataset.theme };
    });
    expect(look).toEqual({ lines: 1, inside: true, color: look.muted, muted: look.muted, theme: night ? 'night' : 'day' });

    await page.getByTestId('home').click({ position: { x: 5, y: 5 } }); // a touch: the usual pace again
    await page.clock.runFor(600);
    await expect(mark).toBeHidden({ timeout: 5_000 });
  });
}
