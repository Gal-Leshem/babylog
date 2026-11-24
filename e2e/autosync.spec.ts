import { expect, test } from '@playwright/test';
import { actionsSeen, api, control, install, installExisting, nowLocal, resetCalls, resetServer, serverEvents, usageRows } from './helpers';
import { addDays, localDate } from '../src/shared/tz';

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

test('while the app is in use the other parent\'s entry shows within about 5 seconds', async ({ page, request }) => {
  await install(page);
  await page.waitForTimeout(500);
  await api(request, { action: 'log', id: 'quick-1', type: 'feed', detail: 'right', start: nowLocal(), user: 'Parent Two', source: 'app' });
  await expect(page.getByTestId('tile-feed')).toContainText('ימין', { timeout: 6_500 }); // the old pace (10 s) could miss this
});

test('checking for changes is cheap: tiny checks, no repeated list downloads while nothing changes', async ({ page, request }) => {
  await install(page);
  await resetServer(request); // forget the setup traffic (also clears data; the app keeps its local copy)
  await page.waitForTimeout(23_000);
  const seen = await actionsSeen(request);
  expect(seen.filter((a) => a === 'sync').length, JSON.stringify(seen)).toBeGreaterThanOrEqual(1); // light checks
  expect(seen.filter((a) => a.includes('list')).length, 'idle app must not keep downloading the list').toBeLessThanOrEqual(1);
  expect(seen.every((a) => a.startsWith('sync')), JSON.stringify(seen)).toBe(true); // one kind of request does everything
});

// The refactor's main promise (docs/REFACTOR_PLAN.md, phase 1): fewer round trips.
test('opening the app with nothing new is ONE small request (no list, not two)', async ({ page, request }) => {
  await install(page);
  await api(request, { action: 'log', id: 'pre-1', type: 'feed', detail: 'left', start: nowLocal(), user: 'Parent Two', source: 'app' });
  await expect(page.getByTestId('tile-feed')).toContainText('שמאל', { timeout: 15_000 }); // the phone is up to date
  await resetCalls(request);
  await page.reload(); // the app is opened again
  await expect(page.getByTestId('tile-feed')).toContainText('שמאל'); // shown from the phone's own copy
  await page.waitForTimeout(2_500);
  expect(await actionsSeen(request)).toEqual(['sync']);
});

test('opening the app after the other parent logged something: one request brings it', async ({ page, request }) => {
  await install(page);
  await page.goto('about:blank'); // the app is closed
  await api(request, { action: 'log', id: 'while-away', type: 'feed', detail: 'right', start: nowLocal(), user: 'Parent Two', source: 'app' });
  await resetCalls(request);
  await page.goto('/');
  await expect(page.getByTestId('tile-feed')).toContainText('ימין', { timeout: 5_000 });
  await expect(page.locator('.rrow.new')).toHaveCount(1); // news from the other phone
  await page.waitForTimeout(1_500);
  // (owner, after reading the sync log) only the change travels, not the whole fortnight, and the server opens no sheet for it
  expect(await actionsSeen(request)).toEqual(['sync+changes']);
});

// Owner's sync log: right after a return the whole list came a second time (iOS fires the timers that were frozen while the app
// was hidden, the 5-minute safety net among them). A return is one check; the safety net counts from there.
test('coming back after a while: one check and not also the whole list; the 5-minute safety net still runs while open', async ({ page, request }) => {
  await page.clock.install();
  await install(page);
  await page.clock.runFor(2_000);
  await page.waitForTimeout(1_500); // real time: the setup's own requests are answered (a slow server answers late)
  await resetCalls(request);
  await page.clock.fastForward(8 * 60_000); // the phone slept: no timer ran, then everything due fires at once
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.runFor(10_000);
  await expect.poll(async () => (await actionsSeen(request)).length).toBeGreaterThan(0);
  expect((await actionsSeen(request)).filter((a) => a.includes('+list'))).toEqual([]);
  for (let i = 0; i < 24; i++) {
    // the app stays open: time passes one check at a time, and the (real) server answers in between (a bigger jump would
    // let a request's own time limit run out while it is still on its way)
    await page.clock.runFor(15_000);
    await page.waitForTimeout(700);
  }
  await expect.poll(async () => (await actionsSeen(request)).filter((a) => a === 'sync+list').length).toBe(1);
});

test('a tap is one request and downloads no list', async ({ page, request }) => {
  await install(page);
  await page.waitForTimeout(600);
  await resetCalls(request);
  await page.getByTestId('btn-wet').click();
  await expect.poll(async () => (await serverEvents(request)).length).toBe(1);
  await expect(page.getByTestId('banner-sync')).toBeHidden();
  const seen = (await actionsSeen(request)).filter((a) => a !== 'list'); // "list" here is this test's own look at the server
  expect(seen[0]).toBe('sync:1');
  expect(seen.filter((a) => a.includes('list')), JSON.stringify(seen)).toEqual([]);
});

test('taps made without a connection travel together in one request when it is back', async ({ page, request }) => {
  await install(page);
  await control(request, 'offline=1');
  await page.getByTestId('btn-wet').click();
  await page.getByTestId('btn-poop').click(); // a click waits until the button is enabled again (the short tap lock)
  await page.getByTestId('btn-feed_left').click();
  await expect(page.getByTestId('banner-sync')).toContainText('3 ממתינים');
  await control(request, 'offline=0');
  await resetCalls(request);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('banner-sync')).toBeHidden({ timeout: 10_000 });
  expect((await actionsSeen(request))[0]).toBe('sync:3');
  expect((await serverEvents(request)).map((e) => e.type).sort()).toEqual(['diaper', 'diaper', 'feed']);
});

