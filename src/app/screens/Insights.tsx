import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { type AfterFeedInsight, type FeedGapInsight, type NightSleepInsight, LONG_STRETCH_MIN, insights } from '../../shared/insights';
import { addDays } from '../../shared/tz';
import { hm } from '../labels';
import { engine, useEngine, useNow } from '../state';

const shortDate = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`;
/** minutes after midnight (may pass 24:00) -> 'HH:MM' */
const clockOf = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
/** ranges in words: a dash between numbers reads backwards in right-to-left text */
const range = (lo: number, hi: number) => (lo === hi ? `סביב ${hm(lo)}` : `בין ${hm(lo)} ל-${hm(hi)}`);

// Plain functions returning JSX (no components defined inside components).
function card(id: string, icon: string, title: string, lines: (string | false)[]): JSX.Element {
  return (
    <div class="ins" data-testid={`ins-${id}`} key={id}>
      <div class="it">
        <span class="emo">{icon}</span> {title}
      </div>
      {lines.filter(Boolean).map((l) => (
        <div class="ie" key={l as string}>
          {l}
        </div>
      ))}
    </div>
  );
}

function feedGapCard(g: FeedGapInsight): JSX.Element {
  const main = g.day ?? g.all;
  return card('gaps', '🤱', `${g.day ? 'ביום' : ''} מאכילים בדרך כלל כל ${hm(main.median)}`.trim(), [
    `רוב הרווחים${g.day ? ' ביום' : ''} ${range(main.low, main.high)}`,
    g.night !== null && `בלילה: בדרך כלל כל ${hm(g.night.median)} (רוב הרווחים ${range(g.night.low, g.night.high)})`,
    `לפי ${g.all.n} רווחים, מתחילת האכלה לתחילת הבאה`,
  ]);
}

function poopCard(p: AfterFeedInsight): JSX.Element {
  return card('poop', '💩', `קקי מגיע בדרך כלל כ-${p.lagMin} דק׳ אחרי תחילת האכלה`, [`${p.hits} מתוך ${p.total} הפעמים היו תוך שעה מתחילת האכלה`]);
}

function diaperCard(d: AfterFeedInsight): JSX.Element {
  return card('diaper', '💧', `אחרי האכלה מחליפים חיתול בדרך כלל אחרי כ-${d.lagMin} דק׳`, [`ב-${d.hits} מתוך ${d.total} האכלות הוחלף חיתול תוך שעה`]);
}

function nightCard(n: NightSleepInsight): JSX.Element {
  const long = LONG_STRETCH_MIN / 60;
  const starts = n.startLow === n.startHigh ? `בסביבות ${clockOf(n.startLow)}` : `בין ${clockOf(n.startLow)} ל-${clockOf(n.startHigh)}`;
  const longLast = n.lastNight.length > 0 && n.lastNight[0]! >= LONG_STRETCH_MIN;
  return card('night', '🌙', `הרצף הארוך בלילה: בדרך כלל ${hm(n.longest.median)}`, [
    `מתחיל בדרך כלל ${starts}`,
    n.nightsWithLong === 0
      ? `רצף של ${long} שעות ומעלה: עדיין לא היה ב-${n.nights} הלילות האחרונים`
      : `רצפים של ${long} שעות ומעלה: בדרך כלל ${n.longPerNight === 1 ? 'אחד' : n.longPerNight === 2 ? 'שניים' : n.longPerNight} בלילה · היה לפחות אחד ב-${n.nightsWithLong} מתוך ${n.nights} לילות` +
        (n.nightsWithTwoLong > 0 ? `, שניים ומעלה ב-${n.nightsWithTwoLong}` : ''),
    longLast ? `הלילה האחרון: ${n.lastNight.map(hm).join(', ')}` : `הלילה האחרון: הרצף הארוך ${hm(n.lastNight[0] ?? 0)}`,
  ]);
}

/** "תובנות": patterns from the last 7 full days. An insight is shown only when there is enough data for it. */
export function Insights() {
  const { events, settings } = useEngine();
  const now = useNow(60_000);
  const r = insights(events, now, settings.mergeWindowMin);

  useEffect(() => {
    const from = addDays(r.from, -1);
    if (from < engine.defaultRange().from) void engine.ensureRange(from, r.to);
  }, [r.from]);

  const cards = [
    r.feedGaps && feedGapCard(r.feedGaps),
    r.poopAfterFeed && poopCard(r.poopAfterFeed),
    r.diaperAfterFeed && diaperCard(r.diaperAfterFeed),
    r.nightSleep && nightCard(r.nightSleep),
  ].filter(Boolean);

  return (
    <div data-testid="insights">
      {cards.length ? cards : <p class="empty" data-testid="ins-empty">עוד אין מספיק נתונים. אחרי כמה ימים של רישום יופיעו כאן תובנות.</p>}
      <p class="muted">
        לפי 7 הימים המלאים האחרונים, מ-{shortDate(r.from)} עד {shortDate(r.to)} (בלי היום). לילה: מ-19:00 עד 07:00. תובנה מופיעה רק כשיש לה מספיק
        נתונים.
      </p>
    </div>
  );
}
