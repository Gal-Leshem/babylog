import { expect, test } from '@playwright/test';
import { formatLocal, parseLocal } from '../src/shared/tz';
import type { BabyEvent } from '../src/shared/types';
import { api, install, resetServer, seed } from './helpers';
import { durationHe } from '../src/shared/speech';
import { moreAnswers } from '../src/shared/questions-data';
import { hm } from '../src/app/labels';
import { ev } from '../tests/helpers';

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
  // (owner, F16) questions with short answers; a regular week is enough data for all of them, so all show without any choice
  await expect(page.getByTestId('q-count')).toHaveText('13 שאלות מוצגות');
  await expect(page.getByTestId('q-gaps')).toContainText('כל כמה שעות מאכילים?');
  // (owner) every gap says its unit, so "2:30" cannot be read as minutes
  await expect(page.getByTestId('q-gaps-day')).toContainText('2:30 שעות');
  await expect(page.getByTestId('q-gaps-day')).toContainText(/רוב הרווחים (בין \d:\d\d ל-\d:\d\d|סביב \d:\d\d)/);
  await expect(page.getByTestId('q-gaps-day')).toContainText('2:30');
  await expect(page.getByTestId('q-gaps-night')).toContainText('3:15');
  await expect(page.getByTestId('q-poop')).toContainText('כ-20 דק׳ אחרי תחילת האכלה');
  await expect(page.getByTestId('q-diaper')).toHaveCount(0); // (owner) removed: it showed the parents' habit, not the baby
  await expect(page.getByTestId('q-night')).toContainText('מה הרצף הארוך בלילה?');
  await expect(page.getByTestId('q-night')).toContainText('3:40 בדרך כלל');
  await expect(page.getByTestId('q-night')).toContainText('מתחיל בדרך כלל בסביבות השעה 22:00');
  await expect(page.getByTestId('q-night')).toContainText('רצפים של 3 שעות ומעלה: בדרך כלל שניים בלילה');
  await expect(page.getByTestId('q-night')).toContainText('הלילה האחרון: 3:40, 3:05');
  await expect(page.getByTestId('insights')).toContainText('מ-8.11 עד 14.11');
  // grouped by topic, in this order
  await expect(page.locator('.qsec')).toHaveText(['🍼 האכלה', '🌙 שינה', '💧 חיתולים', '📅 כללי']);
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
  // (owner, feedback #3) a thin line at midnight in every row (18/24 from the right), and both sections say how they cut days
  const mid = await box(rows.nth(1).getByTestId('tl-midnight'));
  const midFromRight = (rib.x + rib.width - mid.x) / rib.width;
  expect(midFromRight).toBeGreaterThan(18 / 24 - 0.01);
  expect(midFromRight).toBeLessThan(18 / 24 + 0.01);
  await expect(page.getByTestId('tl-midnight')).toHaveCount(7);
  await expect(page.getByTestId('tl-note')).toHaveText('כל שורה: מ-06:00 עד 06:00 למחרת, כדי שכל לילה יופיע שלם. הקו הדק הוא חצות.');
  await expect(page.getByTestId('cnt-note')).toHaveText('לפי יממה, מחצות עד חצות, כמו בטבלה של הסיכום.');
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
  await expect(page.locator('.q')).toHaveCount(13);
  await page.getByTestId('q-poop-menu').click();
  await page.getByTestId('q-hide').click();
  await expect(page.getByTestId('q-poop')).toHaveCount(0);
  await expect(page.getByTestId('q-count')).toHaveText('12 שאלות מוצגות');
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
  for (const id of ['gaps', 'night', 'poop']) await expect(page.getByTestId(`pick-${id}-switch`)).toHaveAttribute('aria-checked', 'false');
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
  await expect(page.locator('.q')).toHaveCount(13);
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

