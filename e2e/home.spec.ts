import { expect, test } from '@playwright/test';
import { encodeSetupCode } from '../src/app/config';
import { formatLocal, parseLocal } from '../src/shared/tz';
import { MOCK, api, control, install, installExisting, nowLocal, resetServer, seed, serverEvents, todayLocal } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('first-run install, then the home screen fits without scrolling', async ({ page }, info) => {
  await install(page);
  await expect(page.getByTestId('tile-feed')).toContainText('אין עדיין');
  const fits = await page.evaluate(() => {
    const m = document.querySelector('.main') as HTMLElement;
    return { main: m.scrollHeight <= m.clientHeight + 1, doc: document.documentElement.scrollHeight <= window.innerHeight + 1 };
  });
  expect(fits).toEqual({ main: true, doc: true });
  await page.screenshot({ path: info.outputPath('home.png') });
});

test('install rejects a malformed code and a wrong key, and survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('setup-code').fill('hello');
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-error')).toBeVisible();
  await page.getByTestId('setup-code').fill(encodeSetupCode(`${MOCK}/`, 'a-wrong-key-123'));
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-error')).toContainText('המפתח לא תקין');
  await expect(page.getByTestId('home')).toBeHidden();
  await install(page);
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible(); // configuration persisted
});

test('a setup code carrying the private /dev address is refused, and a real address can be supplied', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('setup-code').fill(encodeSetupCode(`${MOCK}/dev`, 'test-key'));
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-error')).toContainText('/dev');
  await expect(page.getByTestId('exec-url')).toBeVisible();
  await page.getByTestId('exec-url').fill('http://example.test/exec'); // not https
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-error')).toContainText('https://');
  await page.getByTestId('exec-url').fill(`${MOCK}/dev`); // still the test address
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-error')).toContainText('/exec');
  await page.getByTestId('exec-url').fill(`${MOCK}/`);
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('install-step2')).toBeVisible();
});

test('one tap on a feed button records it, shows it, and recommends the other side', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('btn-feed_left').click();
  await expect(page.getByTestId('toast-text')).toContainText('נשמר: הנקה שמאל');
  await expect(page.getByTestId('tile-feed')).toContainText('לפני 0:00 · שמאל');
  await expect(page.getByTestId('tile-feed')).toContainText('הבא: ימין');
  await expect(page.getByTestId('btn-feed_right')).toHaveClass(/next/);
  await expect(page.getByTestId('btn-feed_left')).not.toHaveClass(/next/);
  await expect.poll(async () => (await serverEvents(request)).map((e) => [e.type, e.detail, e.user, e.source])).toEqual([['feed', 'left', 'Parent One', 'app']]);
});

test('buttons lock for a moment after a tap to prevent double taps', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('btn-wet').click();
  await expect(page.getByTestId('btn-poop')).toBeDisabled();
  await expect(page.getByTestId('btn-wet')).toBeDisabled();
  await expect(page.getByTestId('btn-poop')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-wet').dblclick(); // a double tap records only one
  await expect.poll(async () => (await serverEvents(request)).length).toBe(2);
});

test('the three diaper buttons record the right detail', async ({ page, request }) => {
  await install(page);
  for (const kind of ['wet', 'poop', 'both'] as const) {
    await page.getByTestId(`btn-${kind}`).click();
    await expect(page.getByTestId('btn-wet')).toBeEnabled({ timeout: 3000 });
  }
  await expect.poll(async () => (await serverEvents(request)).map((e) => e.detail).sort()).toEqual(['both', 'poop', 'wet']);
});

