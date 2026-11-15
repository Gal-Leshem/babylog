import { expect, test } from '@playwright/test';
import { addDaysLocal, allServerRows, api, install, pickDate, resetServer, seed, todayLocal } from './helpers';
import { parseLocal } from '../src/shared/tz';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('add after the fact: "an hour ago" chip records the earlier time', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-both').click();
  await page.getByTestId('back-60').click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('toast-text')).toContainText('נוסף: פיפי + קקי');
  await expect.poll(async () => (await allServerRows(request)).length).toBe(1);
  const e = (await allServerRows(request))[0]!;
  expect([e.type, e.detail]).toEqual(['diaper', 'both']);
  const gapMin = (parseLocal(e.created) - parseLocal(e.start)) / 60_000;
  expect(gapMin).toBeGreaterThanOrEqual(59);
  expect(gapMin).toBeLessThanOrEqual(61);
});

test('the quick buttons offer "10 minutes ago" and no "now" button', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await expect(page.getByTestId('back-10')).toHaveText('לפני 10 דק׳');
  await expect(page.getByTestId('back-0')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'עכשיו', exact: true })).toHaveCount(0);
  await page.getByTestId('kind-wet').click();
  await page.getByTestId('back-10').click();
  await page.getByTestId('save').click();
  await expect.poll(async () => (await allServerRows(request)).length).toBe(1);
  const e = (await allServerRows(request))[0]!;
  const gapMin = (parseLocal(e.created) - parseLocal(e.start)) / 60_000;
  expect(gapMin).toBeGreaterThanOrEqual(9);
  expect(gapMin).toBeLessThanOrEqual(11);
});

test('add a finished sleep with start and end', async ({ page, request }) => {
  await install(page);
  const yesterday = addDaysLocal(todayLocal(), -1);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-sleep').click();
  await pickDate(page, 'start-date', yesterday);
  await page.getByTestId('start-time').fill('22:00');
  await pickDate(page, 'end-date', yesterday);
  await page.getByTestId('end-time').fill('23:30');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('event-form')).toBeHidden();
  await expect.poll(async () => (await allServerRows(request)).map((e) => [e.type, e.start, e.end])).toEqual([['sleep', `${yesterday} 22:00`, `${yesterday} 23:30`]]);
});

test('refuses a sleep that ends before it starts and keeps the form open', async ({ page, request }) => {
  await install(page);
  const yesterday = addDaysLocal(todayLocal(), -1);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-sleep').click();
  await pickDate(page, 'start-date', yesterday);
  await page.getByTestId('start-time').fill('22:00');
  await pickDate(page, 'end-date', yesterday);
  await page.getByTestId('end-time').fill('21:00');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('form-error')).toContainText('שעת הסיום קודמת להתחלה');
  await expect(page.getByTestId('event-form')).toBeVisible();
  expect(await allServerRows(request)).toHaveLength(0);
});

test('refuses a time in the future', async ({ page }) => {
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }));
  test.skip(hour >= 23, 'needs a later time of day to still be in the future');
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByTestId('start-time').fill('23:59');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('form-error')).toContainText('השעה בעתיד');
});

test('"still asleep" records an open sleep and flips the home button', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-sleep').click();
  await page.getByTestId('back-30').click();
  await page.getByTestId('still-asleep').check();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('התעורר');
  await expect(page.getByTestId('tile-sleep')).toContainText('ישן כבר 0:3');
  await expect.poll(async () => (await allServerRows(request)).filter((e) => !e.end).length).toBe(1);
});

test('cancel and tapping outside close the form without saving', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByRole('button', { name: 'ביטול' }).click();
  await expect(page.getByTestId('event-form')).toBeHidden();
  await page.getByTestId('add-late').click();
  await page.getByTestId('event-form').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('event-form')).toBeHidden();
  expect(await allServerRows(request)).toHaveLength(0);
});

