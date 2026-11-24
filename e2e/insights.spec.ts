import { expect, test } from '@playwright/test';
import { formatLocal, parseLocal } from '../src/shared/tz';
import type { BabyEvent } from '../src/shared/types';
import { install, resetServer, seed } from './helpers';

// F8: the summary tab has a "סיכום" / "תובנות" switch; insights are patterns of the last 7 full days.
const NOW = new Date('2026-11-15T08:00:00Z'); // 10:00 in Israel; the window is Nov 8 .. 14
const MIN = 60_000;
const at = (t: number) => formatLocal(t);

/** A regular week: feeds every 2:30 by day and 3:15 by night (left + right), a change 15 min after most feeds,
 *  a poop 20 min after every third feed, and two long night stretches. */
function week(): Partial<BabyEvent>[] {
  const out: Partial<BabyEvent>[] = [];
  let t = parseLocal('2026-11-08 00:30');
  let i = 0;
  while (t < parseLocal('2026-11-15 07:00')) {
    out.push({ type: 'feed', detail: 'left', start: at(t) }, { type: 'feed', detail: 'right', start: at(t + 10 * MIN) });
    if (i % 3 === 0) out.push({ type: 'diaper', detail: 'poop', start: at(t + 20 * MIN) });
    else if (i % 5 !== 0) out.push({ type: 'diaper', detail: 'wet', start: at(t + 15 * MIN) });
    const h = Number(at(t).slice(11, 13));
    t += (h >= 19 || h < 7 ? 195 : 150) * MIN;
    i++;
  }
  for (let d = 8; d <= 14; d++) {
    const a = parseLocal(`2026-11-${String(d).padStart(2, '0')} 22:00`);
    out.push({ type: 'sleep', start: at(a), end: at(a + 220 * MIN) });
    const b = parseLocal(`2026-11-${String(d + 1).padStart(2, '0')} 03:00`);
    out.push({ type: 'sleep', start: at(b), end: at(b + 185 * MIN) });
  }
  return out;
}

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('insights: the usual feed gaps, poop and diaper after a feed, and long night stretches', async ({ page, request }) => {
  await seed(request, week());
  await page.clock.setFixedTime(NOW);
  await install(page);
  await page.getByTestId('tab-summary').click();
  await expect(page.getByTestId('day-summary')).toBeVisible(); // the day table stays the default
  await page.getByTestId('view-insights').click();
  // (owner, F16) questions with short answers; all four have enough data, so all show without any choice
  await expect(page.getByTestId('q-count')).toHaveText('4 שאלות מוצגות');
  await expect(page.getByTestId('q-gaps')).toContainText('כל כמה זמן מאכילים?');
  await expect(page.getByTestId('q-gaps-day')).toContainText('2:30');
  await expect(page.getByTestId('q-gaps-night')).toContainText('3:15');
  await expect(page.getByTestId('q-poop')).toContainText('כ-20 דק׳ אחרי תחילת האכלה');
  await expect(page.getByTestId('q-diaper')).toContainText('כ-15 דק׳ אחרי תחילת האכלה');
  await expect(page.getByTestId('q-night')).toContainText('מה הרצף הארוך בלילה?');
  await expect(page.getByTestId('q-night')).toContainText('3:40 בדרך כלל');
  await expect(page.getByTestId('q-night')).toContainText('מתחיל בדרך כלל בסביבות 22:00');
  await expect(page.getByTestId('q-night')).toContainText('רצפים של 3 שעות ומעלה: בדרך כלל שניים בלילה');
  await expect(page.getByTestId('q-night')).toContainText('הלילה האחרון: 3:40, 3:05');
  await expect(page.getByTestId('insights')).toContainText('מ-8.11 עד 14.11');
  // grouped by topic, in this order
  await expect(page.locator('.qsec')).toHaveText(['🍼 האכלה', '🌙 שינה', '💧 חיתולים']);
  // the timeline and the daily counts are no longer here: they are under the day table (owner)
  await expect(page.getByTestId('timeline')).toHaveCount(0);
});

test('insights: an empty log says there is not enough data yet, and the chosen view is remembered', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await install(page);
  await page.getByTestId('tab-summary').click();
  await page.getByTestId('view-insights').click();
  await expect(page.getByTestId('ins-empty')).toBeVisible();
  await expect(page.locator('.q')).toHaveCount(0);
  await expect(page.getByTestId('q-count')).toHaveText('0 שאלות מוצגות');
  await page.reload();
  await page.getByTestId('tab-summary').click();
  await expect(page.getByTestId('view-insights')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('insights')).toBeVisible();
  await page.getByTestId('view-day').click();
  await expect(page.getByTestId('day-summary')).toBeVisible();
});

