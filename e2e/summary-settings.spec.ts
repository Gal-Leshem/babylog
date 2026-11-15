import { expect, test } from '@playwright/test';
import { api, install, resetServer, seed, todayLocal, addDaysLocal } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

// The summary tests pin the app's clock to noon so they do not depend on the time they run.
const NOON = new Date('2026-11-14T10:00:00Z'); // 12:00 in Israel
const FIXED_TODAY = '2026-11-14';
const FIXED_YESTERDAY = '2026-11-13';
const today = todayLocal();
const yesterday = addDaysLocal(today, -1);

test('daily summary compares today with yesterday', async ({ page, request }) => {
  await seed(request, [
    { type: 'feed', detail: 'left', start: `${FIXED_TODAY} 01:00` },
    { type: 'feed', detail: 'right', start: `${FIXED_TODAY} 01:10` }, // same feeding (within 20 minutes)
    { type: 'feed', detail: 'left', start: `${FIXED_TODAY} 04:00` },
    { type: 'diaper', detail: 'wet', start: `${FIXED_TODAY} 02:00` },
    { type: 'diaper', detail: 'wet', start: `${FIXED_TODAY} 05:00` },
    { type: 'diaper', detail: 'poop', start: `${FIXED_TODAY} 06:00` },
    { type: 'vitamin_d', start: `${FIXED_TODAY} 08:10` },
    { type: 'sleep', start: `${FIXED_TODAY} 02:00`, end: `${FIXED_TODAY} 03:30` },
    { type: 'feed', detail: 'left', start: `${FIXED_YESTERDAY} 10:00` },
    { type: 'diaper', detail: 'both', start: `${FIXED_YESTERDAY} 11:00` },
  ]);
  await page.clock.setFixedTime(NOON);
  await install(page);
  await page.getByTestId('tab-summary').click();
  const cell = (row: string, col: number) => page.getByTestId(`sum-${row}`).locator('td').nth(col);
  await expect(cell('הנקות (האכלות)', 0)).toHaveText('2');
  await expect(cell('הנקות (האכלות)', 1)).toHaveText('1');
  await expect(cell('רווח ממוצע בין האכלות', 0)).toHaveText('3:00');
  await expect(cell('רווח ממוצע בין האכלות', 1)).toHaveText('—');
  await expect(cell('שמאל / ימין', 0)).toHaveText('2 / 1');
  await expect(cell('חיתול פיפי', 0)).toHaveText('2');
  await expect(cell('קקי', 0)).toHaveText('1');
  await expect(cell('פיפי + קקי', 1)).toHaveText('1');
  await expect(cell('שינה סה״כ', 0)).toHaveText('1:30');
  await expect(cell('הרצף הארוך ביותר', 0)).toHaveText('1:30');
  await expect(cell('ויטמין D', 0)).toHaveText('ניתן');
  await expect(cell('ויטמין D', 1)).toHaveText('לא ניתן');
  await expect(page.getByTestId('sum-col-a')).toHaveText('היום');
  await expect(page.getByTestId('sum-col-b')).toHaveText('אתמול');
});

test('summary splits a sleep that crosses midnight between the two days', async ({ page, request }) => {
  await seed(request, [{ type: 'sleep', start: `${FIXED_YESTERDAY} 23:00`, end: `${FIXED_TODAY} 01:30` }]);
  await page.clock.setFixedTime(NOON);
  await install(page);
  await page.getByTestId('tab-summary').click();
  await expect(page.getByTestId('sum-שינה סה״כ').locator('td').nth(0)).toHaveText('1:30'); // 00:00-01:30 today
  await expect(page.getByTestId('sum-שינה סה״כ').locator('td').nth(1)).toHaveText('1:00'); // 23:00-24:00 yesterday
});

test('summary can look at an earlier day', async ({ page, request }) => {
  await seed(request, [{ type: 'diaper', detail: 'wet', start: `${yesterday} 12:00` }]);
  await install(page);
  await page.getByTestId('tab-summary').click();
  await page.getByTestId('day-prev').click();
  await expect(page.getByTestId('day-title')).toHaveText('אתמול');
  await expect(page.getByTestId('sum-חיתול פיפי').locator('td').nth(0)).toHaveText('1');
});

test('settings: names, baby name and merge window are saved to the sheet', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('baby-name')).toHaveValue('Baby');
  await page.getByTestId('baby-name').fill('Little One');
  await page.getByTestId('parent-2').fill('Parent B');
  await page.getByTestId('merge-window').fill('30');
  await page.getByTestId('save-settings').click();
  await expect(page.getByTestId('settings-msg')).toHaveText('נשמר');
  await expect.poll(async () => (await api(request, { action: 'settings' })).settings).toEqual({ babyName: 'Little One', mergeWindowMin: 30, parents: ['Parent One', 'Parent B'] });
});

test('settings: invalid values are refused', async ({ page }) => {
  await install(page);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('merge-window').fill('500');
  await page.getByTestId('save-settings').click();
  await expect(page.getByTestId('settings-msg')).toContainText('לא נשמר');
});

test('settings: a merge window change affects how feedings are counted', async ({ page, request }) => {
  await seed(request, [
    { type: 'feed', detail: 'left', start: `${today} 01:00` },
    { type: 'feed', detail: 'right', start: `${today} 01:30` },
  ]);
  await install(page);
  await page.getByTestId('tab-summary').click();
  await expect(page.getByTestId('sum-הנקות (האכלות)').locator('td').nth(0)).toHaveText('2');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('merge-window').fill('45');
  await page.getByTestId('save-settings').click();
  await page.getByTestId('tab-summary').click();
  await expect(page.getByTestId('sum-הנקות (האכלות)').locator('td').nth(0)).toHaveText('1');
});

test('settings: "who am I" can be changed and is used for new entries', async ({ page, request }) => {
  await install(page, 1);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('me-option').nth(1).click();
  await page.getByTestId('tab-home').click();
  await page.getByTestId('btn-wet').click();
  await expect.poll(async () => (await api(request, { action: 'list', from: today, to: today })).events.map((e: { user: string }) => e.user)).toEqual(['Parent Two']);
});

test('settings: renaming the parent keeps "who am I" pointing at the same person', async ({ page, request }) => {
  await install(page, 1);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('parent-1').fill('Renamed');
  await page.getByTestId('save-settings').click();
  await expect(page.getByTestId('settings-msg')).toHaveText('נשמר');
  await page.getByTestId('tab-home').click();
  await page.getByTestId('btn-wet').click();
  await expect.poll(async () => (await api(request, { action: 'list', from: today, to: today })).events.map((e: { user: string }) => e.user)).toEqual(['Renamed']);
});

test('settings: the connection can be removed, after a confirmation tap', async ({ page }) => {
  await install(page);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('reset').click();
  await expect(page.getByTestId('reset')).toContainText('לחצו שוב');
  await expect(page.getByTestId('install')).toBeHidden();
  await page.getByTestId('reset').click();
  await expect(page.getByTestId('install')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('install')).toBeVisible(); // really forgotten
});

test('settings: shows sync state and offers the sheet link when the server provides one', async ({ page }) => {
  await install(page);
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('sync-info')).toContainText('הכל מסונכרן');
  await expect(page.getByTestId('sync-now')).toBeVisible();
});
