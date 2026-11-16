import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { allServerRows, api, install, resetServer } from './helpers';

// F7 stage 2: the Home button and tile follow the active medicines; several open a window where doses are marked.
test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const VIT = { id: 'vitamin_d', name: 'ויטמין D', icon: '☀️', schedule: 'daily' };
const setMeds = (request: APIRequestContext, meds: Record<string, unknown>[]) => api(request, { action: 'settings', set: { medicines: meds } });
const doses = async (request: APIRequestContext) =>
  (await allServerRows(request)).filter((e) => !e.deleted && (e.type === 'vitamin_d' || e.type === 'medicine')).map((e) => (e.type === 'vitamin_d' ? 'vitamin_d' : e.detail));
const row = (page: Page, id: string) => page.locator(`[data-testid="meds-row"][data-id="${id}"]`);

test('no active medicine: no medicine button and no medicine tile; the other buttons share the space', async ({ page, request }) => {
  await setMeds(request, [{ ...VIT, status: 'archived' }]);
  await install(page);
  await expect(page.getByTestId('btn-feed_left')).toBeVisible();
  await expect(page.locator('[data-testid^="btn-med"], [data-testid="btn-vitamin_d"]')).toHaveCount(0);
  await expect(page.getByTestId('tile-vitamin')).toHaveCount(0);
  await expect(page.locator('.tile')).toHaveCount(2);
});

test('one medicine other than vitamin D: its own icon and name, one tap logs it with undo', async ({ page, request }) => {
  await setMeds(request, [{ ...VIT, status: 'archived' }, { id: 'm1', name: 'ברזל', icon: '🍓', schedule: 'daily' }]);
  await install(page);
  const btn = page.getByTestId('btn-med');
  await expect(btn).toContainText('🍓');
  await expect(btn).toContainText('ברזל');
  await expect(page.getByTestId('tile-vitamin')).toContainText('ברזל');
  await expect(page.getByTestId('tile-vitamin')).toContainText('עדיין לא');
  await btn.click();
  await expect(page.getByTestId('toast-text')).toContainText('ברזל');
  await expect(page.getByTestId('tile-vitamin')).toContainText('ניתן היום');
  await expect.poll(() => doses(request)).toEqual(['m1']);
  await expect(page.getByTestId('recent-row').first()).toContainText('🍓');
  await expect(page.getByTestId('recent-row').first()).toContainText('ברזל');
  await page.getByTestId('toast-undo').click();
  await expect.poll(() => doses(request)).toEqual([]);
});

test('several medicines: their icons on "תרופות"; the window marks several, cancel takes them back', async ({ page, request }) => {
  await setMeds(request, [VIT, { id: 'm1', name: 'ברזל', icon: '🍓', schedule: 'daily', dose: '10', doseUnit: 'טיפות' }]);
  await install(page);
  await expect(page.getByTestId('btn-meds-icons')).toHaveText('☀️🍓');
  await expect(page.getByTestId('btn-meds')).toContainText('תרופות');
  await expect(page.getByTestId('tile-vitamin')).toContainText('חסר: ויטמין D');
  await expect(page.getByTestId('tile-vitamin')).toContainText('ועוד 1');
  await expect(page.getByTestId('tile-vitamin')).toHaveClass(/warn/);

  await page.getByTestId('btn-meds').click();
  await expect(page.getByTestId('meds-row')).toHaveCount(2);
  await expect(row(page, 'm1')).toContainText('ברזל · 10 טיפות');
  await expect(row(page, 'm1')).toContainText('עוד לא ניתן');
  await row(page, 'vitamin_d').click();
  await row(page, 'm1').click();
  await expect(row(page, 'vitamin_d').getByTestId('meds-status')).toContainText('✓ סומן עכשיו');
  await expect(row(page, 'm1').getByTestId('meds-status')).toContainText('ניתן היום');
  await expect.poll(async () => (await doses(request)).sort()).toEqual(['m1', 'vitamin_d']);
  await page.getByTestId('meds-cancel').click(); // changed our minds: take back everything marked in this window
  await expect(page.getByTestId('meds-window')).toBeHidden();
  await expect.poll(() => doses(request)).toEqual([]);

  await page.getByTestId('btn-meds').click();
  await expect(page.getByTestId('meds-cancel')).toBeDisabled();
  await row(page, 'vitamin_d').click();
  await row(page, 'm1').click();
  await page.getByTestId('meds-done').click();
  await expect(page.getByTestId('meds-window')).toBeHidden();
  await expect(page.getByTestId('tile-vitamin')).toContainText('הכל ניתן');
  await expect(page.getByTestId('tile-vitamin')).not.toHaveClass(/warn/);
  await expect.poll(async () => (await doses(request)).sort()).toEqual(['m1', 'vitamin_d']);
});