test('summary: under the day table, a timeline row per day from 06:00, right to left, and daily count bars', async ({ page, request }) => {
  await seed(request, week());
  await page.clock.setFixedTime(NOW);
  await install(page);
  await page.getByTestId('tab-summary').click();
  await page.getByTestId('view-day').click(); // (owner) a dashboard, not an insight: in "סיכום", under the table
  const table = (await page.getByTestId('day-summary').boundingBox())!;
  expect((await page.getByTestId('week').boundingBox())!.y).toBeGreaterThan(table.y + table.height - 1);
  const rows = page.getByTestId('tl-row');
  await expect(rows).toHaveCount(7);
  await expect(rows.first()).toContainText('היום');
  await expect(rows.nth(1)).toContainText('אתמול');
  // yesterday's row (Nov 14, 06:00 -> Nov 15, 06:00): the 22:00 sleep starts 16/24 of the way, measured from the right
  const box = async (loc: import('@playwright/test').Locator) => (await loc.boundingBox())!;
  const rib = await box(rows.nth(1).locator('.rib'));
  const firstSleep = await box(rows.nth(1).getByTestId('tl-sleep').nth(1)); // nth(0) is 06:00-06:05, the end of the night before
  const fromRight = (rib.x + rib.width - (firstSleep.x + firstSleep.width)) / rib.width;
  expect(fromRight).toBeGreaterThan(16 / 24 - 0.02);
  expect(fromRight).toBeLessThan(16 / 24 + 0.02);
  expect(await rows.nth(1).getByTestId('tl-feed').count()).toBeGreaterThanOrEqual(8);
  expect(await rows.nth(1).getByTestId('tl-diaper').count()).toBeGreaterThanOrEqual(6);
  // daily counts: the 7 full days, oldest on the right, and then today (owner), so 8 bars each
  const feedBars = page.getByTestId('cnt-feeds').locator('.bar');
  await expect(feedBars).toHaveCount(8);
  const first = await box(feedBars.first());
  const last = await box(feedBars.last());
  expect(first.x).toBeGreaterThan(last.x);
  await expect(page.getByTestId('cnt-sleep').locator('.bn').first()).toHaveText('2'); // Nov 8: only 22:00-24:00 (the week starts that evening)
  await expect(page.getByTestId('cnt-sleep').locator('.bn').nth(1)).toHaveText('7'); // 1:40 + 3:05 + 2:00
  // today is the last bar (leftmost), set slightly apart: its label says "היום" and it is marked, the other days are not
  for (const id of ['feeds', 'wet', 'poop', 'sleep']) {
    const bars = page.getByTestId(`cnt-${id}`).locator('.bar');
    await expect(bars.last()).toHaveClass(/\btoday\b/);
    await expect(bars.last().locator('.bd')).toHaveText('היום');
    await expect(page.getByTestId(`cnt-${id}`).locator('.bar.today')).toHaveCount(1);
  }
  const todayBar = await box(feedBars.last());
  const yesterdayBar = await box(feedBars.nth(6));
  const gap = yesterdayBar.x - (todayBar.x + todayBar.width);
  const usual = (await box(feedBars.nth(5))).x - (yesterdayBar.x + yesterdayBar.width);
  expect(gap, 'a little space before today').toBeGreaterThan(usual + 2);
  // today's numbers are today's so far: the same as the "סיכום" table for today (10:00: feeds 00:30, 03:45, 07:00, ...)
  const todayCounts = await Promise.all(['feeds', 'wet', 'poop'].map((id) => page.getByTestId(`cnt-${id}`).locator('.bar').last().locator('.bn').textContent()));
  await page.getByTestId('view-day').click();
  const cell = (row: string) => page.getByTestId(`sum-${row}`).locator('td').first();
  expect(todayCounts).toEqual([await cell('הנקות (האכלות)').textContent(), await cell('פיפי').textContent(), await cell('קקי').textContent()]);
  expect(Number(todayCounts[0])).toBeGreaterThan(0);
});

