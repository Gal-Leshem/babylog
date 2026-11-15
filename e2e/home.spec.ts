import { expect, test } from '@playwright/test';
import { encodeSetupCode } from '../src/app/config';
import { MOCK, api, control, install, installExisting, resetServer, seed, serverEvents, todayLocal } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('first-run install, then the home screen fits without scrolling', async ({ page }, info) => {
  await install(page);
  await expect(page.getByTestId('tile-feed')).toContainText('אין עדיין');
  const fits = await page.evaluate(() => {
    const m = document.querySelector('.main') as HTMLElement;
    return { main: m.scrollHeight <= m.clientHeight + 1, doc: document.documentElement.scrollHeight <= window.innerHeight + 1 };
  });
  expect(fits).toEqual({ main: true, doc: true });
  await page.screenshot({ path: info.outputPath('home.png') });
});

test('install rejects a malformed code and a wrong key, and survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('setup-code').fill('hello');
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-error')).toBeVisible();
  await page.getByTestId('setup-code').fill(encodeSetupCode(`${MOCK}/`, 'a-wrong-key-123'));
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-error')).toContainText('המפתח לא תקין');
  await expect(page.getByTestId('home')).toBeHidden();
  await install(page);
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible(); // configuration persisted
});

test('a setup code carrying the private /dev address is refused, and a real address can be supplied', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('setup-code').fill(encodeSetupCode(`${MOCK}/dev`, 'test-key'));
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-error')).toContainText('/dev');
  await expect(page.getByTestId('exec-url')).toBeVisible();
  await page.getByTestId('exec-url').fill('http://example.test/exec'); // not https
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-error')).toContainText('https://');
  await page.getByTestId('exec-url').fill(`${MOCK}/dev`); // still the test address
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-error')).toContainText('/exec');
  await page.getByTestId('exec-url').fill(`${MOCK}/`);
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-step2')).toBeVisible();
});

test('one tap on a feed button records it, shows it, and recommends the other side', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('btn-feed_left').click();
  await expect(page.getByTestId('toast-text')).toContainText('נשמר: הנקה שמאל');
  await expect(page.getByTestId('tile-feed')).toContainText('לפני 0:00 · שמאל');
  await expect(page.getByTestId('tile-feed')).toContainText('הבא: ימין');
  await expect(page.getByTestId('btn-feed_right')).toHaveClass(/next/);
  await expect(page.getByTestId('btn-feed_left')).not.toHaveClass(/next/);
  await expect.poll(async () => (await serverEvents(request)).map((e) => [e.type, e.detail, e.user, e.source])).toEqual([['feed', 'left', 'Parent One', 'app']]);
});

test('buttons lock for a moment after a tap to prevent double taps', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('btn-wet').click();
  await expect(page.getByTestId('btn-poop')).toBeDisabled();
  await expect(page.getByTestId('btn-wet')).toBeDisabled();
  await expect(page.getByTestId('btn-poop')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-wet').dblclick(); // a double tap records only one
  await expect.poll(async () => (await serverEvents(request)).length).toBe(2);
});

test('the three diaper buttons record the right detail', async ({ page, request }) => {
  await install(page);
  for (const kind of ['wet', 'poop', 'both'] as const) {
    await page.getByTestId(`btn-${kind}`).click();
    await expect(page.getByTestId('btn-wet')).toBeEnabled({ timeout: 3000 });
  }
  await expect.poll(async () => (await serverEvents(request)).map((e) => e.detail).sort()).toEqual(['both', 'poop', 'wet']);
});

test('undo within the toast takes the entry back', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('btn-wet').click();
  await expect(page.getByTestId('toast')).toBeVisible();
  await page.getByTestId('toast-undo').click();
  await expect(page.getByTestId('toast')).toBeHidden();
  await expect(page.getByTestId('recent')).toContainText('עדיין לא תועד כלום');
  await expect.poll(async () => (await serverEvents(request)).length).toBe(0);
});

test('the toast disappears by itself after five seconds', async ({ page }) => {
  await install(page);
  await page.getByTestId('btn-both').click();
  await expect(page.getByTestId('toast')).toBeVisible();
  await expect(page.getByTestId('toast')).toBeHidden({ timeout: 7000 });
});