test('the quick-time buttons light up when chosen, and stop when the time is set by hand', async ({ page }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  const on = (id: string) => page.getByTestId(id).evaluate((el) => el.classList.contains('on'));
  expect(await on('chip-today')).toBe(true); // the form opens on "today"
  await page.getByTestId('back-10').click();
  expect(await on('back-10')).toBe(true);
  expect(await on('chip-today')).toBe(false); // one lit button at a time
  await expect(page.getByTestId('back-10')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('back-30').click();
  expect(await on('back-30')).toBe(true);
  expect(await on('back-10')).toBe(false);
  await page.getByTestId('start-time').fill('01:23'); // typing a time by hand
  expect(await on('back-30')).toBe(false);
  await page.getByTestId('back-60').click();
  expect(await on('back-60')).toBe(true);
  await page.getByTestId('chip-yesterday').click();
  expect(await on('back-60')).toBe(false);
  expect(await on('chip-yesterday')).toBe(true);
  await page.getByTestId('back-15').click();
  await pickDate(page, 'start-date', todayLocal()); // choosing a date in the calendar also clears it
  expect(await on('back-15')).toBe(false);
});

test.describe('the date is in Hebrew', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-14T10:00:00Z')); // 14 November 2026 in Israel
  });

  test('the date is written in Hebrew and no calendar is drawn by the app', async ({ page }) => {
    await install(page);
    await page.getByTestId('add-late').click();
    await expect(page.getByTestId('start-date-label')).toHaveText('14 בנובמבר 2026');
    await expect(page.getByTestId('start-date')).toHaveAttribute('type', 'date'); // the phone's own picker
    await expect(page.getByTestId('start-date')).toHaveAttribute('max', '2026-11-14'); // no future days
    await expect(page.locator('.cal')).toHaveCount(0);
    // the control is laid over the label, so a tap on the date reaches it directly
    const label = (await page.locator('.datebtn').boundingBox())!;
    const input = (await page.getByTestId('start-date').boundingBox())!;
    expect(Math.abs(label.x - input.x)).toBeLessThan(2);
    expect(Math.abs(label.y - input.y)).toBeLessThan(2);
    expect(Math.abs(label.width - input.width)).toBeLessThan(2);
    expect(Math.abs(label.height - input.height)).toBeLessThan(2);
  });

  test('choosing another day updates the Hebrew label and is saved with that date', async ({ page, request }) => {
    await install(page);
    await page.getByTestId('add-late').click();
    await page.getByTestId('kind-wet').click();
    await pickDate(page, 'start-date', '2026-10-31');
    await expect(page.getByTestId('start-date-label')).toHaveText('31 באוקטובר 2026');
    await page.getByTestId('start-time').fill('23:30');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('event-form')).toBeHidden();
    await expect.poll(async () => (await api(request, { action: 'list', from: '2026-10-31', to: '2026-10-31' })).events.map((e: { start: string }) => e.start)).toEqual(['2026-10-31 23:30']);
  });

  test('a future day or an empty value is ignored', async ({ page }) => {
    await install(page);
    await page.getByTestId('add-late').click();
    await page.getByTestId('start-date').evaluate((el: HTMLInputElement) => {
      for (const v of ['2026-12-25', '']) {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await expect(page.getByTestId('start-date-label')).toHaveText('14 בנובמבר 2026');
  });

  test('"yesterday" shows yesterday in Hebrew, and editing an event shows its own date', async ({ page, request }) => {
    await seed(request, [{ id: 'old1', type: 'diaper', detail: 'wet', start: '2026-11-13 08:15' }]);
    await install(page);
    await page.getByTestId('add-late').click();
    await page.getByTestId('chip-yesterday').click();
    await expect(page.getByTestId('start-date-label')).toHaveText('13 בנובמבר 2026');
    await page.getByRole('button', { name: 'ביטול' }).click();
    await page.getByTestId('tab-history').click();
    await page.getByTestId('day-prev').click();
    await page.getByTestId('history-row').click();
    await expect(page.getByTestId('start-date-label')).toHaveText('13 בנובמבר 2026');
    await expect(page.getByTestId('start-time')).toHaveValue('08:15');
  });
});

test('the diaper buttons use the everyday words', async ({ page }) => {
  await install(page);
  await expect(page.getByTestId('btn-wet').locator('.lbl')).toHaveText('פיפי'); // exactly this word
  await expect(page.getByTestId('btn-poop').locator('.lbl')).toHaveText('קקי');
  await expect(page.getByTestId('btn-both').locator('.lbl')).toHaveText('פיפי + קקי');
  await expect(page.getByTestId('btn-both')).toContainText('פיפי + קקי');
  await page.getByTestId('add-late').click();
  await expect(page.getByTestId('kind-wet')).toContainText('פיפי');
  await expect(page.getByTestId('kind-wet')).not.toContainText('חיתול');
  await expect(page.getByTestId('kind-poop')).toContainText('קקי');
  await expect(page.getByTestId('kind-both')).toContainText('פיפי + קקי');
  expect(await page.locator('body').innerText()).not.toMatch(/רטוב|צואה|חיתול/);
});