test('the window shows the next allowed time and closes when tapping outside', async ({ page, request }) => {
  await setMeds(request, [VIT, { id: 'm1', name: 'אנטיביוטיקה', icon: '🧸', schedule: 'interval', everyHours: 8, course: 'doses', courseCount: 14 }]);
  await install(page);
  await page.getByTestId('btn-meds').click();
  await row(page, 'm1').click();
  await expect(row(page, 'm1').getByTestId('meds-warning')).toContainText('הבאה מ-');
  await expect(row(page, 'm1').getByTestId('meds-status')).toContainText('מנה 1 מתוך 14');
  await page.getByTestId('meds-window').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('meds-window')).toBeHidden();
  await expect(page.getByTestId('tile-vitamin')).toContainText('חסר: ויטמין D'); // vitamin D still missing today
});

test('opening the window fetches what the other parent just gave', async ({ page, request }) => {
  await setMeds(request, [VIT, { id: 'm1', name: 'ברזל', icon: '🍓', schedule: 'daily' }]);
  await install(page);
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(0, 16);
  await api(request, { action: 'log', id: 'other-1', type: 'medicine', detail: 'm1', start: now, user: 'Parent Two', source: 'app' });
  await page.getByTestId('btn-meds').click();
  await expect(row(page, 'm1').getByTestId('meds-status')).toContainText('Parent Two', { timeout: 3000 }); // well before the 10 s poll
});

test('more than three medicines: one friendly icon on the button', async ({ page, request }) => {
  await setMeds(request, [VIT, ...['m1', 'm2', 'm3'].map((id, i) => ({ id, name: `ת${i}`, icon: '🍓', schedule: 'prn' }))]);
  await install(page);
  await expect(page.getByTestId('btn-meds-icons')).toHaveText('🧸');
});

for (const height of [852, 700, 560]) {
  test(`home with the medicines button and without it stays fixed with big buttons at height ${height}`, async ({ page, request }) => {
    await page.setViewportSize({ width: 393, height });
    await setMeds(request, [VIT, { id: 'm1', name: 'ברזל', icon: '🍓', schedule: 'daily' }]);
    await install(page);
    const sizes = async () =>
      page.evaluate(() => {
        const main = document.querySelector('.main')!;
        return {
          scrolls: main.scrollHeight > main.clientHeight + 1,
          minButton: Math.min(...[...document.querySelectorAll('.home .big')].map((b) => b.getBoundingClientRect().height)),
        };
      });
    let s = await sizes();
    expect(s.scrolls).toBe(false);
    expect(s.minButton).toBeGreaterThanOrEqual(56);
    await setMeds(request, [{ ...VIT, status: 'archived' }, { id: 'm1', name: 'ברזל', icon: '🍓', schedule: 'daily', status: 'archived' }]);
    await page.getByTestId('tab-settings').click(); // a tab change refreshes nothing by itself; the next poll or a resume does
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByTestId('tab-home').click();
    await expect(page.getByTestId('btn-meds')).toHaveCount(0);
    s = await sizes();
    expect(s.scrolls).toBe(false);
    expect(s.minButton).toBeGreaterThanOrEqual(56);
  });
}

