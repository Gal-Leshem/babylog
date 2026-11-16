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
