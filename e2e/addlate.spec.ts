import { expect, test } from '@playwright/test';
import { addDaysLocal, allServerRows, install, resetServer, todayLocal } from './helpers';
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
  await expect(page.getByTestId('toast-text')).toContainText('נוסף: רטוב + צואה');
  await expect.poll(async () => (await allServerRows(request)).length).toBe(1);
  const e = (await allServerRows(request))[0]!;
  expect([e.type, e.detail]).toEqual(['diaper', 'both']);
  const gapMin = (parseLocal(e.created) - parseLocal(e.start)) / 60_000;
  expect(gapMin).toBeGreaterThanOrEqual(59);
  expect(gapMin).toBeLessThanOrEqual(61);
});

test('add a finished sleep with start and end', async ({ page, request }) => {
  await install(page);
  const yesterday = addDaysLocal(todayLocal(), -1);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-sleep').click();
  await page.getByTestId('start-date').fill(yesterday);
  await page.getByTestId('start-time').fill('22:00');
  await page.getByTestId('end-date').fill(yesterday);
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
  await page.getByTestId('start-date').fill(yesterday);
  await page.getByTestId('start-time').fill('22:00');
  await page.getByTestId('end-date').fill(yesterday);
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
