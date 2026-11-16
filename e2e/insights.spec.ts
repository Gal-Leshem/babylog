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
  await expect(page.getByTestId('ins-gaps')).toContainText('ביום מאכילים בדרך כלל כל 2:30');
  await expect(page.getByTestId('ins-gaps')).toContainText('בלילה: בדרך כלל כל 3:15');
  await expect(page.getByTestId('ins-poop')).toContainText('קקי מגיע בדרך כלל כ-20 דק׳ אחרי תחילת האכלה');
  await expect(page.getByTestId('ins-diaper')).toContainText('מחליפים חיתול בדרך כלל אחרי כ-15 דק׳');
  await expect(page.getByTestId('ins-night')).toContainText('הרצף הארוך בלילה: בדרך כלל 3:40');
  await expect(page.getByTestId('ins-night')).toContainText('מתחיל בדרך כלל בסביבות 22:00');
  await expect(page.getByTestId('ins-night')).toContainText('רצפים של 3 שעות ומעלה: בדרך כלל שניים בלילה');
  await expect(page.getByTestId('ins-night')).toContainText('הלילה האחרון: 3:40, 3:05');
  await expect(page.getByTestId('insights')).toContainText('מ-8.11 עד 14.11');
});

test('insights: an empty log says there is not enough data yet, and the chosen view is remembered', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await install(page);
  await page.getByTestId('tab-summary').click();
  await page.getByTestId('view-insights').click();
  await expect(page.getByTestId('ins-empty')).toBeVisible();
  await expect(page.locator('.ins')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('tab-summary').click();
  await expect(page.getByTestId('view-insights')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('insights')).toBeVisible();
  await page.getByTestId('view-day').click();
  await expect(page.getByTestId('day-summary')).toBeVisible();
});

test('insights: a timeline row per day from 06:00, right to left, and daily count bars', async ({ page, request }) => {
  await seed(request, week());
  await page.clock.setFixedTime(NOW);
  await install(page);
  await page.getByTestId('tab-summary').click();
  await page.getByTestId('view-insights').click();
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
  // daily counts: 7 bars each, oldest on the right
  const feedBars = page.getByTestId('cnt-feeds').locator('.bar');
  await expect(feedBars).toHaveCount(7);
  const first = await box(feedBars.first());
  const last = await box(feedBars.last());
  expect(first.x).toBeGreaterThan(last.x);
  await expect(page.getByTestId('cnt-sleep').locator('.bn').first()).toHaveText('2'); // Nov 8: only 22:00-24:00 (the week starts that evening)
  await expect(page.getByTestId('cnt-sleep').locator('.bn').nth(1)).toHaveText('7'); // 1:40 + 3:05 + 2:00
});

// Owner: pee and poop dots were hard to tell apart. Pee is a yellow ring, poop a brown filled dot (shape works in the red theme too);
// "פיפי + קקי" is drawn as poop.
test('timeline: pee and poop look different, and pee + poop is drawn as poop', async ({ page, request }) => {
  await seed(request, [
    { type: 'diaper', detail: 'wet', start: '2026-11-14 09:00' },
    { type: 'diaper', detail: 'poop', start: '2026-11-14 12:00' },
    { type: 'diaper', detail: 'both', start: '2026-11-14 15:00' },
  ]);
  await page.clock.setFixedTime(NOW);
  await install(page);
  await page.getByTestId('tab-summary').click();
  await page.getByTestId('view-insights').click();
  const dots = page.getByTestId('tl-row').nth(1).getByTestId('tl-diaper');
  await expect(dots).toHaveCount(3);
  const look = (i: number) =>
    dots.nth(i).evaluate((e) => {
      const s = getComputedStyle(e);
      return { kind: e.getAttribute('data-kind'), fill: s.backgroundColor, ring: s.borderTopColor, ringWidth: s.borderTopWidth };
    });
  const [pee, poop, both] = [await look(0), await look(1), await look(2)];
  expect([pee.kind, poop.kind, both.kind]).toEqual(['pee', 'poop', 'poop']);
  expect(both).toEqual(poop);
  expect(pee.fill).toBe('rgba(0, 0, 0, 0)'); // a ring
  expect(pee.ringWidth).not.toBe('0px');
  expect(poop.fill).not.toBe('rgba(0, 0, 0, 0)'); // filled
  const rgb = (c: string) => c.match(/\d+/g)!.slice(0, 3).map(Number);
  const [pr, pg, pb] = rgb(pee.ring);
  const [kr, kg, kb] = rgb(poop.fill);
  expect(Math.abs(pr! - kr!) + Math.abs(pg! - kg!) + Math.abs(pb! - kb!)).toBeGreaterThan(120); // clearly different colours by day
});
