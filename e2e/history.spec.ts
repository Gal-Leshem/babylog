import { expect, test } from '@playwright/test';
import { addDaysLocal, allServerRows, api, install, resetServer, seed, todayLocal } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const today = todayLocal();

async function seedToday(request: Parameters<typeof seed>[0]) {
  await seed(request, [
    { id: 'h-feed', type: 'feed', detail: 'left', start: `${today} 00:01`, user: 'Parent Two' },
    { id: 'h-diaper', type: 'diaper', detail: 'wet', start: `${today} 00:02`, user: 'Parent One' },
    { id: 'h-vit', type: 'vitamin_d', start: `${today} 00:03`, user: 'Parent One', source: 'siri' },
    { id: 'h-yday', type: 'diaper', detail: 'poop', start: `${addDaysLocal(today, -1)} 12:00` },
  ]);
}

async function openHistory(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('history')).toBeVisible();
}

test('lists today newest first with who logged it and whether it came from voice', async ({ page, request }) => {
  await install(page);
  await seedToday(request);
  await openHistory(page);
  const rows = page.getByTestId('history-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('ויטמין D');
  await expect(rows.nth(0)).toContainText('Parent One 🎙');
  await expect(rows.nth(2)).toContainText('הנקה שמאל');
  await expect(rows.nth(2)).toContainText('Parent Two');
  await expect(rows.nth(2)).toContainText('00:01');
});

test('filters by event type', async ({ page, request }) => {
  await install(page);
  await seedToday(request);
  await openHistory(page);
  await page.getByTestId('filter-diaper').click();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await expect(page.getByTestId('history-row')).toContainText('חיתול רטוב');
  await page.getByTestId('filter-all').click();
  await expect(page.getByTestId('history-row')).toHaveCount(3);
});

test('navigates between days', async ({ page, request }) => {
  await install(page);
  await seedToday(request);
  await openHistory(page);
  await expect(page.getByTestId('day-next')).toBeDisabled();
  await page.getByTestId('day-prev').click();
  await expect(page.getByTestId('day-title')).toHaveText('אתמול');
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await expect(page.getByTestId('history-row')).toContainText('צואה');
  await page.getByTestId('day-prev').click();
  await expect(page.getByText('אין אירועים ביום הזה')).toBeVisible();
  await page.getByTestId('day-today').click();
  await expect(page.getByTestId('history-row')).toHaveCount(3);
});

test('editing an event changes it everywhere and keeps its creation time', async ({ page, request }) => {
  await install(page);
  await seedToday(request);
  await openHistory(page);
  await page.getByTestId('filter-diaper').click();
  await page.getByTestId('history-row').click();
  await expect(page.getByTestId('event-form')).toBeVisible();
  await page.getByTestId('kind-poop').click();
  await page.getByTestId('note').fill('בדיקה');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('event-form')).toBeHidden();
  await expect(page.getByTestId('history-row')).toContainText('צואה');
  await expect(page.getByTestId('history-row')).toContainText('בדיקה');
  await expect(page.getByTestId('history-row')).toContainText('נערך');
  await expect.poll(async () => (await allServerRows(request)).find((e) => e.id === 'h-diaper')?.detail).toBe('poop');
  const row = (await allServerRows(request)).find((e) => e.id === 'h-diaper')!;
  expect(row.note).toBe('בדיקה');
  expect(row.edited).not.toBe('');
  expect(row.created).toBe(`${today} 00:02`); // unchanged by the edit
});

test('editing the time moves the event', async ({ page, request }) => {
  await install(page);
  await seedToday(request);
  await openHistory(page);
  await page.getByTestId('filter-feed').click();
  await page.getByTestId('history-row').click();
  await page.getByTestId('start-time').fill('00:00');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('history-row')).toContainText('00:00');
  await expect.poll(async () => (await allServerRows(request)).find((e) => e.id === 'h-feed')?.start).toBe(`${today} 00:00`);
});

test('deleting is soft and can be undone', async ({ page, request }) => {
  await install(page);
  await seedToday(request);
  await openHistory(page);
  await page.getByTestId('filter-feed').click();
  await page.getByTestId('history-row').click();
  await page.getByTestId('delete').click();
  await expect(page.getByTestId('history-row')).toHaveCount(0);
  await expect(page.getByTestId('toast-text')).toContainText('נמחק');
  await expect.poll(async () => (await allServerRows(request)).some((e) => e.id === 'h-feed')).toBe(false);
  await page.getByTestId('toast-undo').click();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await expect.poll(async () => (await allServerRows(request)).some((e) => e.id === 'h-feed')).toBe(true);
});

test('a deleted event no longer counts anywhere (home status)', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('btn-feed_left').click();
  await expect(page.getByTestId('tile-feed')).toContainText('שמאל');
  await page.getByTestId('recent-row').click();
  await page.getByTestId('delete').click();
  await expect(page.getByTestId('tile-feed')).toContainText('אין עדיין');
  await expect(page.getByTestId('btn-feed_left')).not.toHaveClass(/next/);
  void request;
});

test('marks entries that were added after the fact', async ({ page, request }) => {
  await install(page);
  await seed(request, [{ id: 'late', type: 'feed', detail: 'right', start: `${today} 00:01`, created: `${today} 00:50` }]);
  await openHistory(page);
  await expect(page.getByTestId('history-row')).toContainText('בדיעבד');
});

test('an open sleep is shown as still sleeping', async ({ page, request }) => {
  await install(page);
  await seed(request, [{ id: 'open', type: 'sleep', start: `${today} 00:01` }]);
  await openHistory(page);
  await expect(page.getByTestId('history-row')).toContainText('ישן עכשיו');
  void api;
});
