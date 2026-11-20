import { expect, test, type Page } from '@playwright/test';
import { api, control, install, installExisting, resetServer } from './helpers';

// Owner: a quick place in the app to note a bug, an idea or anything else. Settings > מתקדם > "🐞 משוב", next to the sync log.
test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

const open = async (page: Page) => {
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('open-feedback').click();
  await expect(page.getByTestId('feedback')).toBeVisible();
};
const write = async (page: Page, kind: 'bug' | 'idea' | 'other', text: string) => {
  await page.getByTestId(`fb-kind-${kind}`).click();
  await page.getByTestId('fb-text').fill(text);
  await page.getByTestId('fb-send').click();
};

test('the feedback button sits next to the sync log; each kind is sent with a number and listed newest first', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('tab-settings').click();
  const [log, fb] = await Promise.all([page.getByTestId('open-sync-log').boundingBox(), page.getByTestId('open-feedback').boundingBox()]);
  expect(Math.abs(log!.y - fb!.y), 'on the same row as "יומן סנכרון"').toBeLessThan(4);
  await page.getByTestId('open-feedback').click();
  await expect(page.getByTestId('fb-kind-bug')).toHaveAttribute('aria-checked', 'true'); // a bug by default
  await expect(page.getByTestId('fb-attach')).toBeChecked(); // with the sync log, for a bug
  await expect(page.getByTestId('fb-send')).toBeDisabled(); // nothing written yet
  await write(page, 'bug', 'הטוסטר נעלם לפני הלחיצה');
  await expect(page.getByTestId('fb-msg')).toHaveText('נשלח (#1)');
  await expect(page.getByTestId('fb-text')).toHaveValue('');
  await page.getByTestId('fb-kind-idea').click();
  await expect(page.getByTestId('fb-attach')).not.toBeChecked(); // other kinds: without it
  await write(page, 'idea', 'בקבוק עם כמות');
  await write(page, 'other', 'תודה!');
  await expect(page.getByTestId('fb-msg')).toHaveText('נשלח (#3)');
  const items = page.getByTestId('fb-item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0).locator('.lh')).toHaveText(/^#3 · 💬 אחר · היום \d\d:\d\d · Parent One · גרסה \S+$/);
  await expect(items.nth(1)).toContainText('#2 · 💡 רעיון');
  await expect(items.nth(2)).toContainText('#1 · 🐞 באג');
  await expect(items.nth(2)).toContainText('יומן סנכרון מצורף');
  await expect(items.nth(1)).not.toContainText('יומן סנכרון מצורף');
  const stored = (await api(request, { action: 'feedbackList' })).feedback as { no: number; kind: string; user: string; log: string; text: string }[];
  expect(stored.map((f) => [f.no, f.kind, f.user, f.text])).toEqual([
    [1, 'bug', 'Parent One', 'הטוסטר נעלם לפני הלחיצה'],
    [2, 'idea', 'Parent One', 'בקבוק עם כמות'],
    [3, 'other', 'Parent One', 'תודה!'],
  ]);
  expect(stored[0]!.log).toMatch(/פתיחה|בדיקה|רישום/); // the sync log lines, as the sync log copies them
  await page.getByTestId('fb-back').click();
  await expect(page.getByTestId('sect-advanced')).toBeVisible();
});

test('the other phone sees the same list; copy gives the whole list as text; clear asks once more and keeps the numbering', async ({ page, browser, context, request }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await install(page, 1);
  await open(page);
  await write(page, 'bug', 'שורה ראשונה\nשורה שנייה');
  await expect(page.getByTestId('fb-msg')).toHaveText('נשלח (#1)');

  const ctx2 = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: 'he-IL' });
  const other = await ctx2.newPage();
  await installExisting(other, 2);
  await open(other);
  await expect(other.getByTestId('fb-item')).toHaveCount(1);
  await expect(other.getByTestId('fb-item')).toContainText('#1 · 🐞 באג');
  await expect(other.getByTestId('fb-item')).toContainText('Parent One');
  await write(other, 'idea', 'רעיון מהטלפון השני');
  await expect(other.getByTestId('fb-msg')).toHaveText('נשלח (#2)');
  await ctx2.close();

  await page.getByTestId('fb-back').click();
  await page.getByTestId('open-feedback').click(); // opening again fetches the list
  await expect(page.getByTestId('fb-item')).toHaveCount(2);
  await page.getByTestId('fb-copy').click();
  await expect(page.getByTestId('fb-msg')).toHaveText('הועתק');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^#2 · 💡 רעיון · היום \d\d:\d\d · Parent Two · גרסה \S+\nרעיון מהטלפון השני\n\n#1 · 🐞 באג · היום \d\d:\d\d · Parent One · גרסה \S+\nשורה ראשונה\nשורה שנייה\nיומן סנכרון:\n/);

  await page.getByTestId('fb-clear').click();
  await expect(page.getByTestId('fb-clear')).toHaveText('לחצו שוב לניקוי כל הרשימה');
  await expect(page.getByTestId('fb-item')).toHaveCount(2); // nothing cleared yet
  await page.getByTestId('fb-clear').click();
  await expect(page.getByTestId('fb-item')).toHaveCount(0);
  await expect(page.getByTestId('fb-msg')).toHaveText('הרשימה נוקתה');
  expect((await api(request, { action: 'feedbackList' })).feedback).toEqual([]);
  await write(page, 'other', 'אחרי הניקוי');
  await expect(page.getByTestId('fb-msg')).toHaveText('נשלח (#3)'); // numbers are never reused
});

