import { DEFAULT_VITAMIN_D } from '../src/shared/medicines';
import { expect, test } from '@playwright/test';
import { api, install, nowLocal, pinPageDay, resetServer, seed, todayLocal, addDaysLocal } from './helpers';
import { ageText } from '../src/app/labels';

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
    { type: 'diaper', detail: 'both', start: `${FIXED_TODAY} 07:00` },
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
  // (owner) no separate "פיפי + קקי" row: it counts as one pee AND one poop, as in "תובנות"
  await expect(page.getByTestId('sum-פיפי + קקי')).toHaveCount(0);
  await expect(cell('פיפי', 0)).toHaveText('3'); // 2 pee + 1 both
  await expect(cell('קקי', 0)).toHaveText('2'); // 1 poop + 1 both
  await expect(cell('פיפי', 1)).toHaveText('1'); // yesterday: 1 both
  await expect(cell('קקי', 1)).toHaveText('1');
  await expect(page.getByTestId('day-summary')).toContainText('פיפי + קקי נספר גם כפיפי וגם כקקי');
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
  await expect(page.getByTestId('sum-פיפי').locator('td').nth(0)).toHaveText('1');
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
  await expect.poll(async () => (await api(request, { action: 'settings' })).settings).toEqual({ babyName: 'Little One', mergeWindowMin: 30, parents: ['Parent One', 'Parent B'], medicines: [DEFAULT_VITAMIN_D] });
});

test('settings: invalid values are refused', async ({ page }) => {
  await install(page);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('merge-window').fill('500');
  await page.getByTestId('save-merge').click();
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
  await page.getByTestId('save-merge').click();
  await expect(page.getByTestId('sect-behaviour').getByTestId('settings-msg')).toHaveText('נשמר');
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

// Owner: settings split into sections, each with its own icon and title, so it is easy to find your way.
test('settings: four sections with an icon and a title each, in order', async ({ page }) => {
  await install(page);
  await page.getByTestId('tab-settings').click();
  const heads = page.locator('.sect-h');
  await expect(heads).toHaveText(['👤אני והמשפחה', '💊תרופות', '🌙תצוגה והתנהגות', '🛠️מתקדם']);
  await expect(page.getByTestId('sect-family').getByTestId('baby-name')).toBeVisible();
  await expect(page.getByTestId('sect-medicines').getByTestId('open-medicines')).toBeVisible();
  await expect(page.getByTestId('sect-behaviour').getByTestId('night-auto')).toBeVisible();
  await expect(page.getByTestId('sect-behaviour').getByTestId('merge-window')).toBeVisible();
  await expect(page.getByTestId('sect-advanced').getByTestId('sync-now')).toBeVisible();
  await expect(page.getByTestId('sect-advanced').getByTestId('reset')).toBeVisible();
});

// Owner: the medicine form keeps a way back to Settings, and tapping the Settings tab always returns to Settings.
test('settings: back from the medicine form, and the Settings tab returns to Settings from anywhere inside it', async ({ page }) => {
  await install(page);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('open-medicines').click();
  await page.getByTestId('med-add').click();
  await page.getByTestId('med-back-settings').click();
  await expect(page.getByTestId('sect-family')).toBeVisible();
  for (const deeper of [['open-medicines'], ['open-medicines', 'med-add']]) {
    for (const id of deeper) await page.getByTestId(id).click();
    await expect(page.getByTestId('sect-family')).toBeHidden();
    await page.getByTestId('tab-settings').click();
    await expect(page.getByTestId('sect-family')).toBeVisible();
  }
});

// Owner: a sync log, hidden behind a button in Settings > advanced.
test('settings: "יומן סנכרון" opens the log of the last syncs; back returns to Settings', async ({ page, request }) => {
  await install(page);
  await api(request, { action: 'log', id: 'other-1', type: 'feed', detail: 'right', start: nowLocal(), user: 'Parent Two', source: 'app' });
  await expect(page.getByTestId('tile-feed')).toContainText('ימין', { timeout: 15_000 });
  await page.reload(); // the app is opened again
  await expect(page.getByTestId('home')).toBeVisible();
  await page.waitForTimeout(1_000);
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('sync-log')).toHaveCount(0); // hidden until asked for
  await page.getByTestId('open-sync-log').click();
  const entries = page.getByTestId('log-entry');
  await expect(entries.first()).toBeVisible();
  // the newest entry is that opening, with how long it took until the data was on screen
  await expect(entries.first().locator('.lh')).toContainText(/^\d\d:\d\d:\d\d · היום · פתיחה · \d+\.\d ש׳/);
  await expect(entries.first()).toContainText(/מהפתיחה עד שהנתונים הוצגו: \d+\.\d ש׳/);
  await expect(entries.filter({ hasText: 'נתונים חדשים: ' }).first()).toContainText(/שרת \d+\.\d ש׳ · רשת וגוגל \d+\.\d ש׳/);
  await page.getByTestId('log-back').click();
  await expect(page.getByTestId('sect-advanced')).toBeVisible();
});

// Owner (family servers): a privacy and terms page, from the install screen and from Settings; the install screen speaks to any family.
test('privacy and terms: on the install screen before connecting, and in Settings with a way back', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('install')).toContainText('הדביקו כאן את קוד ההתקנה שקיבלתם');
  await expect(page.getByTestId('privacy-text')).toHaveCount(0);
  await page.getByTestId('install-privacy').click();
  await expect(page.getByTestId('privacy-text')).toContainText('בלי ייעוץ רפואי');
  await install(page);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('open-privacy').click();
  await expect(page.getByTestId('privacy')).toContainText('מי יכול לראות');
  await page.getByTestId('privacy-back').click();
  await expect(page.getByTestId('sect-advanced')).toBeVisible();
});

// (owner) the baby's date of birth in Settings > family: saved at once in the sheet (both phones), with the age under it.
test("settings: the baby's date of birth is saved for both phones and shows the age", async ({ page, request }) => {
  const day = await pinPageDay(page);
  await install(page);
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('baby-birth-label')).toHaveText('לבחירת תאריך');
  await expect(page.getByTestId('baby-age')).toHaveCount(0);
  const birth = addDaysLocal(day, -40);
  await page.getByTestId('baby-birth').fill(birth);
  await expect(page.getByTestId('baby-age')).toHaveText(`גיל: ${ageText(birth, day)}`);
  expect(ageText(birth, day)).toMatch(/^חודש ו-\d+ ימים$/);
  await expect.poll(async () => (await api(request, { action: 'settings' })).settings.babyBirth).toBe(birth); // in the sheet
  // set on the other phone: this one follows
  const other = addDaysLocal(day, -12);
  await api(request, { action: 'settings', set: { babyBirth: other } });
  await page.getByTestId('tab-home').click();
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('baby-age')).toHaveText('גיל: 12 ימים', { timeout: 20_000 });
  await expect(page.getByTestId('baby-birth')).toHaveValue(other);
});