test('re-rendering the home screen does not rebuild the buttons (a tap in that moment would be lost)', async ({ page }) => {
  await install(page);
  await page.evaluate(() => document.querySelectorAll('[data-testid^="btn-"]').forEach((b) => ((b as HTMLElement).dataset.mark = 'same-node')));
  await page.getByTestId('btn-wet').click(); // re-renders Home several times: lock, flash, optimistic update, sync
  await expect(page.getByTestId('btn-poop')).toBeEnabled({ timeout: 3000 });
  await page.waitForTimeout(400);
  const marks = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="btn-"]')].map((b) => (b as HTMLElement).dataset.mark));
  expect(marks).toHaveLength(7);
  expect(marks.every((m) => m === 'same-node'), 'some button was replaced by a new element').toBe(true);
});

test('undo within the toast takes the entry back', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('btn-wet').click();
  await expect(page.getByTestId('toast')).toBeVisible();
  await page.getByTestId('toast-undo').click();
  await expect(page.getByTestId('toast')).toBeHidden();
  await expect(page.getByTestId('recent')).toContainText('עדיין לא תועד כלום');
  await expect.poll(async () => (await serverEvents(request)).length).toBe(0);
});

test('the toast disappears by itself after five seconds', async ({ page }) => {
  await install(page);
  await page.getByTestId('btn-both').click();
  await expect(page.getByTestId('toast')).toBeVisible();
  await expect(page.getByTestId('toast')).toBeHidden({ timeout: 7000 });
});

test('the sleep button switches between asleep and awake with one sleep row', async ({ page, request }) => {
  await install(page);
  await expect(page.getByTestId('btn-sleep')).toContainText('נרדם');
  await page.getByTestId('btn-sleep').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('התעורר');
  await expect(page.getByTestId('tile-sleep')).toContainText('ישן כבר');
  await expect(page.getByTestId('btn-sleep')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-sleep').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('נרדם');
  await expect(page.getByTestId('tile-sleep')).toContainText('ער כבר');
  await expect.poll(async () => (await serverEvents(request)).filter((e) => e.type === 'sleep' && e.start && e.end).length).toBe(1);
  expect((await serverEvents(request)).filter((e) => e.type === 'sleep')).toHaveLength(1);
});

test('undoing a wake-up reopens the sleep', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('btn-sleep').click();
  await expect(page.getByTestId('btn-sleep')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-sleep').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('נרדם');
  await page.getByTestId('toast-undo').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('התעורר');
  await expect.poll(async () => (await serverEvents(request)).filter((e) => e.type === 'sleep' && !e.end).length).toBe(1);
});

// F7 stage 3 (owner): a second vitamin D on the same day asks first, even as the only button; it can still be logged.
test('vitamin D: status tile; a second tap the same day asks first, cancel logs nothing, confirm logs it', async ({ page, request }) => {
  await install(page);
  await expect(page.getByTestId('tile-vitamin')).toContainText('עדיין לא');
  await page.getByTestId('btn-vitamin_d').click();
  await expect(page.getByTestId('confirm-dose')).toHaveCount(0); // the first one needs no confirmation
  await expect(page.getByTestId('tile-vitamin')).toContainText('ניתן היום');
  await expect(page.getByTestId('btn-vitamin_d')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-vitamin_d').click();
  await expect(page.getByTestId('confirm-warnings')).toContainText('כבר ניתן היום ב-');
  await expect(page.getByTestId('confirm-last')).toContainText('Parent One');
  await page.getByTestId('confirm-no').click();
  await expect(page.getByTestId('confirm-dose')).toHaveCount(0);
  await page.getByTestId('btn-vitamin_d').click();
  await page.getByTestId('confirm-yes').click();
  await expect.poll(async () => (await serverEvents(request)).filter((e) => e.type === 'vitamin_d').length).toBe(2);
});

test('works without a connection: queued, visible, survives reload, syncs when back', async ({ page, request }) => {
  await install(page);
  await control(request, 'offline=1');
  await page.getByTestId('btn-feed_right').click();
  await expect(page.getByTestId('tile-feed')).toContainText('ימין');
  await expect(page.getByTestId('banner-sync')).toContainText('ממתינים לסנכרון');
  await page.reload();
  await expect(page.getByTestId('banner-sync')).toContainText('1 ממתינים');
  await expect(page.getByTestId('recent-row')).toHaveCount(1); // still there after a restart, with no connection
  await control(request, 'offline=0');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('banner-sync')).toBeHidden({ timeout: 10_000 });
  await expect.poll(async () => (await serverEvents(request)).length).toBe(1);
});

test('an event logged by voice shortcut appears, and the other parent’s next-side advice follows it', async ({ page, request }) => {
  await install(page);
  await api(request, { action: 'log', id: 'siri-1', type: 'feed', detail: 'left', start: `${todayLocal()} ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' })}`, user: 'Parent Two', source: 'siri' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('recent-row').first()).toContainText('Parent Two 🎙');
  await expect(page.getByTestId('btn-feed_right')).toHaveClass(/next/);
});

test('two phones stay in step through the shared sheet', async ({ page, browser, request }) => {
  await install(page, 1);
  const ctx2 = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: 'he-IL' });
  const other = await ctx2.newPage();
  await installExisting(other, 2);
  await page.getByTestId('btn-feed_left').click();
  await expect.poll(async () => (await serverEvents(request)).length).toBe(1);
  await other.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(other.getByTestId('tile-feed')).toContainText('שמאל');
  await expect(other.getByTestId('btn-feed_right')).toHaveClass(/next/);
  await other.getByTestId('btn-feed_right').click();
  await expect.poll(async () => (await serverEvents(request)).length).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('tile-feed')).toContainText('ימין');
  const rows = await serverEvents(request);
  expect(rows.map((r) => r.user).sort()).toEqual(['Parent One', 'Parent Two']);
  await ctx2.close();
});

