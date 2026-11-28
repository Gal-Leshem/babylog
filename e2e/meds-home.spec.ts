import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatLocal, parseLocal } from '../src/shared/tz';
import { allServerRows, api, install, pinPageDay, resetServer, seed } from './helpers';

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
  // (owner bug) drawn above the tab bar: not inside a tab's scrolling area (iOS keeps anything inside it under the tab bar)
  await expect(page.locator('.main [data-testid="confirm-dose"]')).toHaveCount(0);
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
  // the page's day is pinned: a run that crossed midnight saw today's doses become yesterday's (failed in CI at 00:00)
  const day = await pinPageDay(page);
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
  await api(request, { action: 'log', id: 'b2', type: 'medicine', detail: 'm1', start: `${day} 11:59`, user: 'Parent Two', source: 'app' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(btn).toHaveAttribute('data-done', '1');
  await expect(btn.locator('.ico')).toHaveCount(0);
  await expect(btn.locator('.lbl')).toHaveText('✓ תרופות');
  await expect(page.getByTestId('btn-meds-sub')).toHaveText('הכל ניתן היום');
  await btn.click();
  await expect(page.getByTestId('meds-window')).toBeVisible(); // still opens the window
});

// Owner: after marking a medicine in the window, the same "it was earlier" and undo as the toast after a tap, in its own row.
test('window: a marked medicine can be moved earlier or taken back from its row; the window stays open for the others', async ({ page, request }) => {
  await setMeds(request, [VIT, { id: 'm1', name: 'בפנטן', icon: '🍓', schedule: 'daily' }]);
  await install(page);
  await page.getByTestId('btn-meds').click();
  await expect(row(page, 'vitamin_d').locator('..').getByTestId('meds-earlier')).toHaveCount(0);
  await row(page, 'vitamin_d').click();
  const line = row(page, 'vitamin_d').locator('..').getByTestId('meds-earlier');
  await expect(line).toBeVisible();
  await expect(line.locator('button')).toHaveText(['5', '10', '15', '30', 'בטל']);
  await expect(row(page, 'm1').locator('..').getByTestId('meds-earlier')).toHaveCount(0); // only the one marked
  const given = async () => (await allServerRows(request)).find((e) => e.type === 'vitamin_d' && !e.deleted);
  await expect.poll(async () => (await given())?.start ?? '').not.toBe('');
  const marked = (await given())!.start;
  await line.getByTestId('meds-back-15').click();
  await expect(line.getByTestId('meds-back-15')).toHaveClass(/\bon\b/);
  await expect.poll(async () => (await given())!.start).toBe(formatLocal(parseLocal(marked) - 15 * 60_000));
  await line.getByTestId('meds-back-5').click(); // another choice counts from the time it was marked
  await expect.poll(async () => (await given())!.start).toBe(formatLocal(parseLocal(marked) - 5 * 60_000));
  await row(page, 'm1').click(); // the window is still open for the other medicine
  await expect.poll(async () => (await doses(request)).sort()).toEqual(['m1', 'vitamin_d']);
  await line.getByTestId('meds-undo').click(); // take back vitamin D only
  await expect(row(page, 'vitamin_d').locator('..').getByTestId('meds-earlier')).toHaveCount(0);
  await expect.poll(() => doses(request)).toEqual(['m1']);
  await page.getByTestId('meds-cancel').click(); // and the rest
  await expect.poll(() => doses(request)).toEqual([]);
  await expect(page.getByTestId('banner-rejected')).toHaveCount(0);
});

