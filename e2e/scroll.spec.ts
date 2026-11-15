import { type Page, expect, test } from '@playwright/test';
import type { BabyEvent } from '../src/shared/types';
import { install, resetServer, seed, todayLocal } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const today = todayLocal();
const events = (n: number): Partial<BabyEvent>[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, type: 'diaper' as const, detail: 'wet', start: `${today} 00:${String(i).padStart(2, '0')}` }));

/** A finger drag: raw touch events through the browser's own input pipeline (the same path as a real touch). */
async function drag(page: Page, x: number, y: number, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const steps = 12;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(450);
}

const state = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('.main') as HTMLElement;
    const list = document.querySelector('.recent') as HTMLElement | null;
    const tabs = document.querySelector('.tabs')!.getBoundingClientRect();
    const firstTile = document.querySelector('.tile')?.getBoundingClientRect();
    return {
      docScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
      winScrollY: window.scrollY,
      mainScrollTop: main.scrollTop,
      mainOverflow: main.scrollHeight - main.clientHeight,
      listScrollTop: list?.scrollTop ?? -1,
      listOverflow: list ? list.scrollHeight - list.clientHeight : -1,
      tabsBottom: tabs.bottom,
      tabsTop: tabs.top,
      innerHeight: window.innerHeight,
      firstTileTop: firstTile?.top ?? -1,
    };
  });

for (const height of [852, 700, 560]) {
  test.describe(`phone height ${height}`, () => {
    test.use({ viewport: { width: 393, height } });

    test('home is a fixed screen: dragging anywhere on it moves nothing', async ({ page, request }) => {
      await seed(request, events(3));
      await install(page);
      const before = await state(page);
      expect(before.docScrolls).toBe(false);
      expect(before.tabsBottom).toBeLessThanOrEqual(before.innerHeight + 1);
      expect(before.mainOverflow, 'the home container must not be scrollable').toBeLessThanOrEqual(1);

      // drag over the status tiles, the buttons and the empty areas, up and down
      for (const [x, y, dy] of [[200, 80, -300], [200, 300, -300], [200, 300, 300], [100, height - 160, -200]] as const) {
        await drag(page, x, Math.min(y, height - 120), dy);
        const s = await state(page);
        expect(s.mainScrollTop, `main scrolled after drag at y=${y}`).toBe(0);
        expect(s.winScrollY).toBe(0);
        expect(s.firstTileTop).toBe(before.firstTileTop);
        expect(s.tabsTop).toBe(before.tabsTop);
      }
    });

    test('home: every button keeps a usable size and still works', async ({ page }) => {
      await install(page);
      for (const id of ['btn-feed_left', 'btn-feed_right', 'btn-wet', 'btn-poop', 'btn-both', 'btn-sleep', 'btn-vitamin_d']) {
        const b = await page.getByTestId(id).boundingBox();
        expect(b!.height, id).toBeGreaterThanOrEqual(56);
        expect(b!.y + b!.height, `${id} must be above the tab bar`).toBeLessThanOrEqual((await state(page)).tabsTop);
      }
      await page.getByTestId('btn-wet').click();
      await expect(page.getByTestId('toast-text')).toContainText('נשמר: חיתול רטוב');
      await expect(page.getByTestId('recent-row')).toHaveCount(1);
    });

    test('home: the recent list holds the last 10 events and scrolls by touch', async ({ page, request }) => {
      await seed(request, events(14));
      await install(page);
      await expect(page.getByTestId('recent-row')).toHaveCount(10);
      const s0 = await state(page);
      expect(s0.listOverflow, 'the list must have something to scroll').toBeGreaterThan(20);
      const box = (await page.locator('.recent').boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(s0.tabsTop + 1);

      await drag(page, 200, box.y + box.height / 2, -150);
      const s1 = await state(page);
      expect(s1.listScrollTop, 'the list should move').toBeGreaterThan(20);
      expect(s1.mainScrollTop, 'the page must not move with it').toBe(0);
      expect(s1.firstTileTop).toBe(s0.firstTileTop);

      await page.getByTestId('recent-row').last().scrollIntoViewIfNeeded();
      const last = (await page.getByTestId('recent-row').last().boundingBox())!;
      expect(last.y + last.height).toBeLessThanOrEqual(s0.tabsTop + 1);
    });
  });
}

test('settings still scroll by touch, and the scroll position does not leak into other tabs', async ({ page }) => {
  await install(page);
  await page.getByTestId('tab-settings').click();
  const before = await state(page);
  expect(before.mainOverflow).toBeGreaterThan(50);
  await drag(page, 200, 400, -300);
  expect((await state(page)).mainScrollTop).toBeGreaterThan(50);
  await page.getByTestId('tab-home').click();
  const home = await state(page);
  expect(home.mainScrollTop).toBe(0);
  await page.getByTestId('tab-settings').click();
  expect((await state(page)).mainScrollTop).toBe(0); // a fresh tab starts at the top
});

test('history: a long list scrolls to its last row', async ({ page, request }) => {
  await seed(request, events(40));
  await install(page);
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('history-row')).toHaveCount(40);
  await drag(page, 200, 500, -600);
  expect((await state(page)).mainScrollTop).toBeGreaterThan(100);
  await page.getByTestId('history-row').last().scrollIntoViewIfNeeded();
  const box = (await page.getByTestId('history-row').last().boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual((await state(page)).tabsTop + 1);
  expect((await state(page)).docScrolls).toBe(false);
});

test('scrolling the form does not move the page behind it', async ({ page }) => {
  await install(page);
  await page.getByTestId('add-late').click();
  await expect(page.getByTestId('event-form')).toBeVisible();
  const before = await state(page);
  await page.getByTestId('save').scrollIntoViewIfNeeded();
  const after = await state(page);
  expect(after.mainScrollTop).toBe(before.mainScrollTop);
  expect(after.firstTileTop).toBe(before.firstTileTop);
});
