import { expect, test, type Page } from '@playwright/test';
import { install, resetServer } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

/** The reasons in the sync log, newest first (read from the phone's storage; the screen shows the same). */
const reasons = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('bl.synclog.v1') ?? '[]') as { why: string }[]).map((e) => e.why).reverse());

// Owner (performance session): an app left open untouched checks less often; the next touch checks at once and the log says why.
test('a touch on the screen after a quiet minute checks the server at once (logged as "נגיעה במסך"); a touch right after a check does not', async ({ page }) => {
  await page.clock.install();
  await install(page);
  await page.clock.runFor(1_000);

  // right after a check: a touch asks nothing
  await page.getByTestId('home').click({ position: { x: 5, y: 5 } });
  await page.clock.runFor(600);
  expect(await reasons(page)).not.toContain('touch');

  // a minute later by the phone's clock, with no check since (the slow pace of an untouched app)
  await page.clock.setSystemTime(Date.now() + 60_000);
  await page.getByTestId('home').click({ position: { x: 5, y: 5 } });
  await page.clock.runFor(600);
  await expect.poll(() => reasons(page)).toContain('touch');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('open-sync-log').click();
  await expect(page.getByTestId('log-entry').filter({ hasText: 'נגיעה במסך' })).toHaveCount(1);
});