// (owner, F16 stage B) the newer questions: each shows the numbers of the same calculation, with a label that compares only with
// this family's own days ("כמו הרגיל אצלכם" / more / less), never with norms.
test('questions, stage B: today against a usual day, next feed, sides, nights, poop, diapers, unusual', async ({ page, request }) => {
  const data = week();
  await seed(request, data);
  await page.clock.setFixedTime(NOW);
  await install(page);
  await openInsights(page);
  const m = moreAnswers(data.map((e, i) => ev({ id: `x${i}`, type: e.type!, ...e })), NOW.getTime(), 20);
  const f = m.feedsToday!;
  await expect(page.getByTestId('q-feedsToday')).toContainText(`${f.today} עד עכשיו`);
  await expect(page.getByTestId('q-feedsToday')).toContainText(`יום רגיל, עד שעה כזו: ${f.usualByNow}`);
  await expect(page.getByTestId('q-feedsToday-trend')).toHaveText({ same: 'כמו ביום רגיל אצלכם', more: 'יותר מהרגיל אצלכם עד עכשיו', less: 'פחות מהרגיל אצלכם עד עכשיו' }[f.trend]);
  await expect(page.getByTestId('q-nextFeed')).toContainText(`בסביבות השעה ${formatLocal(m.nextFeed!.at).slice(11, 16)}`);
  await expect(page.getByTestId('q-nextFeed')).toContainText('הערכה לפי הקצב שלכם בלבד, לא המלצה');
  await expect(page.getByTestId('q-sides')).toContainText('כמעט שווה'); // every feed is left and then right
  await page.getByTestId('q-sides-about').click();
  await expect(page.getByTestId('q-how-sheet')).toContainText('באיזה צד הייתה ההנקה האחרונה');
  await expect(page.getByTestId('q-how-sheet')).toContainText('האיזון בין צדדי ההנקה השבוע');
  await expect(page.getByTestId('q-how-sheet')).toContainText('בביסוס ובשימור אספקת החלב');
  await page.getByTestId('q-how-close').click();
  const c = m.cluster!;
  await expect(page.getByTestId('q-cluster')).toContainText(c.days === 0 ? 'ההאכלות סדירות' : c.days <= 2 ? 'מדי פעם' : 'יש נטייה להתקבצות הנקות');
  await expect(page.getByTestId('q-cluster')).toContainText('Cluster feeding');
  await expect(page.getByTestId('q-cluster-days').locator('.on')).toHaveCount(c.days);
  await expect(page.getByTestId('q-nightTrend')).toContainText('בערך אותו דבר'); // the same two stretches every night
  await expect(page.getByTestId('q-nightTrend').locator('.spark > div')).toHaveCount(m.nightTrend!.nights.length);
  await expect(page.getByTestId('q-sleepDay')).toContainText(`${hm(m.sleepDay!.usual.median)} בדרך כלל`);
  // (owner) "שנת הלילה", "בסביבות השעה"
  await expect(page.getByTestId('q-nightStart')).toContainText('מתי מתחילה שנת הלילה?');
  await expect(page.getByTestId('q-nightStart')).toContainText('בסביבות השעה 22:00');
  // (owner) the sleep label says what it compares, about the baby
  await expect(page.getByTestId('q-sleepDay-trend')).toHaveText({ same: 'אתמול התינוק ישן בערך כמו ביום רגיל אצלכם', more: 'אתמול התינוק ישן יותר מביום רגיל אצלכם', less: 'אתמול התינוק ישן פחות מביום רגיל אצלכם' }[m.sleepDay!.trend]);
  await expect(page.getByTestId('q-lastPoop')).toContainText(`לפני ${hm(m.lastPoop!.sinceMin)}`);
  await expect(page.getByTestId('q-diapersToday')).toContainText(`${m.diapersToday!.wet.today} פיפי · ${m.diapersToday!.poop.today} קקי`);
  await expect(page.getByTestId('q-unusual')).toContainText(m.unusual!.notes.length ? 'יש הבדל' : 'דומה לרגיל');
  // a clear difference is in the warning colour; "the same as usual" is quiet
  const tone = await page.getByTestId('q-feedsToday-trend').getAttribute('data-tone');
  expect(tone).toBe(f.trend === 'same' ? 'same' : 'note');
});