test('seeded events from the server show up on the home screen', async ({ page, request }) => {
  await install(page);
  await seed(request, [{ id: 'old', type: 'diaper', detail: 'wet', start: `${todayLocal()} 00:01` }]);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('recent-row')).toHaveCount(1);
});

// Owner screenshot: in the recent list "💧💩" wrapped onto two lines (the icon column was 24px), making that row taller, and a single
// icon looked off-centre. Icons stay on one line, centred in a column wide enough for two; the same in History.
test('recent list and history: two icons stay on one line, centred like a single icon', async ({ page, request }) => {
  await seed(request, [
    { type: 'diaper', detail: 'both', start: `${todayLocal()} 00:02` },
    { type: 'diaper', detail: 'wet', start: `${todayLocal()} 00:01` },
  ]);
  await install(page);
  const measure = (rowSel: string, iconSel: string) =>
    page.evaluate(
      ([rs, is]) =>
        [...document.querySelectorAll(rs)].slice(0, 2).map((row) => {
          const cell = row.querySelector(is)!;
          const r = document.createRange();
          r.selectNodeContents(cell);
          const text = r.getBoundingClientRect();
          const box = cell.getBoundingClientRect();
          return { rowH: row.getBoundingClientRect().height, textH: text.height, off: Math.abs(text.left + text.width / 2 - (box.left + box.width / 2)) };
        }),
      [rowSel, iconSel] as const,
    );
  const check = (m: { rowH: number; textH: number; off: number }[]) => {
    expect(m).toHaveLength(2);
    expect(Math.abs(m[0]!.rowH - m[1]!.rowH)).toBeLessThan(1); // "both" is not taller
    expect(m[0]!.textH).toBeLessThan(30); // one line of icons
    for (const x of m) expect(x.off).toBeLessThan(2); // centred in the cell
  };
  await expect(page.getByTestId('recent-row')).toHaveCount(2);
  check(await measure('[data-testid="recent-row"]', '.ri'));
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('history-row')).toHaveCount(2);
  check(await measure('[data-testid="history-row"]', '.hi'));
});

