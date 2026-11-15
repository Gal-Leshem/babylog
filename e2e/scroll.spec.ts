import { expect, test } from '@playwright/test';
import type { BabyEvent } from '../src/shared/types';
import { install, resetServer, seed, todayLocal } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const today = todayLocal();
const three: Partial<BabyEvent>[] = [
  { id: 's1', type: 'diaper', detail: 'wet', start: `${today} 00:01` },
  { id: 's2', type: 'diaper', detail: 'poop', start: `${today} 00:02` },
  { id: 's3', type: 'feed', detail: 'left', start: `${today} 00:03` },
];

async function layout(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const tabs = document.querySelector('.tabs')!.getBoundingClientRect();
    const main = document.querySelector('.main') as HTMLElement;
    return {
      docScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
      tabsBottomVisible: tabs.bottom <= window.innerHeight + 1,
      mainScrollable: main.scrollHeight > main.clientHeight + 1,
    };
  });
}

for (const height of [852, 700, 560]) {
  test.describe(`phone height ${height}`, () => {
    test.use({ viewport: { width: 393, height } });

    test('home: the tab bar is always on screen and the recent list can be reached', async ({ page, request }) => {
      await seed(request, three);
      await install(page);
      await expect(page.getByTestId('recent-row')).toHaveCount(3);
      const l = await layout(page);
      expect(l.docScrolls, 'the whole page must not scroll').toBe(false);
      expect(l.tabsBottomVisible).toBe(true);

      const last = page.getByTestId('recent-row').last();
      await last.scrollIntoViewIfNeeded();
      const box = await last.boundingBox();
      const tabs = await page.locator('.tabs').boundingBox();
      expect(box!.y + box!.height, 'last recent row must end above the tab bar').toBeLessThanOrEqual(tabs!.y + 1);
      expect(box!.y).toBeGreaterThanOrEqual(0);
    });

    test('home: buttons keep a usable size', async ({ page }) => {
      await install(page);
      for (const id of ['btn-feed_left', 'btn-wet', 'btn-sleep', 'btn-vitamin_d']) {
        const b = await page.getByTestId(id).boundingBox();
        expect(b!.height, id).toBeGreaterThanOrEqual(56);
      }
    });
  });
}

test('history: a long list scrolls to its last row', async ({ page, request }) => {
  const many: Partial<BabyEvent>[] = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, type: 'diaper' as const, detail: 'wet', start: `${today} 00:${String(i).padStart(2, '0')}` }));
  await seed(request, many);
  await install(page);
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('history-row')).toHaveCount(40);
  const first = page.getByTestId('history-row').last();
  await first.scrollIntoViewIfNeeded();
  const box = await first.boundingBox();
  const tabs = await page.locator('.tabs').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(tabs!.y + 1);
  expect((await layout(page)).docScrolls).toBe(false);
});

test('scrolling the form does not move the page behind it', async ({ page }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await expect(page.getByTestId('event-form')).toBeVisible();
  const before = await page.evaluate(() => (document.querySelector('.main') as HTMLElement).scrollTop);
  await page.getByTestId('save').scrollIntoViewIfNeeded();
  const after = await page.evaluate(() => (document.querySelector('.main') as HTMLElement).scrollTop);
  expect(after).toBe(before);
});