test('window: taking back everything also takes back a move made before it', async ({ page, request }) => {
  await setMeds(request, [VIT, { id: 'm1', name: 'בפנטן', icon: '🍓', schedule: 'daily' }]);
  await install(page);
  await page.getByTestId('btn-meds').click();
  await row(page, 'm1').click();
  await row(page, 'm1').locator('..').getByTestId('meds-back-30').click();
  await page.getByTestId('meds-cancel').click();
  await expect.poll(() => doses(request)).toEqual([]);
  await expect(page.getByTestId('banner-rejected')).toHaveCount(0);
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

// Owner (feedback #6, #7): a medicine whose course is over is offered to the archive, after its last dose and when someone
// tries to give it again; "בטל" brings it back.
const statusOf = async (request: APIRequestContext, id: string) =>
  ((await api(request, { action: 'settings' })).settings.medicines as { id: string; status: string }[]).find((m) => m.id === id)?.status;
const IRON = { id: 'm1', name: 'ברזל', icon: '🍓', schedule: 'prn', course: 'doses' };

test('after the last dose of a course the toast offers the archive; archived it leaves Home, "בטל" brings it back', async ({ page, request }) => {
  const d = await pinPageDay(page);
  await setMeds(request, [{ ...VIT, status: 'archived' }, { ...IRON, courseCount: 2 }]);
  await seed(request, [{ type: 'medicine', detail: 'm1', start: `${d} 08:00` }]);
  await install(page);
  await page.getByTestId('btn-med').click();
  await expect(page.getByTestId('toast-offer-text')).toHaveText('זו הייתה המנה האחרונה');
  await page.getByTestId('toast-offer-yes').click();
  await expect(page.getByTestId('toast-text')).toHaveText('הועבר לארכיון: ברזל');
  await expect(page.getByTestId('btn-med')).toHaveCount(0);
  await expect.poll(() => statusOf(request, 'm1')).toBe('archived');
  expect(await doses(request)).toEqual(['m1', 'm1']); // the doses stay
  await page.getByTestId('toast-undo').click();
  await expect(page.getByTestId('btn-med')).toBeVisible();
  await expect.poll(() => statusOf(request, 'm1')).toBe('active');
});

test('a dose that is not the last offers nothing', async ({ page, request }) => {
  await setMeds(request, [{ ...VIT, status: 'archived' }, { ...IRON, courseCount: 3 }]);
  await install(page);
  await page.getByTestId('btn-med').click();
  await expect(page.getByTestId('toast-text')).toContainText('ברזל');
  await expect(page.getByTestId('toast-offer')).toHaveCount(0);
});

test('giving a medicine whose course is over: the confirm offers the archive (#7)', async ({ page, request }) => {
  const d = await pinPageDay(page);
  await setMeds(request, [{ ...VIT, status: 'archived' }, { ...IRON, courseCount: 1 }]);
  await seed(request, [{ type: 'medicine', detail: 'm1', start: `${d} 08:00` }]);
  await install(page);
  await page.getByTestId('btn-med').click();
  await expect(page.getByTestId('confirm-warnings')).toContainText('משך מתן התרופה הסתיים');
  await page.getByTestId('confirm-archive').click();
  await expect(page.getByTestId('confirm-dose')).toHaveCount(0);
  await expect(page.getByTestId('toast-text')).toHaveText('הועבר לארכיון: ברזל');
  await expect.poll(() => statusOf(request, 'm1')).toBe('archived');
  expect(await doses(request)).toEqual(['m1']); // nothing logged
});

test('in the medicines window: the last dose offers the archive under its row; a finished one offers it in the confirm', async ({ page, request }) => {
  const d = await pinPageDay(page);
  await setMeds(request, [VIT, { ...IRON, courseCount: 1 }, { id: 'm2', name: 'אנטיביוטיקה', icon: '💊', schedule: 'prn', course: 'doses', courseCount: 1 }]);
  await seed(request, [{ type: 'medicine', detail: 'm2', start: `${d} 08:00` }]);
  await install(page);
  await page.getByTestId('btn-meds').click();
  await row(page, 'm1').click();
  await expect(page.getByTestId('meds-last')).toContainText('זו הייתה המנה האחרונה');
  await page.getByTestId('meds-archive').click();
  await expect(row(page, 'm1')).toHaveCount(0);
  await expect(page.getByTestId('meds-archived')).toContainText('הועבר לארכיון: ברזל');
  await expect(page.getByTestId('toast')).toHaveCount(0); // no toast over the window's buttons
  await expect.poll(() => statusOf(request, 'm1')).toBe('archived');
  await page.getByTestId('meds-unarchive').click();
  await expect(row(page, 'm1')).toBeVisible();
  await expect.poll(() => statusOf(request, 'm1')).toBe('active');
  await expect(page.getByTestId('meds-archived')).toHaveCount(0);
  await row(page, 'm2').click(); // its course is over: the confirm
  await page.getByTestId('confirm-archive').click();
  await expect(row(page, 'm2')).toHaveCount(0);
  await expect.poll(() => statusOf(request, 'm2')).toBe('archived');
  await expect(row(page, 'vitamin_d')).toBeVisible();
});

// (review) vitamin D on Home logs through its own path: its last dose offers the archive too (e.g. "until the first birthday")
test('vitamin D on Home: the dose on the last day of its course offers the archive', async ({ page, request }) => {
  const d = await pinPageDay(page);
  await setMeds(request, [{ ...VIT, course: 'until', courseUntil: d }]);
  await install(page);
  await page.getByTestId('btn-vitamin_d').click();
  await expect(page.getByTestId('toast-offer-text')).toHaveText('זו הייתה המנה האחרונה');
  await page.getByTestId('toast-offer-yes').click();
  await expect(page.getByTestId('toast-text')).toHaveText('הועבר לארכיון: ויטמין D');
  await expect.poll(() => statusOf(request, 'vitamin_d')).toBe('archived');
});