test('without a connection the text stays and nothing is lost; sending again stores it once', async ({ page, request }) => {
  await install(page);
  await open(page);
  await expect(page.getByTestId('fb-msg')).toHaveCount(0);
  await control(request, 'offline=1');
  await write(page, 'bug', 'נכתב בלי קליטה');
  await expect(page.getByTestId('fb-msg')).toHaveText('לא נשלח, הטקסט נשמר כאן: אין חיבור לשרת. נסו שוב.', { timeout: 25_000 });
  await expect(page.getByTestId('fb-text')).toHaveValue('נכתב בלי קליטה');
  await control(request, 'offline=0');
  await page.getByTestId('fb-send').click();
  await expect(page.getByTestId('fb-msg')).toHaveText('נשלח (#1)');
  await expect(page.getByTestId('fb-send')).toBeDisabled(); // the box is empty again
  expect(((await api(request, { action: 'feedbackList' })).feedback as unknown[]).length).toBe(1);
});

// Found by the slow-server run: the answer to the first send wiped what was typed meanwhile.
test('what is typed while a send is on its way stays when that send comes back', async ({ page, request }) => {
  await install(page);
  await open(page);
  await control(request, 'delay=1500');
  await write(page, 'bug', 'הראשון');
  await expect(page.getByTestId('fb-send')).toHaveText('שולח…');
  await page.getByTestId('fb-text').fill('השני, נכתב בינתיים');
  await expect(page.getByTestId('fb-msg')).toHaveText('נשלח (#1)', { timeout: 10_000 });
  await expect(page.getByTestId('fb-text')).toHaveValue('השני, נכתב בינתיים');
});

test('an older server says so instead of failing silently', async ({ page, request }) => {
  await install(page);
  await control(request, 'old=1');
  await open(page);
  await expect(page.getByTestId('fb-msg')).toHaveText('השרת עוד לא מעודכן למשוב. נסו שוב בעוד כמה דקות.');
  await write(page, 'idea', 'רעיון');
  await expect(page.getByTestId('fb-msg')).toHaveText('השרת עוד לא מעודכן למשוב. נסו שוב בעוד כמה דקות.');
  await expect(page.getByTestId('fb-text')).toHaveValue('רעיון');
});

test('the Settings tab returns from the feedback screen to Settings', async ({ page }) => {
  await install(page);
  await open(page);
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('feedback')).toHaveCount(0);
  await expect(page.getByTestId('sect-advanced')).toBeVisible();
});

for (const height of [852, 700, 560]) {
  test(`the feedback screen fits the width and its main button is big at height ${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 393, height });
    await install(page);
    await open(page);
    await write(page, 'bug', 'טקסט ארוך מאוד '.repeat(30));
    await expect(page.getByTestId('fb-msg')).toHaveText('נשלח (#1)');
    const m = await page.evaluate(() => {
      const main = document.querySelector('.main') as HTMLElement;
      const send = document.querySelector('[data-testid="fb-send"]')!.getBoundingClientRect();
      const box = document.querySelector('[data-testid="fb-text"]')!.getBoundingClientRect();
      return { overflow: main.scrollWidth - main.clientWidth, send: send.height, boxRight: box.right, width: window.innerWidth };
    });
    expect(m.overflow, 'no sideways scrolling').toBeLessThanOrEqual(0);
    expect(m.send).toBeGreaterThanOrEqual(56);
    expect(m.boxRight).toBeLessThanOrEqual(m.width);
  });
}