// Owner: fixing a medicine's name or icon later must show in everything already logged (a dose stores the medicine's id only).
test('renaming a medicine or changing its icon shows in the recent list and in history for doses already given', async ({ page, request }) => {
  await setMeds(request, [{ ...VIT, status: 'archived' }, { id: 'm1', name: 'ברזלל', icon: '🍓', schedule: 'daily' }]);
  await install(page);
  await page.getByTestId('btn-med').click();
  await expect(page.getByTestId('recent-row').first()).toContainText('ברזלל');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('open-medicines').click();
  await page.locator('[data-testid="med-row"][data-id="m1"]').getByTestId('med-edit').click();
  await page.getByTestId('med-name').fill('ברזל');
  await page.getByTestId('med-icon-cheerful-1').click(); // 🧸
  await page.getByTestId('med-save').click();
  await page.getByTestId('tab-home').click();
  await expect(page.getByTestId('recent-row').first()).toContainText('🧸');
  await expect(page.getByTestId('recent-row').first()).toContainText('ברזל');
  await expect(page.getByTestId('recent-row').first()).not.toContainText('ברזלל');
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('history-row').first()).toContainText('🧸');
  await expect(page.getByTestId('history-row').first()).toContainText('ברזל');
  await expect(page.getByTestId('history-row').first()).not.toContainText('🍓');
});

// F7 stage 3 (owner): the window shows a highlighted line when the parents' limits say "not now", and tapping such a row asks first.
test('window: too early and daily maximum are highlighted; such a row asks before logging', async ({ page, request }) => {
  await setMeds(request, [VIT, { id: 'm1', name: 'אנטיביוטיקה', icon: '🧸', schedule: 'interval', everyHours: 8 }, { id: 'm2', name: 'אקמול', icon: '🍓', schedule: 'prn', maxPerDay: 1 }]);
  await install(page);
  await page.getByTestId('btn-meds').click();
  await expect(page.getByTestId('meds-warning')).toHaveCount(0); // nothing given yet: no warnings
  await row(page, 'm1').click();
  await row(page, 'm2').click();
  await expect(page.getByTestId('confirm-dose')).toHaveCount(0); // first doses need no confirmation
  await expect(row(page, 'm1').getByTestId('meds-warning')).toContainText('מוקדם מדי: הבאה מ-');
  await expect(row(page, 'm2').getByTestId('meds-warning')).toContainText('הגיע למקסימום היומי (1)');
  await expect(row(page, 'vitamin_d').getByTestId('meds-warning')).toHaveCount(0);

  await row(page, 'm1').click();
  await expect(page.getByTestId('confirm-warnings')).toContainText('מוקדם מדי');
  await page.getByTestId('confirm-no').click();
  await expect.poll(async () => (await doses(request)).filter((d) => d === 'm1').length).toBe(1);
  await row(page, 'm2').click();
  await page.getByTestId('confirm-yes').click();
  await expect.poll(async () => (await doses(request)).filter((d) => d === 'm2').length).toBe(2);
  await expect(row(page, 'm2').getByTestId('meds-status')).toContainText('✓ סומן עכשיו ×2');
  // cancelling the window takes back everything marked in it, including the confirmed one
  await page.getByTestId('meds-cancel').click();
  await expect.poll(() => doses(request)).toEqual([]);
});

test('a single medicine button asks first when its period is over', async ({ page, request }) => {
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(0, 10);
  await setMeds(request, [{ ...VIT, status: 'archived' }, { id: 'm1', name: 'סירופ', icon: '🍓', schedule: 'prn', course: 'until', courseUntil: yesterday }]);
  await install(page);
  await page.getByTestId('btn-med').click();
  await expect(page.getByTestId('confirm-warnings')).toContainText('משך מתן התרופה הסתיים');
  await page.getByTestId('confirm-yes').click();
  await expect.poll(() => doses(request)).toEqual(['m1']);
});