// Owner: pee and poop dots were hard to tell apart. Pee is a yellow ring, poop a brown filled dot, and pee + poop a yellow ring with a
// brown dot inside (shapes keep them apart in the red theme too).
test('timeline: pee is a ring, poop a dot, pee + poop a ring with a dot inside', async ({ page, request }) => {
  await seed(request, [
    { type: 'diaper', detail: 'wet', start: '2026-11-14 09:00' },
    { type: 'diaper', detail: 'poop', start: '2026-11-14 12:00' },
    { type: 'diaper', detail: 'both', start: '2026-11-14 15:00' },
  ]);
  await page.clock.setFixedTime(NOW);
  await install(page);
  await page.getByTestId('tab-summary').click();
  const dots = page.getByTestId('tl-row').nth(1).getByTestId('tl-diaper');
  await expect(dots).toHaveCount(3);
  const look = (i: number) =>
    dots.nth(i).evaluate((e) => {
      const s = getComputedStyle(e);
      const inner = getComputedStyle(e, '::after');
      return {
        kind: e.getAttribute('data-kind'),
        fill: s.backgroundColor,
        ring: s.borderTopColor,
        ringWidth: s.borderTopWidth,
        innerDot: inner.content !== 'none' && inner.content !== 'normal' ? inner.backgroundColor : null,
      };
    });
  const [pee, poop, both] = [await look(0), await look(1), await look(2)];
  expect([pee.kind, poop.kind, both.kind]).toEqual(['pee', 'poop', 'both']);
  const clear = 'rgba(0, 0, 0, 0)';
  // pee: ring only
  expect(pee.fill).toBe(clear);
  expect(pee.ringWidth).not.toBe('0px');
  expect(pee.innerDot).toBeNull();
  // poop: filled dot, no ring
  expect(poop.fill).not.toBe(clear);
  expect(poop.ringWidth).toBe('0px');
  // both: the pee ring with the poop colour as a dot inside
  expect(both.fill).toBe(clear);
  expect(both.ring).toBe(pee.ring);
  expect(both.innerDot).toBe(poop.fill);
  const rgb = (c: string) => c.match(/\d+/g)!.slice(0, 3).map(Number);
  const [pr, pg, pb] = rgb(pee.ring);
  const [kr, kg, kb] = rgb(poop.fill);
  expect(Math.abs(pr! - kr!) + Math.abs(pg! - kg!) + Math.abs(pb! - kb!)).toBeGreaterThan(120); // clearly different colours by day
});

// (owner, F16) each question shows by itself once it has enough data; a parent hides one with "⋯" (with undo) or chooses in
// "בחירת שאלות" (kept on this phone); a question turned on without enough data says how much is still missing.
const openInsights = async (page: import('@playwright/test').Page) => {
  await page.getByTestId('tab-summary').click();
  await page.getByTestId('view-insights').click();
};

test('questions: hide one with "⋯" (undo brings it back), and bring it back in "בחירת שאלות"; remembered on the phone', async ({ page, request }) => {
  await seed(request, week());
  await page.clock.setFixedTime(NOW);
  await install(page);
  await openInsights(page);
  await expect(page.locator('.q')).toHaveCount(4);
  await page.getByTestId('q-poop-menu').click();
  await page.getByTestId('q-hide').click();
  await expect(page.getByTestId('q-poop')).toHaveCount(0);
  await expect(page.getByTestId('q-count')).toHaveText('3 שאלות מוצגות');
  await expect(page.getByTestId('toast-text')).toContainText('השאלה הוסתרה');
  await page.getByTestId('toast-undo').click();
  await expect(page.getByTestId('q-poop')).toBeVisible();
  // hidden again, then back through the picker
  await page.getByTestId('q-poop-menu').click();
  await page.getByTestId('q-hide').click();
  await expect(page.getByTestId('q-poop')).toHaveCount(0);
  await page.reload();
  await openInsights(page);
  await expect(page.getByTestId('q-poop')).toHaveCount(0); // remembered
  await page.getByTestId('q-pick').click();
  await expect(page.getByTestId('pick-gaps-switch')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pick-poop-switch')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('pick-poop-switch').click();
  await expect(page.getByTestId('pick-poop-switch')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('pick-back').click();
  await expect(page.getByTestId('q-poop')).toContainText('כ-20 דק׳');
});

test('questions: with no data none shows; one turned on by hand says how much is missing; off again hides it', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await install(page);
  await openInsights(page);
  await expect(page.getByTestId('ins-empty')).toBeVisible();
  await page.getByTestId('q-pick').click();
  for (const id of ['gaps', 'night', 'poop', 'diaper']) await expect(page.getByTestId(`pick-${id}-switch`)).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('pick-gaps')).toContainText('תופיע לבד כשיהיו מספיק נתונים');
  await page.getByTestId('pick-gaps-switch').click();
  await expect(page.getByTestId('pick-gaps')).toContainText('הרווח הרגיל בין האכלות');
  await page.getByTestId('pick-back').click();
  await expect(page.getByTestId('q-count')).toHaveText('שאלה אחת מוצגת');
  await expect(page.getByTestId('q-gaps-wait')).toContainText('עוד אין מספיק נתונים');
  await expect(page.getByTestId('q-gaps-wait')).toContainText('התשובה תופיע אחרי 20 רווחים בין האכלות ב-7 הימים האחרונים. עד עכשיו 0.');
  await expect(page.getByTestId('q-gaps-wait').locator('.ring')).toHaveText('0/20');
  await page.getByTestId('q-pick').click();
  await page.getByTestId('pick-gaps-switch').click();
  await page.getByTestId('pick-back').click();
  await expect(page.getByTestId('ins-empty')).toBeVisible();
});

