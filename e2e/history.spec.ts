import { expect, test } from '@playwright/test';
import { addDaysLocal, allServerRows, api, install, nowLocal, resetServer, seed, todayLocal } from './helpers';

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
  await expect(page.getByTestId('history-row')).toContainText('פיפי');
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
  await expect(page.getByTestId('history-row')).toContainText('קקי');
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
  await expect(page.getByTestId('history-row')).toContainText('קקי');
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

// Owner screenshot: a sleep's time range ("17:30–18:23") wrapped onto two lines in the 92px time column and stretched the row.
// The time column fits a range on one line, centred, like the icons; a sleep row is no taller than a feed row.
test('history: a sleep time range stays on one line, centred, and its row is as tall as the others', async ({ page, request }) => {
  const d = todayLocal();
  await seed(request, [
    { type: 'sleep', start: `${d} 00:10`, end: `${d} 00:53` },
    { type: 'feed', detail: 'right', start: `${d} 00:55` },
  ]);
  await install(page);
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('history-row')).toHaveCount(2);
  const m = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="history-row"]')].map((row) => {
      const cell = row.querySelector('.ht')!;
      const r = document.createRange();
      r.selectNodeContents(cell);
      const text = r.getBoundingClientRect();
      const box = cell.getBoundingClientRect();
      return { rowH: row.getBoundingClientRect().height, textH: text.height, off: Math.abs(text.left + text.width / 2 - (box.left + box.width / 2)), t: cell.textContent };
    }),
  );
  const sleep = m.find((x) => x.t!.includes('–'))!;
  const feed = m.find((x) => !x.t!.includes('–'))!;
  expect(sleep.textH).toBeLessThan(30); // one line
  expect(Math.abs(sleep.rowH - feed.rowH)).toBeLessThan(1);
  for (const x of m) expect(x.off).toBeLessThan(2); // centred
});

// Owner feedback #1: in History, the last 24 hours across midnight besides day by day.
test('history: "24 שעות אחרונות" shows exactly the last 24 hours with the day where it changes, and is remembered', async ({ page, request }) => {
  const at = (minsAgo: number) => nowLocal(-minsAgo);
  await seed(request, [
    { id: 'h1', type: 'feed', detail: 'left', start: at(60) },
    { id: 'h20', type: 'diaper', detail: 'wet', start: at(20 * 60) },
    { id: 'h30', type: 'diaper', detail: 'poop', start: at(30 * 60) }, // more than a day ago: not in it
  ]);
  await install(page);
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('hview-day')).toHaveAttribute('aria-selected', 'true'); // day by day stays the default
  await page.getByTestId('hview-last24').click();
  await expect(page.getByTestId('daynav')).toHaveCount(0);
  await expect(page.getByTestId('history-since')).toContainText('עד עכשיו');
  await expect(page.getByTestId('history-row')).toHaveCount(2);
  await expect(page.getByTestId('history-row').first()).toContainText(at(60).slice(11));
  await expect(page.getByTestId('history-row').nth(1)).toContainText(at(20 * 60).slice(11));
  const name = (d: string) => (d === todayLocal() ? 'היום' : 'אתמול');
  const days = [...new Set([at(60), at(20 * 60)].map((t) => name(t.slice(0, 10))))];
  await expect(page.getByTestId('history-day')).toHaveText(days);
  await page.getByTestId('filter-diaper').click(); // the kind filter still works
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await page.reload();
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('hview-last24')).toHaveAttribute('aria-selected', 'true'); // remembered on this phone
  await page.getByTestId('hview-day').click();
  await expect(page.getByTestId('daynav')).toBeVisible();
  await expect(page.getByTestId('history-day')).toHaveCount(0);
});