test('the sleep button switches between asleep and awake with one sleep row', async ({ page, request }) => {
  await install(page);
  await expect(page.getByTestId('btn-sleep')).toContainText('נרדם');
  await page.getByTestId('btn-sleep').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('התעורר');
  await expect(page.getByTestId('tile-sleep')).toContainText('ישן כבר');
  await expect(page.getByTestId('btn-sleep')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-sleep').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('נרדם');
  await expect(page.getByTestId('tile-sleep')).toContainText('ער כבר');
  await expect.poll(async () => (await serverEvents(request)).filter((e) => e.type === 'sleep' && e.start && e.end).length).toBe(1);
  expect((await serverEvents(request)).filter((e) => e.type === 'sleep')).toHaveLength(1);
});

test('undoing a wake-up reopens the sleep', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('btn-sleep').click();
  await expect(page.getByTestId('btn-sleep')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-sleep').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('נרדם');
  await page.getByTestId('toast-undo').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('התעורר');
  await expect.poll(async () => (await serverEvents(request)).filter((e) => e.type === 'sleep' && !e.end).length).toBe(1);
});

test('vitamin D: status tile, and a second tap warns but is recorded', async ({ page, request }) => {
  await install(page);
  await expect(page.getByTestId('tile-vitamin')).toContainText('עדיין לא');
  await page.getByTestId('btn-vitamin_d').click();
  await expect(page.getByTestId('tile-vitamin')).toContainText('ניתן היום');
  await expect(page.getByTestId('btn-vitamin_d')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-vitamin_d').click();
  await expect(page.getByTestId('toast-text')).toContainText('כבר ניתן היום');
  await expect.poll(async () => (await serverEvents(request)).filter((e) => e.type === 'vitamin_d').length).toBe(2);
});

test('works without a connection: queued, visible, survives reload, syncs when back', async ({ page, request }) => {
  await install(page);
  await control(request, 'offline=1');
  await page.getByTestId('btn-feed_right').click();
  await expect(page.getByTestId('tile-feed')).toContainText('ימין');
  await expect(page.getByTestId('banner-sync')).toContainText('ממתינים לסנכרון');
  await page.reload();
  await expect(page.getByTestId('banner-sync')).toContainText('1 ממתינים');
  await expect(page.getByTestId('recent-row')).toHaveCount(1); // still there after a restart, with no connection
  await control(request, 'offline=0');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('banner-sync')).toBeHidden({ timeout: 10_000 });
  await expect.poll(async () => (await serverEvents(request)).length).toBe(1);
});

test('an event logged by voice shortcut appears, and the other parent’s next-side advice follows it', async ({ page, request }) => {
  await install(page);
  await api(request, { action: 'log', id: 'siri-1', type: 'feed', detail: 'left', start: `${todayLocal()} ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' })}`, user: 'Parent Two', source: 'siri' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('recent-row').first()).toContainText('Parent Two 🎙');
  await expect(page.getByTestId('btn-feed_right')).toHaveClass(/next/);
});

test('two phones stay in step through the shared sheet', async ({ page, browser, request }) => {
  await install(page, 1);
  const ctx2 = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: 'he-IL' });
  const other = await ctx2.newPage();
  await installExisting(other, 2);
  await page.getByTestId('btn-feed_left').click();
  await expect.poll(async () => (await serverEvents(request)).length).toBe(1);
  await other.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(other.getByTestId('tile-feed')).toContainText('שמאל');
  await expect(other.getByTestId('btn-feed_right')).toHaveClass(/next/);
  await other.getByTestId('btn-feed_right').click();
  await expect.poll(async () => (await serverEvents(request)).length).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('tile-feed')).toContainText('ימין');
  const rows = await serverEvents(request);
  expect(rows.map((r) => r.user).sort()).toEqual(['Parent One', 'Parent Two']);
  await ctx2.close();
});

test('seeded events from the server show up on the home screen', async ({ page, request }) => {
  await install(page);
  await seed(request, [{ id: 'old', type: 'diaper', detail: 'wet', start: `${todayLocal()} 00:01` }]);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('recent-row')).toHaveCount(1);
});