test('an older server (before "sync") still works: taps arrive and the other parent shows up', async ({ page, request }) => {
  await install(page);
  await page.waitForTimeout(600);
  await control(request, 'old=1'); // e.g. the site was published but the server deploy failed
  await resetCalls(request);
  await page.reload();
  await page.getByTestId('btn-wet').click();
  await expect.poll(async () => (await serverEvents(request)).length).toBe(1);
  await expect(page.getByTestId('banner-sync')).toBeHidden();
  await api(request, { action: 'log', id: 'old-1', type: 'feed', detail: 'right', start: nowLocal(), user: 'Parent Two', source: 'app' });
  await expect(page.getByTestId('tile-feed')).toContainText('ימין', { timeout: 20_000 });
  const seen = await actionsSeen(request);
  expect(seen.filter((a) => a.startsWith('sync')).length, `sync is tried once per session, then the old way: ${JSON.stringify(seen)}`).toBe(1);
  expect(seen).toContain('poll');
});

// A tap and then locking the phone used to leave the entry on the phone until the app was opened again.
test('an entry not yet delivered is handed to the browser when the app is left, and arrives without the app', async ({ page, request }) => {
  await install(page);
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await control(request, 'offline=1');
  await page.getByTestId('btn-poop').click(); // the request fails; a retry is a few seconds away
  // "אין חיבור" = the request has really failed and nothing carries the entry (while it is still on its way the app rightly sends no beacon)
  await expect(page.getByTestId('banner-sync')).toContainText('אין חיבור · 1 ממתינים');
  await control(request, 'offline=0');
  await setVisibility('hidden'); // the phone is locked before the retry
  await expect.poll(async () => (await serverEvents(request)).length, { timeout: 2_000 }).toBe(1);
  await setVisibility('visible'); // back in the app: nothing is written twice
  await expect(page.getByTestId('banner-sync')).toBeHidden({ timeout: 10_000 });
  expect(await serverEvents(request)).toHaveLength(1);
  await expect(page.getByTestId('recent-row')).toHaveCount(1);
});

test('settings show how long the last sync took', async ({ page }) => {
  await install(page);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('sync-timing')).toContainText(/סנכרון אחרון: \d+\.\d ש׳ \(מתוכן שרת \d+\.\d\)/);
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
  await control(request, 'offline=1');
  // the app notices by itself (no tap): the next check fails within the polling pace (5 s while in use) plus its timeout
  await expect(page.getByTestId('banner-sync')).toContainText('אין חיבור', { timeout: 16_000 });
  await control(request, 'offline=0');
  await api(request, { action: 'log', id: 'back-1', type: 'feed', detail: 'right', start: nowLocal(), user: 'Parent Two', source: 'app' });
  await expect(page.getByTestId('banner-sync')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('tile-feed')).toContainText('ימין', { timeout: 20_000 });
});

// (owner, F15) usage per parent: counted on the phone at no cost (no request while it is used), sent once for whole past days
// in one background request when the app is left, and never for today.
test('usage counts: nothing is sent while in use or for today; the next day, yesterday goes once, by parent', async ({ page, request }) => {
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  const start = Date.now();
  await page.clock.setSystemTime(start);
  await install(page);
  await page.getByTestId('btn-wet').click();
  await page.getByTestId('tab-summary').click();
  await page.getByTestId('view-insights').click();
  // (owner) the questions' state per parent: one turned on by hand (its card is seen), one turned off, the rest waiting for data
  await page.getByTestId('q-pick').click();
  await page.getByTestId('pick-gaps-switch').click();
  await page.getByTestId('pick-night-switch').click();
  await page.getByTestId('pick-night-switch').click();
  await page.getByTestId('pick-back').click();
  await expect(page.getByTestId('q-gaps')).toBeVisible();
  await page.getByTestId('tab-home').click();
  await setVisibility('hidden');
  await setVisibility('visible');
  await setVisibility('hidden');
  await page.waitForTimeout(1_000);
  expect(await actionsSeen(request)).not.toContain('usage');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('bl.usage.v1') ?? 'null'));
  const today = localDate(start);
  expect(kept.days[today]).toMatchObject({ open: 1, return: 1, 'log.wet': 1, 'tab.summary': 1, 'summary.table': 1, 'summary.insights': 1, 'tab.home': 1, 'seen.gaps': 1 });
  expect(kept.states[today]).toMatchObject({ gaps: 'on', night: 'off', sides: 'waiting', poop: 'waiting' });

  // the next morning the app is opened again and then left: yesterday's counts go, once
  await page.clock.setSystemTime(start + 24 * 3600_000);
  await setVisibility('visible');
  await setVisibility('hidden');
  await expect.poll(async () => (await usageRows(request)).length).toBe(1);
  const [row] = await usageRows(request);
  expect(row).toMatchObject({ date: today, user: 'Parent One', counts: { open: 1, return: 1, 'log.wet': 1, 'tab.summary': 1, 'seen.gaps': 1 }, states: { gaps: 'on', night: 'off', sides: 'waiting' } });
  expect(row!.install).toMatch(/^[a-z0-9]{4,}$/);
  await setVisibility('visible');
  await setVisibility('hidden');
  await page.waitForTimeout(1_000);
  expect((await actionsSeen(request)).filter((a) => a === 'usage')).toHaveLength(1);
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem('bl.usage.v1') ?? 'null'));
  expect(Object.keys(left.days)).toEqual([addDays(today, 1)]);
});
