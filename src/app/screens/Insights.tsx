import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Insights as InsightsData, LONG_STRETCH_MIN, insights } from '../../shared/insights';
import { FEED_PART_HOURS, type MoreAnswers, type Trend, moreAnswers } from '../../shared/questions-data';
import { formatLocal, localHour as localHourOf } from '../../shared/tz';

/** a wall-clock time as HH:MM ("00:48", never "0:48", which reads like a duration) */
const hhmm = (t: number) => formatLocal(t).slice(11, 16);
import { addDays } from '../../shared/tz';
import { hm } from '../labels';
import { durationHe } from '../../shared/speech';
import { type AllData, CATEGORIES, IF_WORRIED, NOT_MEDICAL, type Question, type QuestionId, allQuestions, questionState } from '../questions';
import { type Feeding, bottleKindsOn, feedingOf } from '../../shared/bottle';
import { count, engine, hideToast, setQuestion, showToast, useEngine, useNow, usePrefs } from '../state';
import { Feedback } from './Feedback';
import { overlay } from '../overlay';
import type { UsageName } from '../../shared/usage';
import { type BabyWords, babyWords } from '../words';

const shortDate = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`;
/** minutes after midnight (may pass 24:00) -> 'HH:MM' */
const clockOf = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
/** ranges in words: a dash between numbers reads backwards in right-to-left text */
const range = (lo: number, hi: number) => (lo === hi ? `סביב ${hm(lo)}` : `בין ${hm(lo)} ל-${hm(hi)}`);
/** the six 4-hour parts of the day for the next-feed estimate (FEED_PART_HOURS) */
const PART_NAMES = ['אחרי חצות', 'לפנות בוקר', 'בבוקר', 'בצהריים', 'אחר הצהריים', 'בערב'];
const partSpan = (k: number) => `${String(k * FEED_PART_HOURS).padStart(2, '0')}:00 עד ${String(((k + 1) * FEED_PART_HOURS) % 24).padStart(2, '0')}:00`;

/** (owner) the usual gap in each part of the day, the part we are in now framed, and the longest and shortest parts. */
function partsGrid(parts: NonNullable<MoreAnswers['feedParts']>, cur: number): JSX.Element {
  const known = parts.map((p, k) => ({ k, median: p.median })).filter((p): p is { k: number; median: number } => p.median !== null);
  const longest = known.length > 1 ? known.reduce((x, y) => (y.median > x.median ? y : x)) : null;
  const shortest = known.length > 1 ? known.reduce((x, y) => (y.median < x.median ? y : x)) : null;
  return (
    <>
      <div class="qsub">לפי חלקי היום</div>
      <div class="parts" data-testid="q-gaps-parts">
        {parts.map((p, k) => (
          <div key={k} class={k === cur ? 'cur' : ''} data-testid={`q-part-${k}`}>
            <div class="k">{PART_NAMES[k]}</div>
            <div class="r">{partSpan(k)}</div>
            <div class="v">
              {p.median === null ? (
                'אין מספיק'
              ) : (
                <>
                  כל {p.median < 60 ? Math.round(p.median) : hm(p.median)} <small>{p.median < 60 ? 'דק׳' : 'שעות'}</small>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {longest && shortest && longest.median - shortest.median >= 30 && (
        <div class="qs" data-testid="q-gaps-range">
          הרווחים הארוכים ביותר: {PART_NAMES[longest.k]} ({withUnit(longest.median)}); הקצרים ביותר: {PART_NAMES[shortest.k]} ({withUnit(shortest.median)})
        </div>
      )}
    </>
  );
}

const WEEKDAY_LETTER = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const weekdayOf = (d: string) => WEEKDAY_LETTER[new Date(`${d}T12:00:00Z`).getUTCDay()]!;
/** A card's "מה זה אומר?" parts, closed by the common "אם משהו מדאיג" unless it has its own. */
const aboutOf = (q: Question, w: BabyWords) => {
  const parts = q.about?.(w) ?? [];
  return parts.some((p) => p.title === IF_WORRIED.title) ? parts : [...parts, IF_WORRIED];
};
/** (owner) a gap with its unit, so "2:50" cannot be read as minutes: "2:50 שעות", or "45 דק׳" under an hour */
const withUnit = (min: number) => (min < 60 ? `${Math.round(min)} דק׳` : `${hm(min)} שעות`);
/** a range of gaps in words, with the unit once at the end: "בין 2:45 ל-3:10 שעות" */
const gapRange = (lo: number, hi: number) => (lo === hi ? `סביב ${withUnit(lo)}` : hi < 60 ? `בין ${Math.round(lo)} ל-${Math.round(hi)} דק׳` : lo < 60 ? `בין ${withUnit(lo)} ל-${withUnit(hi)}` : `בין ${hm(lo)} ל-${hm(hi)} שעות`);
const many = (n: number) => (n === 1 ? 'אחד' : n === 2 ? 'שניים' : String(n));

// Plain functions returning JSX (no components defined inside components).

/** The answer of a question that has enough data (also "no clear pattern" for the after-a-feed questions). */
function answerFirst(q: Question, r: InsightsData, m: MoreAnswers, now: number): JSX.Element {
  if (q.id === 'gaps' && r.feedGaps) {
    const g = r.feedGaps;
    const cell = (icon: string, label: string, s: NonNullable<typeof g.day>, id: string) => (
      <div data-testid={`q-gaps-${id}`}>
        <div class="k">
          <span class="emo">{icon}</span> {label}
        </div>
        <div class="v">
          {hm(s.median)} <small>{s.median < 60 ? 'דק׳' : 'שעות'}</small>
        </div>
        {/* the unit is on the big number right above */}
        <div class="r">רוב הרווחים {range(s.low, s.high)}</div>
      </div>
    );
    return (
      <>
        {g.day && g.night ? (
          <div class="pair">
            {cell('☀️', 'ביום', g.day, 'day')}
            {cell('🌙', 'בלילה', g.night, 'night')}
          </div>
        ) : (
          <>
            <div class="qa">
              {withUnit(g.all.median)} <small>בדרך כלל</small>
            </div>
            <div class="qs">רוב הרווחים {gapRange(g.all.low, g.all.high)}</div>
          </>
        )}
        {m.feedParts && partsGrid(m.feedParts, Math.floor(localHourOf(now) / FEED_PART_HOURS))}
        <div class="qbasis">לפי {g.all.n} רווחים, מתחילת האכלה לתחילת הבאה</div>
      </>
    );
  }
  if (q.id === 'night' && r.nightSleep) {
    const n = r.nightSleep;
    const long = LONG_STRETCH_MIN / 60;
    const starts = n.startLow === n.startHigh ? `בסביבות השעה ${clockOf(n.startLow)}` : `בין ${clockOf(n.startLow)} ל-${clockOf(n.startHigh)}`;
    const longLast = n.lastNight.length > 0 && n.lastNight[0]! >= LONG_STRETCH_MIN;
    return (
      <>
        <div class="qa">
          {hm(n.longest.median)} <small>בדרך כלל</small>
        </div>
        <div class="qs">מתחיל בדרך כלל {starts}</div>
        <div class="qs">
          {n.nightsWithLong === 0
            ? `רצף של ${long} שעות ומעלה: עדיין לא היה ב-${n.nights} הלילות האחרונים`
            : `רצפים של ${long} שעות ומעלה: בדרך כלל ${many(n.longPerNight)} בלילה · היה לפחות אחד ב-${n.nightsWithLong} מתוך ${n.nights} לילות` + (n.nightsWithTwoLong > 0 ? `, שניים ומעלה ב-${n.nightsWithTwoLong}` : '')}
        </div>
        <div class="qs">{longLast ? `הלילה האחרון: ${n.lastNight.map(hm).join(', ')}` : `הלילה האחרון: הרצף הארוך ${hm(n.lastNight[0] ?? 0)}`}</div>
        <div class="qbasis">לפי {n.nights} לילות</div>
      </>
    );
  }
  if (q.id === 'poop') {
    const a = r.poopAfterFeed;
    if (!a)
      return (
        <>
          <div class="qa">אין קשר ברור</div>
          <div class="qs">קקי לא מגיע אחרי האכלה יותר מאשר בשעות אחרות</div>
        </>
      );
    return (
      <>
        <div class="qa">
          כ-{a.lagMin} דק׳ <small>אחרי תחילת האכלה</small>
        </div>
        <div class="qs">{`${a.hits} מתוך ${a.total} הפעמים היו תוך שעה מתחילת האכלה`}</div>
      </>
    );
  }
  return <div class="qs">אין תשובה כרגע</div>;
}

/** A label under an answer: the same as usual for you (quiet), or clearly more / less (warning colour); never good or bad. */
function chip(tone: 'same' | 'up' | 'note', text: string, id: string): JSX.Element {
  return (
    <span class={`tr ${tone}`} data-testid={id} data-tone={tone} key={id}>
      {text}
    </span>
  );
}
const toneOf = (t: Trend): 'same' | 'note' => (t === 'same' ? 'same' : 'note');
const more = (t: Trend, more: string, less: string, same: string) => (t === 'more' ? more : t === 'less' ? less : same);
/** an elapsed time in words-friendly form: "35 דק׳" under an hour, else H:MM */
const since = (min: number) => (min < 60 ? `${min} דק׳` : hm(min));

/** Today against a usual day by this hour: the count, a bar with the usual-by-now mark, and the whole day's usual. */
function todayBar(today: number, byNow: number, whole: number): JSX.Element {
  const scale = Math.max(whole, today, 1);
  return (
    <>
      <div class="vbar" aria-hidden="true">
        <i style={{ width: `${Math.round((today / scale) * 100)}%` }} />
        <b style={{ right: `${Math.round((byNow / scale) * 100)}%` }} />
      </div>
      <div class="vlab">
        <span>יום רגיל, עד שעה כזו: {byNow}</span>
        <span>ביום שלם: {whole}</span>
      </div>
    </>
  );
}

const UNUSUAL: Record<'feeds' | 'wet' | 'poop' | 'night' | 'bottleMl', [string, string]> = {
  feeds: ['יותר האכלות מהרגיל עד עכשיו', 'פחות האכלות מהרגיל עד עכשיו'],
  wet: ['יותר פיפי מהרגיל עד עכשיו', 'פחות פיפי מהרגיל עד עכשיו'],
  poop: ['יותר קקי מהרגיל עד עכשיו', 'פחות קקי מהרגיל עד עכשיו'],
  night: ['הרצף הארוך בלילה האחרון ארוך מהרגיל', 'הרצף הארוך בלילה האחרון קצר מהרגיל'],
  bottleMl: ['יותר מ״ל בבקבוקים מהרגיל עד עכשיו', 'פחות מ״ל בבקבוקים מהרגיל עד עכשיו'],
};

/** The answer of a newer question that has enough data (stage B). */
function answerMore(q: Question, m: MoreAnswers, now: number, w: BabyWords, feeding: Feeding): JSX.Element {
  switch (q.id) {
    case 'feedsToday': {
      const f = m.feedsToday!;
      return (
        <>
          <div class="qa">
            {f.today} <small>עד עכשיו</small>
          </div>
          {/* (owner) only when the family both nurses and gives bottles (sensitive: not every mother can nurse) */}
          {feeding.breast && bottleKindsOn(feeding).length > 0 && f.today > 0 && (
            <div class="qs" data-testid="q-feedsToday-bottles">
              {f.withBottle === 0 ? 'אף אחת עם בקבוק' : f.withBottle === 1 ? 'מתוכן אחת עם בקבוק' : `מתוכן ${f.withBottle} עם בקבוק`}
            </div>
          )}
          {todayBar(f.today, f.usualByNow, f.usualDay)}
          <div class="qf">{chip(toneOf(f.trend), more(f.trend, 'יותר מהרגיל אצלכם עד עכשיו', 'פחות מהרגיל אצלכם עד עכשיו', 'כמו ביום רגיל אצלכם'), 'q-feedsToday-trend')}</div>
        </>
      );
    }
    case 'nextFeed': {
      // (owner) only the estimate and the part of the day it comes from; the parts side by side live in "כל כמה שעות מאכילים?"
      const n = m.nextFeed!;
      // (owner) about the baby, and the gap in words: "בבוקר (08:00 עד 12:00) התינוק אוכל בדרך כלל כל שעה ו-50 דקות"
      const basis =
        n.basis === 'part'
          ? `${PART_NAMES[n.part]} (${partSpan(n.part)}) ${w.baby} ${w.eats} בדרך כלל כל ${durationHe(n.gapMin)}`
          : `${n.basis === 'night' ? 'בלילה' : n.basis === 'day' ? 'ביום' : 'בדרך כלל'} ${w.baby} ${w.eats} כל ${durationHe(n.gapMin)} (לחלק הזה של היום עוד אין מספיק נתונים משלו)`;
      if (n.last === null) return <div class="qa small">אין האכלה רשומה ב-12 השעות האחרונות</div>;
      return (
        <>
          <div class="qa">
            בסביבות השעה <bdi>{hhmm(n.at)}</bdi>
          </div>
          <div class="qs">
            ההאכלה האחרונה ב-<bdi>{hhmm(n.last)}</bdi> · {basis}
          </div>
          {n.at < now && <div class="qs">השעה הזו כבר עברה</div>}
          <div class="qbasis">הערכה לפי הקצב שלכם בלבד, לא המלצה</div>
        </>
      );
    }
    case 'sides': {
      const s = m.sides!;
      const right = Math.round((s.right / (s.left + s.right)) * 100);
      return (
        <>
          <div class="qa">{Math.abs(right - 50) <= 10 ? 'כמעט שווה' : right > 50 ? 'יותר ימין' : 'יותר שמאל'}</div>
          <div class="split" aria-hidden="true">
            <i style={{ flex: right }} />
            <i style={{ flex: 100 - right }} />
          </div>
          <div class="vlab">
            <span>ימין {right}%</span>
            <span>שמאל {100 - right}%</span>
          </div>
          <div class="qbasis">לפי {s.left + s.right} הנקות ב-7 ימים</div>
        </>
      );
    }
    case 'cluster': {
      // (owner) in words a parent can use: regular, now and then, or a tendency, with the usual hours and how often
      const c = m.cluster!;
      const dots = (
        <div class="dots" aria-hidden="true" data-testid="q-cluster-days">
          {c.byDay.map((d) => (
            <div key={d.date} class={d.run ? 'on' : ''}>
              <i />
              <em>{weekdayOf(d.date)}</em>
            </div>
          ))}
        </div>
      );
      const hours = c.from === c.to ? `בסביבות השעה ${clockOf(c.from)}` : `בדרך כלל בין ${clockOf(c.from)} ל-${clockOf(c.to)}`;
      if (c.days === 0)
        return (
          <>
            <div class="qa small">ההאכלות סדירות</div>
            <div class="qs">ב-7 הימים האחרונים לא היו שעות של הנקות צפופות{c.usualGap ? `; בדרך כלל מאכילים כל ${withUnit(c.usualGap)}` : ''}.</div>
            {dots}
          </>
        );
      if (c.days <= 2)
        return (
          <>
            <div class="qa small">מדי פעם</div>
            <div class="qs">
              ב-{c.days} מתוך 7 הימים האחרונים היו כמה שעות של הנקות צפופות, {hours}.
            </div>
            {dots}
          </>
        );
      return (
        <>
          <div class="qa small">יש נטייה להתקבצות הנקות</div>
          <div class="qs">
            {hours}, ב-{c.days} מתוך 7 הימים האחרונים.
          </div>
          <div class="qs">בשעות האלה צפויות כמה הנקות קרובות זו לזו, וכדאי להתכונן אליהן מראש.</div>
          {dots}
        </>
      );
    }
    case 'nightTrend': {
      const n = m.nightTrend!;
      const max = Math.max(...n.nights, 1);
      const diff = Math.abs(n.recent - n.before);
      return (
        <>
          <div class="qa">
            {more(n.trend, 'כן', 'מתקצר', 'בערך אותו דבר')} <small>{hm(n.nights[n.nights.length - 1]!)} בלילה האחרון</small>
          </div>
          <div class="spark" aria-hidden="true">
            {n.nights.map((v, i) => (
              <div class={i === n.nights.length - 1 ? 'last' : ''} key={i}>
                <span style={{ height: `${Math.max(4, Math.round((v / max) * 100))}%` }} />
              </div>
            ))}
          </div>
          {n.trend !== 'same' && (
            <div class="qf">
              {chip(n.trend === 'more' ? 'up' : 'note', n.trend === 'more' ? `↗ 3 הלילות האחרונים ארוכים ב-${diff} דק׳` : `↘ 3 הלילות האחרונים קצרים ב-${diff} דק׳`, 'q-nightTrend-trend')}
            </div>
          )}
          <div class="qbasis">לפי {n.nights.length} לילות, הישן ביותר מימין</div>
        </>
      );
    }
    case 'sleepDay': {
      const s = m.sleepDay!;
      return (
        <>
          <div class="qa">
            {hm(s.usual.median)} <small>בדרך כלל</small>
          </div>
          <div class="qs">רוב הימים {range(s.usual.low, s.usual.high)} · אתמול {hm(s.yesterday)}</div>
          <div class="qf">{chip(toneOf(s.trend), more(s.trend, `אתמול ${w.baby} ${w.slept} יותר מביום רגיל אצלכם`, `אתמול ${w.baby} ${w.slept} פחות מביום רגיל אצלכם`, `אתמול ${w.baby} ${w.slept} בערך כמו ביום רגיל אצלכם`), 'q-sleepDay-trend')}</div>
        </>
      );
    }
    case 'nightStart': {
      const n = m.nightStart!;
      return (
        <>
          <div class="qa">
            בסביבות השעה <bdi>{clockOf(n.median)}</bdi>
          </div>
          <div class="qs">{n.low === n.high ? 'כמעט באותה שעה כל ערב' : `בדרך כלל שנת הלילה מתחילה בין ${clockOf(n.low)} ל-${clockOf(n.high)}`}</div>
          <div class="qbasis">לפי {n.nights} לילות</div>
        </>
      );
    }
    case 'lastPoop': {
      const l = m.lastPoop!;
      return (
        <>
          <div class="qa">
            לפני {since(l.sinceMin)} <small>{l.sinceMin < 60 ? '' : 'שעות'}</small>
          </div>
          <div class="qs">בדרך כלל {range(l.gap.low, l.gap.high)} שעות בין קקי לקקי</div>
          <div class="qf">{chip(toneOf(l.trend), l.trend === 'more' ? 'יותר זמן מהרגיל אצלכם' : 'בטווח הרגיל אצלכם', 'q-lastPoop-trend')}</div>
        </>
      );
    }
    case 'diapersToday': {
      const d = m.diapersToday!;
      const notes = [d.wet.trend !== 'same' && chip('note', more(d.wet.trend, 'יותר פיפי מהרגיל עד עכשיו', 'פחות פיפי מהרגיל עד עכשיו', ''), 'q-wet-trend'), d.poop.trend !== 'same' && chip('note', more(d.poop.trend, 'יותר קקי מהרגיל עד עכשיו', 'פחות קקי מהרגיל עד עכשיו', ''), 'q-poop-trend')].filter(Boolean);
      return (
        <>
          <div class="qa">
            {d.wet.today} פיפי · {d.poop.today} קקי <small>עד עכשיו</small>
          </div>
          <div class="qs">
            יום רגיל, עד שעה כזו: {d.wet.usualByNow} פיפי · {d.poop.usualByNow} קקי
          </div>
          <div class="qf wrap">{notes.length ? notes : chip('same', 'כמו ביום רגיל אצלכם', 'q-diapers-trend')}</div>
        </>
      );
    }
    case 'unusual': {
      const u = m.unusual!;
      if (!u.notes.length)
        return (
          <>
            <div class="qa">דומה לרגיל</div>
            <div class="qs">האכלות, פיפי וקקי עד עכשיו, והרצף הארוך בלילה האחרון, בטווח הרגיל אצלכם</div>
          </>
        );
      return (
        <>
          <div class="qa">יש הבדל</div>
          <div class="qf wrap">{u.notes.map((n) => chip('note', UNUSUAL[n.what][n.trend === 'more' ? 0 : 1], `q-unusual-${n.what}`))}</div>
        </>
      );
    }
    case 'bottlesToday': {
      const b = m.bottlesToday!;
      const notes = [b.count.trend !== 'same' && chip('note', more(b.count.trend, 'יותר בקבוקים מהרגיל עד עכשיו', 'פחות בקבוקים מהרגיל עד עכשיו', ''), 'q-bottles-trend'), b.ml.trend !== 'same' && chip('note', more(b.ml.trend, 'יותר מ״ל מהרגיל עד עכשיו', 'פחות מ״ל מהרגיל עד עכשיו', ''), 'q-bottleMl-trend')].filter(Boolean);
      return (
        <>
          <div class="qa">
            {b.count.today} {b.count.today === 1 ? 'בקבוק' : 'בקבוקים'} · {b.ml.today} מ״ל <small>עד עכשיו</small>
          </div>
          <div class="qs">
            יום רגיל, עד שעה כזו: {b.count.usualByNow} {b.count.usualByNow === 1 ? 'בקבוק' : 'בקבוקים'} · {b.ml.usualByNow} מ״ל
          </div>
          <div class="qs">ביום שלם: {b.ml.usualDay} מ״ל</div>
          <div class="qf wrap">{notes.length ? notes : chip('same', 'כמו ביום רגיל אצלכם', 'q-bottlesToday-trend')}</div>
        </>
      );
    }
    case 'bottleSize': {
      // (F18) per bottle kind: a top-up of expressed milk and a formula bottle are different sizes
      const list = m.bottleSize!;
      const name = (k: string) => (k === 'formula' ? 'תמ״ל' : 'חלב שאוב');
      // the bars show a kind whose size changed, if any (a steady top-up says little), else the kind with the most bottles
      const main = list.find((b) => b.trend !== 'same') ?? list[0]!;
      const max = Math.max(...main.byDay.map((d) => d.ml), 1);
      return (
        <>
          {list.map((b) => (
            <div class="qa" key={b.kind} data-testid={`q-bottleSize-${b.kind}`}>
              {b.usual} מ״ל <small>בדרך כלל, {name(b.kind)}</small>
            </div>
          ))}
          <div class="spark" aria-hidden="true">
            {main.byDay.map((d, i) => (
              <div class={i === main.byDay.length - 1 ? 'last' : ''} key={d.date}>
                <span style={{ height: `${Math.max(4, Math.round((d.ml / max) * 100))}%` }} />
              </div>
            ))}
          </div>
          {list
            .filter((b) => b.trend !== 'same')
            .map((b) => (
              <div class="qf" key={b.kind}>
                {chip('note', `${b.trend === 'more' ? '↗' : '↘'} ${name(b.kind)}: בימים האחרונים כ-${b.recent} מ״ל, ${b.trend === 'more' ? 'יותר' : 'פחות'} מקודם (${b.before})`, `q-bottleSize-trend-${b.kind}`)}
              </div>
            ))}
          <div class="qbasis">
            העמודות: {name(main.kind)}, לפי {main.byDay.length} ימים, הישן ביותר מימין
          </div>
        </>
      );
    }
    case 'bottleShare': {
      const b = m.bottleShare!;
      return (
        <>
          <div class="qa">
            {b.withBottle} מתוך {b.total} <small>האכלות ב-7 ימים</small>
          </div>
          <div class="qbasis">הנקה ובקבוק קרובים זה לזה הם האכלה אחת</div>
        </>
      );
    }
    default:
      return <div class="qs">אין תשובה כרגע</div>;
  }
}

const FIRST_IDS = new Set<QuestionId>(['gaps', 'night', 'poop']);
const answer = (q: Question, a: AllData, now: number, w: BabyWords, f: Feeding) => (FIRST_IDS.has(q.id) ? answerFirst(q, a.ins, a.more, now) : answerMore(q, a.more, now, w, f));

/** Not enough data yet (shown only for a question the parent turned on by hand): how much there is and how much is needed. */
function waiting(q: Question, a: AllData): JSX.Element {
  const p = q.prog(a);
  return (
    <div class="wait" data-testid={`q-${q.id}-wait`}>
      <div class="ring" style={{ '--p': String(Math.min(100, Math.round((p.have / p.need) * 100))) }}>
        <bdi>
          {p.have}/{p.need}
        </bdi>
      </div>
      <div class="t">
        עוד אין מספיק נתונים
        <small>{q.wait(p)}</small>
      </div>
    </div>
  );
}

const disclaimer = (testId: string) => (
  <div class="disc" data-testid={testId}>
    <span class="emo">ℹ️</span>
    <span>{NOT_MEDICAL}</span>
  </div>
);

const suggestButton = (onClick: () => void) => (
  <button type="button" class="suggest" data-testid="q-suggest" onClick={onClick}>
    <span class="emo">💡</span> חסרה לכם שאלה? הציעו אותה<small>נשלח אלינו דרך המשוב</small>
  </button>
);

/**
 * "תובנות" (owner, F16): patterns from the last 7 full days, as questions with short answers, grouped by topic. A question shows
 * by itself once it has enough data; each parent can hide one ("⋯") or choose them in "בחירת שאלות" (kept on this phone).
 */
export function Insights() {
  const { events, settings } = useEngine();
  const choices = usePrefs().questions;
  const now = useNow(60_000);
  // Recomputed only when the events change or a minute passes (the engine keeps `events` the same object while nothing changed).
  const feeding = feedingOf(settings);
  const a = useMemo<AllData>(
    () => ({ ins: insights(events, now, settings.mergeWindowMin), more: moreAnswers(events, now, settings.mergeWindowMin, { nursing: feeding.breast }) }),
    [events, now, settings.mergeWindowMin, feeding.breast],
  );
  const questions = allQuestions(feeding);
  const r = a.ins;
  const [mode, setMode] = useState<'cards' | 'pick' | 'suggest'>('cards');
  const [menu, setMenu] = useState<QuestionId | null>(null);
  const [how, setHow] = useState<QuestionId | null>(null);

  // (owner, usage) which question cards actually came into view: an open question nobody looks at is not the same as a useful one
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== 'cards' || typeof IntersectionObserver === 'undefined' || !listRef.current) return;
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (list) => {
        for (const e of list) {
          const id = (e.target as HTMLElement).dataset.q;
          if (!e.isIntersecting || !id || seen.has(id)) continue;
          seen.add(id);
          count(`seen.${id}` as UsageName);
          io.unobserve(e.target);
        }
      },
      { threshold: 0.6 },
    );
    for (const el of listRef.current.querySelectorAll('.q[data-q]')) io.observe(el);
    return () => io.disconnect();
  }, [mode, choices]);

  useEffect(() => {
    const from = addDays(r.from, -1);
    if (from < engine.defaultRange().from) void engine.ensureRange(from, r.to);
  }, [r.from]);

  const suggest = () => {
    count('questions.suggest');
    setMode('suggest');
  };
  if (mode === 'suggest') return <Feedback onBack={() => setMode('cards')} start={{ kind: 'idea', text: 'שאלה מוצעת: ' }} backLabel="חזרה לתובנות" />;

  const states = questions.map((q) => ({ q, ...questionState(q, a, choices[q.id]) }));

  if (mode === 'pick') {
    return (
      <div class="pick" data-testid="q-picker">
        <div class="actions">
          <button type="button" data-testid="pick-back" onClick={() => setMode('cards')}>
            חזרה לתובנות
          </button>
        </div>
        <h2>בחירת שאלות</h2>
        <p class="muted">הבחירה נשמרת בטלפון הזה בלבד: להורה השני יש בחירה משלו. שאלה שעוד אין לה מספיק נתונים תופיע לבד כשיהיו.</p>
        {CATEGORIES.map((c) => (
          <div key={c.id}>
            <div class="qsec">
              <span class="emo">{c.icon}</span> {c.title}
            </div>
            {states
              .filter((s) => s.q.cat === c.id)
              .map(({ q, ready, shown }) => (
                <div class="prow" key={q.id} data-testid={`pick-${q.id}`}>
                  <div class="t">
                    <b>{q.q}</b>
                    <small>
                      {!shown && q.fits === false && choices[q.id] === undefined
                        ? `${q.desc}. כבויה: לא בסוגי ההאכלה שבהגדרות. אפשר להדליק`
                        : !shown && q.manualOnly && choices[q.id] === undefined
                          ? `${q.desc}. מוצגת רק כשמדליקים אותה`
                          : !shown && !ready && choices[q.id] === undefined
                            ? 'תופיע לבד כשיהיו מספיק נתונים'
                            : q.desc}
                    </small>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shown}
                    aria-label={q.q}
                    class={`sw ${shown ? 'on' : ''}`}
                    data-testid={`pick-${q.id}-switch`}
                    onClick={() => {
                      count(shown ? 'questions.off' : 'questions.on');
                      setQuestion(q.id, shown ? 'off' : 'on');
                    }}
                  />
                </div>
              ))}
          </div>
        ))}
        {suggestButton(suggest)}
      </div>
    );
  }

  const shown = states.filter((s) => s.shown);
  const hide = (id: QuestionId) => {
    const before = choices[id];
    setMenu(null);
    count('questions.hide');
    setQuestion(id, 'off');
    showToast({ text: 'השאלה הוסתרה. אפשר להחזיר אותה ב"בחירת שאלות"', undo: () => setQuestion(id, before) }, 4_500);
  };
  const howQ = questions.find((q) => q.id === how);
  const openHow = (id: QuestionId) => {
    setMenu(null);
    count('questions.how');
    hideToast(); // a sheet opens: the toast would lie over its button
    setHow(id);
  };

  return (
    <div data-testid="insights" ref={listRef}>
      <div class="qbar">
        <span class="qcount" data-testid="q-count">
          {shown.length === 1 ? 'שאלה אחת מוצגת' : `${shown.length} שאלות מוצגות`}
        </span>
        <button
          type="button"
          data-testid="q-pick"
          onClick={() => {
            count('questions.pick');
            setMode('pick');
          }}
        >
          בחירת שאלות
        </button>
      </div>
      {shown.length === 0 && (
        <p class="empty" data-testid="ins-empty">
          עוד אין מספיק נתונים לאף שאלה. כל שאלה תופיע כאן לבד כשיהיו לה מספיק נתונים, ואפשר גם להדליק שאלות ב"בחירת שאלות".
        </p>
      )}
      {CATEGORIES.filter((c) => shown.some((s) => s.q.cat === c.id)).map((c) => (
        <div key={c.id}>
          <div class="qsec">
            <span class="emo">{c.icon}</span> {c.title}
          </div>
          {shown
            .filter((s) => s.q.cat === c.id)
            .map(({ q, ready }) => (
              <div class="q" key={q.id} data-testid={`q-${q.id}`} data-q={q.id}>
                <button type="button" class="qm" aria-label="עוד" data-testid={`q-${q.id}-menu`} onClick={() => setMenu(menu === q.id ? null : q.id)}>
                  ⋯
                </button>
                {menu === q.id && (
                  <div class="qpop" data-testid="q-pop">
                    <button type="button" data-testid="q-hide" onClick={() => hide(q.id)}>
                      <span class="emo">🙈</span> לא להציג יותר
                    </button>
                    <button
                      type="button"
                      data-testid="q-how"
                      onClick={() => openHow(q.id)}
                    >
                      <span class="emo">ℹ️</span> {q.about ? 'מה זה ואיך זה מחושב?' : 'איך זה מחושב?'}
                    </button>
                  </div>
                )}
                <div class="qq">{q.q}</div>
                {q.term && (
                  <div class="qterm">
                    <bdi>{q.term}</bdi>
                  </div>
                )}
                {ready ? answer(q, a, now, babyWords(settings.babySex), feeding) : waiting(q, a)}
                {q.about && (
                  <button type="button" class="qabout" data-testid={`q-${q.id}-about`} onClick={() => openHow(q.id)}>
                    <span class="emo">ℹ️</span> מה זה אומר?
                  </button>
                )}
              </div>
            ))}
        </div>
      ))}
      {menu && <div class="qshield" data-testid="q-shield" onClick={() => setMenu(null)} />}
      {suggestButton(suggest)}
      <p class="muted" data-testid="q-window">
        לפי 7 הימים המלאים האחרונים, מ-{shortDate(r.from)} עד {shortDate(r.to)} (בלי היום). לילה: מ-19:00 עד 07:00.
      </p>
      {disclaimer('q-disclaimer')}
      {howQ &&
        // drawn above the tab bar (see overlay.ts)
        overlay(
        <div class="sheet-backdrop" data-testid="q-how-sheet" onClick={(e) => e.target === e.currentTarget && setHow(null)}>
          <div class="sheet" role="dialog" aria-modal="true" aria-label={howQ.about ? 'מה זה אומר?' : 'איך זה מחושב?'}>
            <h2>{howQ.about ? 'מה זה אומר?' : 'איך זה מחושב?'}</h2>
            <p class="muted">
              {howQ.q}
              {howQ.term && (
                <>
                  {' '}
                  (<bdi>{howQ.term}</bdi>)
                </>
              )}
            </p>
            {aboutOf(howQ, babyWords(settings.babySex)).map((x) => (
              <div key={x.title} data-testid="q-about-part">
                <h3>{x.title}</h3>
                <p>{x.text}</p>
              </div>
            ))}
            {howQ.about && <h3>איך זה מחושב</h3>}
            {howQ.how(settings.mergeWindowMin).map((t) => (
              <p key={t}>{t}</p>
            ))}
            {disclaimer('q-how-disclaimer')}
            <div class="actions">
              <button type="button" class="primary" data-testid="q-how-close" onClick={() => setHow(null)}>
                הבנתי
              </button>
            </div>
          </div>
        </div>
        )}
    </div>
  );
}