// Owner: the recent list shows falling asleep and waking up as separate rows, so a missing wake-up is easy to spot.
test('recent list: a sleep shows as "נרדם" and "התעורר" at their own times; an open sleep only as "נרדם"', async ({ page, request }) => {
  const d = todayLocal();
  await seed(request, [
    { type: 'sleep', start: `${d} 00:05`, end: `${d} 00:40` },
    { type: 'diaper', detail: 'wet', start: `${d} 00:20` },
    { type: 'sleep', start: `${d} 00:50` },
  ]);
  await install(page);
  const rows = page.getByTestId('recent-row');
  await expect(rows).toHaveCount(4);
  const texts = (await rows.allTextContents()).map((t) => t.replace(/\s+/g, ' '));
  expect(texts[0]).toContain('נרדם');
  expect(texts[0]).toContain('00:50');
  expect(texts[1]).toContain('התעורר');
  expect(texts[1]).toContain('00:40');
  expect(texts[2]).toContain('פיפי');
  expect(texts[3]).toContain('נרדם');
  expect(texts[3]).toContain('00:05');
  await rows.nth(1).click(); // "התעורר" opens that sleep, on its wake-up
  await expect(page.getByTestId('event-form')).toBeVisible();
  await expect(page.getByTestId('kind-sleep')).toHaveClass(/\bon\b/);
  await expect(page.getByTestId('end-time')).toHaveValue('00:40');
  await expect(page.getByTestId('moment-end')).toHaveAttribute('aria-selected', 'true');
});

// Owner: logging a feed or a diaper while the baby is marked asleep. Nothing changes by itself (night feeds and changes often happen
// in sleep); the confirmation says he is still marked asleep and offers "התעורר" in one tap.
test('a feed or diaper while asleep offers "התעורר" in the confirmation; awake there is no such button', async ({ page, request }) => {
  await install(page);
  await page.getByTestId('btn-wet').click();
  await expect(page.getByTestId('toast-text')).toContainText('נשמר: פיפי');
  await expect(page.getByTestId('toast-action')).toHaveCount(0);
  await expect(page.getByTestId('btn-sleep')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-sleep').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('התעורר');
  await expect(page.getByTestId('btn-feed_left')).toBeEnabled({ timeout: 3000 });
  await page.getByTestId('btn-feed_left').click();
  await expect(page.getByTestId('toast-text')).toContainText('עדיין מסומן שישן');
  await expect(page.getByTestId('recent-row').first()).toContainText('הנקה שמאל'); // same minute as "נרדם": entered later, so first
  await expect(page.getByTestId('btn-sleep')).toContainText('התעורר'); // still asleep: nothing changed by itself
  await page.getByTestId('toast-action').click();
  await expect(page.getByTestId('btn-sleep')).toContainText('נרדם');
  await expect.poll(async () => (await serverEvents(request)).filter((e) => e.type === 'sleep').map((e) => Boolean(e.start && e.end))).toEqual([true]);
});

// Owner screenshot: in the recent list the time moved with the length of the parent's name. The time sits at a fixed place;
// a long name is cut with "…" instead of pushing it.
test('recent list: the time stays in place whatever the length of the name', async ({ page, request }) => {
  const d = todayLocal();
  await seed(request, [
    { type: 'feed', detail: 'left', start: `${d} 00:01`, user: 'א' },
    { type: 'feed', detail: 'right', start: `${d} 00:02`, user: 'שם ארוך מאוד מאוד' },
    { type: 'diaper', detail: 'wet', start: `${d} 00:03`, user: 'Parent Two' },
  ]);
  await install(page);
  await expect(page.getByTestId('recent-row')).toHaveCount(3);
  const pos = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="recent-row"]')].map((row) => {
      const t = row.querySelector('.rt')!.getBoundingClientRect();
      const m = row.querySelector('.rm')!.getBoundingClientRect();
      return { timeLeft: Math.round(t.left), timeRight: Math.round(t.right), nameRight: Math.round(m.right), nameLeft: Math.round(m.left), rowLeft: Math.round(row.getBoundingClientRect().left) };
    }),
  );
  for (const p of pos) {
    expect(p.timeRight).toBe(pos[0]!.timeRight);
    expect(p.timeLeft).toBe(pos[0]!.timeLeft);
    expect(p.nameLeft).toBeGreaterThanOrEqual(p.rowLeft); // a long name stays inside the row
  }
});

