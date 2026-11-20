import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatLocal, parseLocal } from '../src/shared/tz';
import { allServerRows, api, install, pinPageDay, resetServer } from './helpers';

// F7 stage 2: the Home button and tile follow the active medicines; several open a window where doses are marked.
test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const VIT = { id: 'vitamin_d', name: 'ויטמין D', icon: '☀️', schedule: 'daily' };
const setMeds = (request: APIRequestContext, meds: Record<string, unknown>[]) => api(request, { action: 'settings', set: { medicines: meds } });
const doses = async (request: APIRequestContext) =>
  (await allServerRows(request)).filter((e) => !e.deleted && (e.type === 'vitamin_d' || e.type === 'medicine')).map((e) => (e.type === 'vitamin_d' ? 'vitamin_d' : e.detail));
const row = (page: Page, id: string) => page.locator(`[data-testid="meds-row"][data-id="${id}"]`);
/** A time today, a minute before now (as the server sees it). */
const doseTime = async (request: APIRequestContext) => {
  const now = (await api(request, { action: 'ping' })).serverNow as string;
  return formatLocal(parseLocal(now) - 60_000);
};

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

// Owner: when everything due today is given, the button says so from inside (dashed and quiet, a ✓ instead of the icon);
// it still works as before (a second dose asks first).
test('vitamin D given today: the button turns quiet with a ✓ and the time; a second tap still asks first', async ({ page }) => {
  await install(page);
  const btn = page.getByTestId('btn-vitamin_d');
  await expect(btn).not.toHaveAttribute('data-done', '1');
  await expect(btn.locator('.ico')).toHaveText('☀️');
  const before = await btn.evaluate((b) => getComputedStyle(b).borderStyle);
  await btn.click();
  await expect(btn).toHaveAttribute('data-done', '1');
  await expect(btn.locator('.ico')).toHaveCount(0);
  await expect(btn.locator('.lbl')).toHaveText('✓ ויטמין D');
  await expect(page.getByTestId('btn-meds-sub')).toHaveText(/^ניתן היום \d\d:\d\d$/);
  await expect(btn).not.toHaveClass(/\bflash\b/, { timeout: 3000 }); // the tap's own flash is over
  await expect.poll(() => btn.evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgba(0, 0, 0, 0)'); // (after the colour transition)
  const look = await btn.evaluate((b) => ({ border: getComputedStyle(b).borderStyle, bg: getComputedStyle(b).backgroundColor }));
  expect([before, look.border, look.bg]).toEqual(['solid', 'dashed', 'rgba(0, 0, 0, 0)']);
  await expect(btn).toBeEnabled({ timeout: 3000 });
  await btn.click();
  await expect(page.getByTestId('confirm-dose')).toBeVisible(); // works as before: a second dose today asks first
});

for (const height of [852, 700, 560]) {
  test(`the quiet "given today" button keeps its words inside and stays big at height ${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 393, height });
    await install(page);
    await page.getByTestId('btn-vitamin_d').click();
    await expect(page.getByTestId('btn-vitamin_d')).toHaveAttribute('data-done', '1');
    const fit = await page.getByTestId('btn-vitamin_d').evaluate((b) => {
      const r = b.getBoundingClientRect();
      const parts = [...b.querySelectorAll('.lbl, .sub')].map((x) => x.getBoundingClientRect());
      return { h: r.height, inside: parts.every((p) => p.top >= r.top + 2 && p.bottom <= r.bottom - 2), scroll: document.querySelector('.main')!.scrollHeight <= document.querySelector('.main')!.clientHeight };
    });
    expect(fit.h).toBeGreaterThanOrEqual(56);
    expect(fit.inside, 'the name and the time stay inside the button').toBe(true);
    expect(fit.scroll, 'Home does not scroll').toBe(true);
  });
}

test('several medicines: the button turns quiet only when every medicine with a daily amount is given (as needed ones do not count)', async ({ page, request }) => {
  await setMeds(request, [VIT, { id: 'm1', name: 'בפנטן', icon: '🍓', schedule: 'times', timesPerDay: 2 }, { id: 'm2', name: 'אקמול', icon: '🧸', schedule: 'prn' }]);
  await install(page);
  const btn = page.getByTestId('btn-meds');
  await btn.click();
  await row(page, 'vitamin_d').click();
  await row(page, 'm1').click();
  await page.getByTestId('meds-done').click();
  await expect(btn).not.toHaveAttribute('data-done', '1'); // בפנטן: one of two
  // (owner) a medicine done for today fades on the button and shows a ✓ instead of its icon in the window; the title stays
  await expect(btn.locator('.ico')).toHaveText('☀️🍓🧸');
  const fade = await btn.locator('.ico > span').evaluateAll((xs) => xs.map((x) => [getComputedStyle(x).opacity, getComputedStyle(x).filter]));
  expect(fade).toEqual([['0.3', 'grayscale(1)'], ['1', 'none'], ['1', 'none']]); // (owner) vitamin D given today: faded and grey
  await expect(btn.locator('.lbl')).toHaveText('תרופות');
  await btn.click();
  await expect(row(page, 'vitamin_d').getByTestId('meds-done-mark')).toHaveText('✓');
  await expect(row(page, 'm1').getByTestId('meds-done-mark')).toHaveCount(0);
  await expect(row(page, 'm1').locator('.mi')).toHaveText('🍓');
  await expect(row(page, 'm2').locator('.mi')).toHaveText('🧸'); // as needed: never "done"
  await page.getByTestId('meds-done').click();
  await api(request, { action: 'log', id: 'b2', type: 'medicine', detail: 'm1', start: (await doseTime(request)), user: 'Parent Two', source: 'app' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(btn).toHaveAttribute('data-done', '1');
  await expect(btn.locator('.ico')).toHaveCount(0);
  await expect(btn.locator('.lbl')).toHaveText('✓ תרופות');
  await expect(page.getByTestId('btn-meds-sub')).toHaveText('הכל ניתן היום');
  await btn.click();
  await expect(page.getByTestId('meds-window')).toBeVisible(); // still opens the window
});

test('the window shows the next allowed time and closes when tapping outside', async ({ page, request }) => {
  await setMeds(request, [VIT, { id: 'm1', name: 'אנטיביוטיקה', icon: '🧸', schedule: 'interval', everyHours: 8, course: 'doses', courseCount: 14 }]);
  await install(page);
  await page.getByTestId('btn-meds').click();
  await row(page, 'm1').click();
  await expect(row(page, 'm1').getByTestId('meds-warning')).toContainText('הבאה מ-');
  await expect(row(page, 'm1').getByTestId('meds-status')).toContainText('מנה 1 מתוך 14');
  await expect(row(page, 'm1').getByTestId('meds-status')).toContainText('היום 1 מתוך 3'); // every 8 hours: 3 a day
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
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
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

// F7 stage 4: medicines in the add/edit form and in the daily summary.
test('add after the fact: a medicine is its own choice; no confirmation for something that already happened', async ({ page, request }) => {
  await setMeds(request, [VIT, { id: 'm1', name: 'ברזל', icon: '🍓', schedule: 'daily' }, { id: 'm2', name: 'ישן', icon: '🍋', schedule: 'daily', status: 'archived' }]);
  await install(page);
  await page.getByTestId('btn-meds').click();
  await row(page, 'm1').click(); // given today already
  await page.getByTestId('meds-done').click();
  await page.getByTestId('add-late').click();
  await expect(page.getByTestId('kind-vitamin_d')).toContainText('ויטמין D');
  await expect(page.getByTestId('kind-med-m2')).toHaveCount(0); // archived medicines are not offered for new entries
  await page.getByTestId('kind-med-m1').click();
  await page.getByTestId('back-30').click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('confirm-dose')).toHaveCount(0);
  await expect(page.getByTestId('toast-text')).toContainText('נוסף: ברזל');
  await expect.poll(() => doses(request)).toEqual(['m1', 'm1']);
});

test('edit: a vitamin D entry can become another medicine and back; an archived medicine stays choosable for its own entries', async ({ page, request }) => {
  await setMeds(request, [VIT, { id: 'm1', name: 'ברזל', icon: '🍓', schedule: 'daily' }]);
  await install(page);
  await page.getByTestId('btn-meds').click();
  await row(page, 'vitamin_d').click();
  await page.getByTestId('meds-done').click();
  await page.getByTestId('recent-row').first().click();
  await expect(page.getByTestId('kind-vitamin_d')).toHaveClass(/\bon\b/);
  await page.getByTestId('kind-med-m1').click();
  await page.getByTestId('save').click();
  await expect.poll(() => doses(request)).toEqual(['m1']);
  await setMeds(request, [{ id: 'm1', name: 'ברזל', icon: '🍓', schedule: 'daily', status: 'archived' }]);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('btn-vitamin_d')).toBeVisible(); // only vitamin D is active now
  await page.getByTestId('recent-row').first().click();
  await expect(page.getByTestId('kind-med-m1')).toHaveClass(/\bon\b/);
  await page.getByTestId('kind-vitamin_d').click();
  await page.getByTestId('save').click();
  await expect.poll(() => doses(request)).toEqual(['vitamin_d']);
});

test('daily summary: a row per medicine; once a day says given or not, others count; an archived one shows only on days it was given', async ({ page, request }) => {
  const today = await pinPageDay(page); // (a day whose 00:01 is past: see pinPageDay)
  await setMeds(request, [
    VIT,
    { id: 'm1', name: 'אקמול', icon: '🍓', schedule: 'prn' },
    { id: 'm2', name: 'ברזל', icon: '🍋', schedule: 'daily', status: 'archived' },
    { id: 'm3', name: 'סירופ', icon: '🌸', schedule: 'daily', status: 'archived' },
  ]);
  await api(request, { action: 'log', id: 'p1', type: 'medicine', detail: 'm1', start: `${today} 00:01`, user: 'Parent Two', source: 'app' });
  await api(request, { action: 'log', id: 'p2', type: 'medicine', detail: 'm1', start: `${today} 00:02`, user: 'Parent Two', source: 'app' });
  await api(request, { action: 'log', id: 'p3', type: 'medicine', detail: 'm2', start: `${today} 00:03`, user: 'Parent Two', source: 'app' });
  await install(page);
  await page.getByTestId('tab-summary').click();
  const cell = (row: string, col: number) => page.getByTestId(`sum-${row}`).locator('td').nth(col);
  await expect(cell('ויטמין D', 0)).toHaveText('לא ניתן');
  await expect(cell('אקמול', 0)).toHaveText('2');
  await expect(cell('אקמול', 1)).toHaveText('0');
  await expect(cell('ברזל', 0)).toHaveText('ניתן'); // archived, but given today
  await expect(page.getByTestId('sum-סירופ')).toHaveCount(0); // archived and not given on these days
  await expect(page.getByTestId('sum-אקמול').locator('th')).toContainText('🍓');
});