test('questions: enough data but no clear pattern answers "אין קשר ברור"', async ({ page, request }) => {
  // poops 100 minutes after a feed: never within the hour after one
  await seed(request, week().map((e) => (e.detail === 'poop' ? { ...e, start: at(parseLocal(e.start!) + 80 * MIN) } : e)));
  await page.clock.setFixedTime(NOW);
  await install(page);
  await openInsights(page);
  await expect(page.getByTestId('q-poop')).toContainText('אין קשר ברור');
  await expect(page.getByTestId('q-poop')).toContainText('קקי לא מגיע אחרי האכלה יותר מאשר בשעות אחרות');
});

test('questions: "איך זה מחושב?" explains and says it is not medical; the note is also under the questions', async ({ page, request }) => {
  await seed(request, week());
  await page.clock.setFixedTime(NOW);
  await install(page);
  await openInsights(page);
  await expect(page.getByTestId('q-disclaimer')).toContainText('לא מול נורמות או ערכים רפואיים');
  await expect(page.getByTestId('q-disclaimer')).toContainText('זו לא המלצה ולא ייעוץ רפואי');
  await page.getByTestId('q-night-menu').click();
  await page.getByTestId('q-how').click();
  await expect(page.getByTestId('q-pop')).toHaveCount(0);
  await expect(page.getByTestId('q-how-sheet')).toContainText('מה הרצף הארוך בלילה?');
  await expect(page.getByTestId('q-how-sheet')).toContainText('השינה הרציפה הארוכה ביותר');
  await expect(page.getByTestId('q-how-disclaimer')).toContainText('פנו לרופא או לטיפת חלב');
  await page.getByTestId('q-how-close').click();
  await expect(page.getByTestId('q-how-sheet')).toHaveCount(0);
  // a tap outside the menu closes it without doing anything
  await page.getByTestId('q-gaps-menu').click();
  await expect(page.getByTestId('q-pop')).toBeVisible();
  await page.getByTestId('q-shield').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('q-pop')).toHaveCount(0);
  await expect(page.locator('.q')).toHaveCount(4);
});

test('questions: "הציעו שאלה" opens the feedback as an idea with a first line, and goes back to the questions', async ({ page, request }) => {
  await page.clock.setFixedTime(NOW);
  await install(page);
  await openInsights(page);
  await page.getByTestId('q-suggest').click();
  await expect(page.getByTestId('fb-text')).toHaveValue('שאלה מוצעת: ');
  await expect(page.getByTestId('fb-kind-idea')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('fb-back')).toHaveText('חזרה לתובנות');
  await page.getByTestId('fb-back').click();
  await expect(page.getByTestId('insights')).toBeVisible();
});

test('questions: nothing sticks out sideways, and the buttons are big enough, at 852 / 700 / 560', async ({ page, request }) => {
  await seed(request, week());
  await page.clock.setFixedTime(NOW);
  for (const h of [852, 700, 560]) {
    await page.setViewportSize({ width: 375, height: h });
    if (h === 852) await install(page);
    else await page.reload();
    await openInsights(page);
    const fits = async () => page.evaluate(() => { const m = document.querySelector('.main') as HTMLElement; return m.scrollWidth <= m.clientWidth + 1; });
    expect(await fits(), `cards at ${h}`).toBe(true);
    expect((await page.getByTestId('q-gaps-menu').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('q-pick').click();
    expect(await fits(), `picker at ${h}`).toBe(true);
    await page.getByTestId('pick-back').click();
  }
});