// Owner (refactor plan, phase 5): the sync strip made Home jump after every tap and made the app feel slow.
for (const height of [852, 700, 560]) {
  test(`the sync mark never moves the screen and is never a coloured band (height ${height})`, async ({ page, request }) => {
    await page.setViewportSize({ width: 393, height });
    await install(page);
    const top = () => page.getByTestId('tile-feed').evaluate((e) => e.getBoundingClientRect().top);
    const before = await top();
    await control(request, 'offline=1');
    await page.getByTestId('btn-wet').click();
    const mark = page.getByTestId('banner-sync');
    await expect(mark).toContainText('אין חיבור · 1 ממתינים לסנכרון');
    expect(await top(), 'the tiles stay where they were').toBe(before);
    const box = await mark.evaluate((e) => ({ bottom: e.getBoundingClientRect().bottom, bg: getComputedStyle(e).backgroundColor, events: getComputedStyle(e).pointerEvents }));
    expect(box.bottom, 'the mark sits in the empty strip above the tiles').toBeLessThanOrEqual(before);
    expect(box.bg).toBe('rgba(0, 0, 0, 0)');
    expect(box.events).toBe('none'); // it can never swallow a tap
    const main = await page.evaluate(() => {
      const m = document.querySelector('.main')!;
      return m.scrollHeight > m.clientHeight + 1;
    });
    expect(main).toBe(false);
    await control(request, 'offline=0');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(mark).toBeHidden({ timeout: 10_000 });
    expect(await top()).toBe(before);
  });
}

test('while an entry is being sent there is only a small dot; words appear only when it takes long', async ({ page, request }) => {
  await install(page);
  await control(request, 'delay=9500');
  await page.getByTestId('btn-wet').click();
  const mark = page.getByTestId('banner-sync');
  await expect(mark).toHaveAttribute('data-state', 'sending');
  await expect(page.getByTestId('sync-text')).toHaveCount(0);
  await expect(page.getByTestId('sync-text')).toHaveText('מסנכרן · 1 ממתינים לסנכרון', { timeout: 9_500 });
  await expect(mark).toBeHidden({ timeout: 6_000 });
});

test('opening the app says "מתעדכן…" until its first check is back', async ({ page, request }) => {
  await install(page);
  await control(request, 'delay=1500');
  await page.reload();
  await expect(page.getByTestId('sync-text')).toHaveText('מתעדכן…');
  await expect(page.getByTestId('tile-feed')).toBeVisible(); // the stored copy is on the screen meanwhile
  await expect(page.getByTestId('banner-sync')).toBeHidden({ timeout: 5_000 });
});

test('without a connection for a while, the mark says when the data was last updated', async ({ page, request }) => {
  await page.clock.install({ time: new Date('2026-11-14T10:00:00Z') });
  await install(page);
  await control(request, 'offline=1');
  await page.clock.fastForward(3 * 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('sync-text')).toHaveText(/^אין חיבור · עודכן 12:0\d$/);
});

test('after a tap the same button rests for 1.5 seconds, the others only for a moment', async ({ page }) => {
  await install(page);
  await page.getByTestId('btn-wet').click();
  await expect(page.getByTestId('btn-sleep')).toBeDisabled(); // a moment: a slip of the finger logs nothing
  await expect(page.getByTestId('btn-sleep')).toBeEnabled({ timeout: 900 });
  await expect(page.getByTestId('btn-wet')).toBeDisabled(); // still resting
  await page.getByTestId('btn-sleep').click(); // "פיפי" and then "נרדם" straight away
  await expect(page.getByTestId('btn-sleep')).toContainText('התעורר');
  await expect(page.getByTestId('btn-wet')).toBeEnabled({ timeout: 2_000 });
  await expect(page.getByTestId('recent-row')).toHaveCount(2);
});