test('questions, stage B: fewer feeds today than usual is said, in the warning colour, also under "היום חריג"', async ({ page, request }) => {
  // the regular week without today's feeds after midnight: by 10:00 a usual day has several
  const data = week().filter((e) => !(e.type === 'feed' && e.start! >= '2026-11-15 00:00'));
  await seed(request, data);
  await page.clock.setFixedTime(NOW);
  await install(page);
  await openInsights(page);
  await expect(page.getByTestId('q-feedsToday-trend')).toHaveText('פחות מהרגיל אצלכם עד עכשיו');
  await expect(page.getByTestId('q-feedsToday-trend')).toHaveAttribute('data-tone', 'note');
  await expect(page.getByTestId('q-unusual')).toContainText('יש הבדל');
  await expect(page.getByTestId('q-unusual-feeds')).toHaveText('פחות האכלות מהרגיל עד עכשיו');
});

// (owner) cluster feeding: friendly words (a tendency, the usual hours, how many days), the English term, and what it means
test('questions: cluster feeding says when and how often, and "מה זה אומר?" explains it and why it is worth knowing', async ({ page, request }) => {
  const data = week();
  // three evenings with a feed every hour from 18:00 to 21:00
  for (const d of ['2026-11-10', '2026-11-12', '2026-11-13']) for (const h of ['18:00', '19:00', '20:00', '21:00']) data.push({ type: 'feed', detail: 'left', start: `${d} ${h}` });
  await seed(request, data);
  await page.clock.setFixedTime(NOW);
  await install(page);
  await openInsights(page);
  const card = page.getByTestId('q-cluster');
  await expect(card).toContainText('יש התקבצות הנקות?');
  await expect(card).toContainText('יש נטייה להתקבצות הנקות');
  await expect(card).toContainText('ב-3 מתוך 7 הימים האחרונים');
  await expect(card).toContainText('בשעות האלה צפויות כמה הנקות קרובות זו לזו');
  await expect(card).not.toContainText('לא בולט');
  await expect(page.getByTestId('q-cluster-days').locator('.on')).toHaveCount(3);
  await page.getByTestId('q-cluster-about').click();
  const sheet = page.getByTestId('q-how-sheet');
  await expect(sheet).toContainText('מה זה אומר?');
  await expect(sheet).toContainText('Cluster feeding');
  await expect(page.getByTestId('q-about-part')).toHaveText([/^מה זה.*הנקת צבר.*התינוק רוצה לינוק שוב ושוב.*קפיצות גדילה/, /^למה כדאי לדעת\s*הכרטיס עוזר לראות אם מדובר בדפוס שחוזר.*להתכונן/, /^אם משהו מדאיג/]);
  await expect(sheet).toContainText('איך זה מחושב');
  await expect(page.getByTestId('q-how-disclaimer')).toBeVisible();
});

