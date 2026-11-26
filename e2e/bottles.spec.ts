import { type APIRequestContext, expect, test } from '@playwright/test';
import { api, install, nowLocal, resetServer, seed, serverEvents } from './helpers';

// F18 (owner): bottles of expressed milk and formula, next to breastfeeding or instead of it.

const FEEDING = { breast: true, expressed: false, formula: false, expressedMl: 60, formulaMl: 90 };
async function feeding(request: APIRequestContext, f: Partial<typeof FEEDING>): Promise<void> {
  await resetServer(request);
  await api(request, { action: 'settings', set: { feeding: { ...FEEDING, ...f } } });
}
const bottles = async (request: APIRequestContext) => (await serverEvents(request)).filter((e) => e.type === 'bottle');

test('families that only breastfeed see no change: two nursing buttons, no bottle anywhere', async ({ page, request }) => {
  await resetServer(request);
  await install(page);
  await expect(page.locator('.feedrow .big')).toHaveCount(2);
  await expect(page.getByTestId('btn-bottle')).toHaveCount(0);
  await page.getByTestId('add-late').click();
  await expect(page.getByTestId('kind-bottle_formula')).toHaveCount(0);
});

test('Settings: turning on formula adds "בקבוק" beside the nursing buttons; one tap logs the default amount, the toast changes it', async ({ page, request }) => {
  await resetServer(request);
  await install(page);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('feeding-formula').click();
  await expect(page.getByTestId('feeding-formula')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('default-ml-formula-plus').click();
  await expect(page.getByTestId('default-ml-formula-value')).toHaveText('100 מ״ל');
  await page.getByTestId('tab-home').click();
  await expect(page.locator('.feedrow .big')).toHaveCount(3);
  await page.getByTestId('btn-bottle').click();
  await expect(page.getByTestId('toast-text')).toContainText('בקבוק תמ״ל · 100 מ״ל');
  await expect(page.getByTestId('toast-ml')).toHaveText('100 מ״ל');
  await page.getByTestId('toast-ml-plus-20').click();
  await page.getByTestId('toast-ml-minus-10').click();
  await expect(page.getByTestId('toast-ml')).toHaveText('110 מ״ל');
  await expect(page.getByTestId('toast-text')).toContainText('110 מ״ל');
  // (owner) it stays while it is used: longer than the moment after other toast buttons, and "היה לפני" still works
  await page.waitForTimeout(1_500);
  await page.getByTestId('toast-back-10').click();
  await page.waitForTimeout(1_500); // the other toasts go a moment after a tap (TOAST_DONE_MS)
  await expect(page.getByTestId('toast')).not.toHaveAttribute('data-gone', '1');
  await page.getByTestId('toast-ml-plus-10').click();
  await page.getByTestId('toast-ml-minus-10').click();
  await expect.poll(async () => (await bottles(request)).map((e) => e.detail)).toEqual(['formula:110']);
  await expect(page.getByTestId('recent-row').first()).toContainText('בקבוק תמ״ל · 110 מ״ל');
  // the next bottle starts from the default again, not from the last one
  await expect(page.getByTestId('toast')).toBeHidden({ timeout: 8_000 });
  await page.getByTestId('btn-bottle').click();
  await expect(page.getByTestId('toast-ml')).toHaveText('100 מ״ל');
});

test('"בטל" in the bottle toast takes back the bottle with its amount changes', async ({ page, request }) => {
  await feeding(request, { formula: true });
  await install(page);
  await page.getByTestId('btn-bottle').click();
  await page.getByTestId('toast-ml-plus-10').click();
  await page.getByTestId('toast-undo').click();
  await expect.poll(async () => (await bottles(request)).length).toBe(0);
  await expect(page.getByTestId('recent-row')).toHaveCount(0);
});

test('nursing and both bottle kinds: "בקבוק" opens the window; the kind picked last is chosen next time', async ({ page, request }) => {
  await feeding(request, { expressed: true, formula: true });
  await install(page);
  await page.getByTestId('btn-bottle').click();
  const win = page.getByTestId('bottle-window');
  await expect(win).toBeVisible();
  await page.getByTestId('bottle-kind-expressed').click();
  await expect(page.getByTestId('bottle-ml-value')).toHaveText('60 מ״ל');
  await expect(page.getByTestId('bottle-default')).toContainText('ברירת המחדל לחלב שאוב: 60 מ״ל');
  await page.getByTestId('bottle-ml-plus').click();
  await page.getByTestId('bottle-log').click();
  await expect(win).toBeHidden();
  await expect(page.getByTestId('toast-text')).toContainText('בקבוק חלב שאוב · 70 מ״ל');
  await expect.poll(async () => (await bottles(request)).map((e) => e.detail)).toEqual(['expressed:70']);
  // the tile: the last feeding was a bottle; the next side still comes from nursing
  await expect(page.getByTestId('tile-feed')).toContainText('· 🍼');
  await expect(page.getByTestId('tile-feed-sub')).toHaveText('אין עדיין'); // the next side comes from nursing only: none yet
  await page.getByTestId('btn-bottle').click();
  await expect(page.getByTestId('bottle-kind-expressed')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('bottle-ml-120').click();
  await expect(page.getByTestId('bottle-ml-value')).toHaveText('120 מ״ל');
  await page.getByTestId('bottle-cancel').click();
  await expect.poll(async () => (await bottles(request)).length).toBe(1);
});

test('bottles without nursing: a button per kind in place of the nursing buttons, and the tile shows the last bottle', async ({ page, request }) => {
  await feeding(request, { breast: false, formula: true });
  await install(page);
  await expect(page.getByTestId('btn-feed_left')).toHaveCount(0);
  await expect(page.locator('.feedrow .big')).toHaveCount(1);
  await page.getByTestId('btn-bottle_formula').click();
  await expect.poll(async () => (await bottles(request)).map((e) => e.detail)).toEqual(['formula:90']);
  await expect(page.getByTestId('tile-feed-sub')).toHaveText('בקבוק תמ״ל · 90 מ״ל');
  await expect(page.getByTestId('tile-feed')).not.toContainText('הבאה');
});

test('the edit form: given and left with − / + (left from 0), eaten worked out; saved in the entry', async ({ page, request }) => {
  await feeding(request, { formula: true });
  await seed(request, [{ type: 'bottle', detail: 'formula:120', start: nowLocal(-30) }]);
  await install(page);
  await page.getByTestId('recent-row').first().click();
  await expect(page.getByTestId('given-value')).toHaveText('120 מ״ל');
  await expect(page.getByTestId('left-value')).toHaveText('0 מ״ל');
  await expect(page.getByTestId('left-minus')).toBeDisabled();
  for (let i = 0; i < 3; i++) await page.getByTestId('left-plus').click();
  await expect(page.getByTestId('eaten')).toHaveText('נאכל: 90 מ״ל');
  await page.getByTestId('save').click();
  await expect.poll(async () => (await bottles(request)).map((e) => e.detail)).toEqual(['formula:120:30']);
  // the list shows what was eaten (short: one line)
  await expect(page.getByTestId('recent-row').first()).toContainText('בקבוק תמ״ל · 90 מ״ל');
  // the leftover can never be more than what was given
  await page.getByTestId('recent-row').first().click();
  for (let i = 0; i < 10; i++) await page.getByTestId('given-minus').click();
  await expect(page.getByTestId('given-value')).toHaveText('20 מ״ל');
  await expect(page.getByTestId('left-value')).toHaveText('20 מ״ל');
  await expect(page.getByTestId('left-plus')).toBeDisabled();
  await expect(page.getByTestId('eaten')).toHaveText('נאכל: 0 מ״ל');
});

test('adding a bottle after the fact starts from the default of its kind', async ({ page, request }) => {
  await feeding(request, { expressed: true });
  await install(page);
  await page.getByTestId('add-late').click();
  await page.getByTestId('kind-bottle_expressed').click();
  await expect(page.getByTestId('given-value')).toHaveText('60 מ״ל');
  await page.getByTestId('back-30').click();
  await page.getByTestId('save').click();
  await expect.poll(async () => (await bottles(request)).map((e) => e.detail)).toEqual(['expressed:60']);
  await expect(page.getByTestId('kind-bottle_formula')).toHaveCount(0);
});

// (owner) three buttons in the feed row: the icon stays above the label and every label stays on one line, on every phone size
for (const [width, height] of [[393, 852], [393, 700], [393, 560], [375, 667], [375, 560], [360, 560]] as const) {
  test(`three in the feed row: labels on one line, icon above, nothing scrolls (${width}x${height})`, async ({ page, request }) => {
    await feeding(request, { formula: true });
    await seed(request, Array.from({ length: 10 }, (_, i) => ({ type: 'diaper', detail: 'wet', start: nowLocal(-20 - i * 10) })));
    await page.setViewportSize({ width, height });
    await install(page);
    await expect(page.getByTestId('recent-row').first()).toBeVisible();
    await check(page);
    // after a bottle the feed tile says "🍼": it must not grow and squeeze the buttons
    await page.getByTestId('btn-bottle').click();
    await expect(page.getByTestId('tile-feed')).toContainText('לפני 0:00');
    await check(page);
  });
}

async function check(page: import('@playwright/test').Page): Promise<void> {
    for (const id of ['btn-feed_left', 'btn-feed_right', 'btn-bottle']) {
      const b = page.getByTestId(id);
      const box = (await b.boundingBox())!;
      expect(box.height, `${id} is big enough`).toBeGreaterThanOrEqual(56);
      const m = await b.evaluate((el) => {
        const ico = el.querySelector('.ico')!.getBoundingClientRect();
        const lbl = el.querySelector('.lbl')! as HTMLElement;
        const r = lbl.getBoundingClientRect();
        const line = parseFloat(getComputedStyle(lbl).lineHeight) || parseFloat(getComputedStyle(lbl).fontSize) * 1.3;
        const btn = el.getBoundingClientRect();
        return { above: ico.bottom <= r.top + 1, oneLine: r.height < line * 1.5, inside: r.left >= btn.left - 0.5 && r.right <= btn.right + 0.5 && r.bottom <= btn.bottom + 0.5 };
      });
      expect(m, id).toEqual({ above: true, oneLine: true, inside: true });
    }
    const scrolls = await page.evaluate(() => {
      const main = document.querySelector('.main')!;
      return main.scrollHeight > main.clientHeight + 1 || document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(scrolls).toBe(false);
    const tile = await page.getByTestId('tile-feed').locator('.tv').evaluate((el) => el.getBoundingClientRect().height < parseFloat(getComputedStyle(el).fontSize) * 2);
    expect(tile, 'the feed tile value stays on one line').toBe(true);
}