test("an entry that arrives from the other phone glows briefly in the recent list; my own does not", async ({ page, request }) => {
  await install(page);
  await page.getByTestId('btn-wet').click();
  await expect(page.getByTestId('recent-row')).toHaveCount(1);
  await expect(page.locator('.rrow.new')).toHaveCount(0);
  await api(request, { action: 'log', id: 'theirs-1', type: 'feed', detail: 'right', start: nowLocal(), user: 'Parent Two', source: 'app' });
  await expect(page.locator('.rrow.new')).toHaveCount(1, { timeout: 8_000 });
  await expect(page.locator('.rrow.new')).toContainText('Parent Two');
  expect(await page.locator('.rrow.new').evaluate((e) => getComputedStyle(e).animationName)).toBe('arrived');
});


// Owner: two taps to log something that happened a little while ago: the button, then "15" in the toast.
test.describe('the toast after a one-tap log: "it happened earlier"', () => {
  const minus = (local: string, mins: number) => formatLocal(parseLocal(local) - mins * 60_000);

  test('two taps: the entry moves to that many minutes before it was logged; another choice counts from the logged time', async ({ page, request }) => {
    await install(page);
    await page.getByTestId('btn-wet').click();
    await expect(page.getByTestId('toast-earlier')).toBeVisible();
    await expect(page.getByTestId('toast-earlier').locator('button')).toHaveText(['5', '10', '15', '30']);
    await expect.poll(async () => (await serverEvents(request)).length).toBe(1);
    const logged = (await serverEvents(request))[0]!.start;
    await page.getByTestId('toast-back-15').click();
    await expect(page.getByTestId('toast-back-15')).toHaveClass(/\bon\b/);
    await expect(page.getByTestId('toast-text')).toContainText(`נשמר: פיפי ${minus(logged, 15).slice(11)}`);
    await expect.poll(async () => (await serverEvents(request))[0]!.start).toBe(minus(logged, 15));
    await page.getByTestId('toast-back-10').click(); // changed my mind: 10, not 25
    await expect(page.getByTestId('toast-back-15')).not.toHaveClass(/\bon\b/);
    await expect.poll(async () => (await serverEvents(request))[0]!.start).toBe(minus(logged, 10));
    expect(await serverEvents(request)).toHaveLength(1);
    await expect(page.getByTestId('recent-row').first()).toContainText(minus(logged, 10).slice(11));
  });

  test('undo after moving takes the entry back completely (also before anything reached the server)', async ({ page, request }) => {
    await install(page);
    await control(request, 'offline=1');
    await page.getByTestId('btn-poop').click();
    await page.getByTestId('toast-back-30').click();
    await page.getByTestId('toast-undo').click();
    await expect(page.getByTestId('recent-row')).toHaveCount(0);
    await control(request, 'offline=0');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('banner-sync')).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('banner-rejected')).toHaveCount(0); // nothing left over that the server would refuse
    expect(await serverEvents(request)).toHaveLength(0);

    await page.getByTestId('btn-both').click(); // and once it is on the server
    await expect.poll(async () => (await serverEvents(request)).length).toBe(1);
    await page.getByTestId('toast-back-5').click();
    await page.getByTestId('toast-undo').click();
    await expect.poll(async () => (await serverEvents(request)).length).toBe(0);
    await expect(page.getByTestId('banner-rejected')).toHaveCount(0);
  });

  test('falling asleep and waking up move their own time; the wake-up says how long the sleep was', async ({ page, request }) => {
    await install(page);
    await page.getByTestId('btn-sleep').click();
    await page.getByTestId('toast-back-30').click();
    const sleep = async () => (await serverEvents(request)).find((e) => e.type === 'sleep')!;
    await expect.poll(async () => (await sleep())?.start ?? '').not.toBe('');
    await expect.poll(async () => (parseLocal((await sleep()).created) - parseLocal((await sleep()).start)) / 60_000).toBeGreaterThanOrEqual(29);
    await expect(page.getByTestId('tile-sleep')).toContainText(/ישן כבר 0:(29|3\d)/); // the tile's clock refreshes every 15 s: just after a minute boundary it may still say 0:29
    await expect(page.getByTestId('btn-sleep')).toBeEnabled({ timeout: 3000 });
    await page.getByTestId('btn-sleep').click(); // wakes up
    await expect(page.getByTestId('toast-text')).toContainText(/התעורר \d\d:\d\d · ישן 0:3\d/);
    await page.getByTestId('toast-back-5').click();
    await expect(page.getByTestId('toast-text')).toContainText(/ישן 0:2\d/); // five minutes shorter
    await expect.poll(async () => (await sleep()).end).not.toBe('');
    const s = await sleep();
    expect((parseLocal(s.end) - parseLocal(s.start)) / 60_000).toBeLessThan(30);
    await page.getByTestId('toast-undo').click(); // undo after the move: the sleep is open again
    await expect(page.getByTestId('btn-sleep')).toContainText('התעורר');
    await expect.poll(async () => (await sleep()).end).toBe('');
    await expect(page.getByTestId('banner-rejected')).toHaveCount(0);
  });

  test('the medicine button and a feed while asleep get the same buttons', async ({ page }) => {
    await install(page);
    await page.getByTestId('btn-vitamin_d').click();
    await expect(page.getByTestId('toast-earlier')).toBeVisible();
    await page.getByTestId('toast-undo').click();
    await page.getByTestId('btn-sleep').click();
    await expect(page.getByTestId('btn-feed_left')).toBeEnabled({ timeout: 3000 });
    await page.getByTestId('btn-feed_left').click();
    await expect(page.getByTestId('toast-action')).toHaveText('התעורר');
    await expect(page.getByTestId('toast-earlier')).toBeVisible();
  });
});