// (owner) every card explains what it is and why it is worth knowing, and closes with where to turn if something worries you
test('questions: every card has "מה זה אומר?" with what it is, why it is worth knowing, if something worries you, and the note', async ({ page, request }) => {
  await seed(request, week());
  await page.clock.setFixedTime(NOW);
  await install(page);
  await openInsights(page);
  const ids = await page.locator('.q[data-q]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.q!));
  expect(ids).toHaveLength(13);
  for (const id of ids) {
    await page.getByTestId(`q-${id}-about`).click();
    const titles = await page.getByTestId('q-about-part').locator('h3').allTextContents();
    expect(titles, id).toEqual(['מה זה', 'למה כדאי לדעת', 'אם משהו מדאיג']);
    await expect(page.getByTestId('q-how-disclaimer'), id).toContainText('לא ייעוץ רפואי');
    await page.getByTestId('q-how-close').click();
  }
});

// (owner) the usual gap by part of the day is part of "כל כמה שעות מאכילים?" (the part we are in framed); the next-feed card shows only
// the estimate and the part of the day it comes from, and comes first
test('questions: the parts of the day are in the feed-gap card, the next feed only shows its estimate and part, and comes first', async ({ page, request }) => {
  const data = week();
  await seed(request, data);
  await page.clock.setFixedTime(NOW);
  await install(page);
  await openInsights(page);
  const m = moreAnswers(data.map((e, i) => ev({ id: `x${i}`, type: e.type!, ...e })), NOW.getTime(), 20);
  const n = m.nextFeed!;
  const gaps = page.getByTestId('q-gaps');
  await expect(gaps.getByTestId('q-gaps-parts').locator('> div')).toHaveCount(6);
  await expect(gaps.getByTestId('q-part-2')).toHaveClass(/\bcur\b/); // 10:00: "בבוקר", 08:00 to 12:00
  for (const [k, p] of m.feedParts!.entries()) await expect(gaps.getByTestId(`q-part-${k}`)).toContainText(p.median === null ? 'אין מספיק' : p.median < 60 ? `כל ${Math.round(p.median)} דק׳` : `כל ${hm(p.median)} שעות`);
  const next = page.getByTestId('q-nextFeed');
  await expect(next.locator('.parts')).toHaveCount(0);
  await expect(next).toContainText(`בסביבות השעה ${formatLocal(n.at).slice(11, 16)}`);
  // (owner) about the baby, the gap in words ("שעה ו-50 דקות")
  await expect(next).toContainText(`התינוק אוכל בדרך כלל כל ${durationHe(n.gapMin)}`);
  await page.getByTestId('q-nextFeed-about').click();
  await expect(page.getByTestId('q-about-part').first()).toContainText('הערכה מתי סביר שהתינוק יהיה שוב רעב');
  await page.getByTestId('q-how-close').click();
  // a girl: the same sentences in her words
  await api(request, { action: 'settings', set: { babySex: 'girl' } });
  await page.reload();
  await openInsights(page);
  await expect(page.getByTestId('q-nextFeed')).toContainText(`התינוקת אוכלת בדרך כלל כל ${durationHe(n.gapMin)}`);
  await page.getByTestId('q-nextFeed-about').click();
  await expect(page.getByTestId('q-about-part').first()).toContainText('הערכה מתי סביר שהתינוקת תהיה שוב רעבה');
  const order = await page.locator('.q[data-q]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.q));
  expect(order.indexOf('nextFeed')).toBeLessThan(order.indexOf('gaps'));
});

// (owner bug, iPhone) the explanation sheet was covered by the tab bar and "הבנתי" could not be tapped: on iOS a tab's scrolling
// area is its own stacking layer, so the sheet must not be drawn inside it
test('questions: the explanation sheet is drawn above the tab bar, and "הבנתי" can be tapped after scrolling, at 852 / 700 / 560', async ({ page, request }) => {
  await seed(request, week());
  await page.clock.setFixedTime(NOW);
  for (const h of [852, 700, 560]) {
    await page.setViewportSize({ width: 375, height: h });
    if (h === 852) await install(page);
    else await page.reload();
    await openInsights(page);
    await page.getByTestId('q-nextFeed-about').click();
    await expect(page.getByTestId('q-how-sheet')).toBeVisible();
    await expect(page.locator('.main [data-testid="q-how-sheet"]')).toHaveCount(0);
    await page.locator('[data-testid="q-how-sheet"] .sheet').evaluate((s) => s.scrollBy(0, 5000));
    const box = (await page.getByTestId('q-how-close').boundingBox())!;
    const tabs = (await page.locator('nav.tabs').boundingBox())!;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid]')?.getAttribute('data-testid'), [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit, `at ${h}`).toBe('q-how-close');
    expect(box.y + box.height, `the button is not under the tab bar area at ${h}`).toBeLessThanOrEqual(page.viewportSize()!.height);
    void tabs;
    await page.getByTestId('q-how-close').click();
    await expect(page.getByTestId('q-how-sheet')).toHaveCount(0);
  }
});