// Owner-approved sleep improvements
test.describe('sleep on Home', () => {
  test('while asleep the tile says since when', async ({ page }) => {
    await install(page);
    await page.getByTestId('btn-sleep').click();
    await expect(page.getByTestId('tile-sleep-sub')).toHaveText(/נרדם ב-\d\d:\d\d$/);
    await expect(page.getByTestId('btn-sleep')).toBeEnabled({ timeout: 3000 });
    await page.getByTestId('btn-sleep').click();
    await expect(page.getByTestId('tile-sleep-sub')).not.toContainText('נרדם ב');
  });

  test('a sleep open much longer than usual asks "שכחתם התעוררות?"; a tap opens it on waking up, ready to record it', async ({ page, request }) => {
    await seed(request, [{ id: 'long', type: 'sleep', start: nowLocal(-7 * 60) }]);
    await install(page);
    const tile = page.getByTestId('tile-sleep');
    await expect(tile).toHaveClass(/\bwarn\b/);
    await expect(page.getByTestId('tile-sleep-sub')).toHaveText('שכחתם התעוררות?');
    await tile.click();
    await expect(page.getByTestId('moment-end')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('still-asleep')).not.toBeChecked();
    await page.getByTestId('end-back-60').click(); // woke up an hour ago
    await page.getByTestId('save').click();
    await expect(page.getByTestId('btn-sleep')).toContainText('נרדם');
    await expect.poll(async () => (await serverEvents(request)).find((e) => e.id === 'long')!.end).not.toBe('');
    await expect(tile).not.toHaveClass(/\bwarn\b/);
  });

  test('an ordinary nap is not flagged', async ({ page, request }) => {
    await seed(request, [{ id: 'nap', type: 'sleep', start: nowLocal(-90) }]);
    await install(page);
    await expect(page.getByTestId('tile-sleep')).not.toHaveClass(/\bwarn\b/);
    await expect(page.getByTestId('tile-sleep-sub')).toContainText('נרדם ב-');
  });
});
