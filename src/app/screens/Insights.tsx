import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Insights as InsightsData, LONG_STRETCH_MIN, insights } from '../../shared/insights';
import { type MoreAnswers, type Trend, moreAnswers } from '../../shared/questions-data';
import { formatLocal } from '../../shared/tz';

/** a wall-clock time as HH:MM ("00:48", never "0:48", which reads like a duration) */
const hhmm = (t: number) => formatLocal(t).slice(11, 16);
import { addDays } from '../../shared/tz';
import { hm } from '../labels';
import { type AllData, CATEGORIES, IF_WORRIED, NOT_MEDICAL, type Question, type QuestionId, QUESTIONS, questionState } from '../questions';
import { count, engine, hideToast, setQuestion, showToast, useEngine, useNow, usePrefs } from '../state';
import { Feedback } from './Feedback';
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
const WEEKDAY_LETTER = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const weekdayOf = (d: string) => WEEKDAY_LETTER[new Date(`${d}T12:00:00Z`).getUTCDay()]!;
/** A card's "מה זה אומר?" parts, closed by the common "אם משהו מדאיג" unless it has its own. */
const aboutOf = (q: Question, w: BabyWords) => {
  const parts = q.about?.(w) ?? [];
  return parts.some((p) => p.title === IF_WORRIED.title) ? parts : [...parts, IF_WORRIED];
};
const many = (n: number) => (n === 1 ? 'אחד' : n === 2 ? 'שניים' : String(n));

// Plain functions returning JSX (no components defined inside components).

/** The answer of a question that has enough data (also "no clear pattern" for the after-a-feed questions). */
function answerFirst(q: Question, r: InsightsData): JSX.Element {
  if (q.id === 'gaps' && r.feedGaps) {
    const g = r.feedGaps;
    const cell = (icon: string, label: string, s: NonNullable<typeof g.day>, id: string) => (
      <div data-testid={`q-gaps-${id}`}>
        <div class="k">
          <span class="emo">{icon}</span> {label}
        </div>
        <div class="v">{hm(s.median)}</div>
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
              {hm(g.all.median)} <small>בדרך כלל</small>
            </div>
            <div class="qs">רוב הרווחים {range(g.all.low, g.all.high)}</div>
          </>
        )}
        <div class="qbasis">לפי {g.all.n} רווחים, מתחילת האכלה לתחילת הבאה</div>
      </>
    );
  }
  if (q.id === 'night' && r.nightSleep) {
    const n = r.nightSleep;
    const long = LONG_STRETCH_MIN / 60;
    const starts = n.startLow === n.startHigh ? `בסביבות ${clockOf(n.startLow)}` : `בין ${clockOf(n.startLow)} ל-${clockOf(n.startHigh)}`;
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

const UNUSUAL: Record<'feeds' | 'wet' | 'poop' | 'night', [string, string]> = {
  feeds: ['יותר האכלות מהרגיל עד עכשיו', 'פחות האכלות מהרגיל עד עכשיו'],
  wet: ['יותר פיפי מהרגיל עד עכשיו', 'פחות פיפי מהרגיל עד עכשיו'],
  poop: ['יותר קקי מהרגיל עד עכשיו', 'פחות קקי מהרגיל עד עכשיו'],
  night: ['הרצף הארוך בלילה האחרון ארוך מהרגיל', 'הרצף הארוך בלילה האחרון קצר מהרגיל'],
};

/** The answer of a newer question that has enough data (stage B). */
function answerMore(q: Question, m: MoreAnswers, now: number): JSX.Element {
  switch (q.id) {
    case 'feedsToday': {
      const f = m.feedsToday!;
      return (
        <>
          <div class="qa">
            {f.today} <small>עד עכשיו</small>
          </div>
          {todayBar(f.today, f.usualByNow, f.usualDay)}
          <div class="qf">{chip(toneOf(f.trend), more(f.trend, 'יותר מהרגיל אצלכם עד עכשיו', 'פחות מהרגיל אצלכם עד עכשיו', 'כמו ביום רגיל אצלכם'), 'q-feedsToday-trend')}</div>
        </>
      );
    }
    case 'nextFeed': {
      // (owner) by part of the day: the usual gap of the part the last feed fell in, and every part side by side
      const n = m.nextFeed!;
      const span = (k: number) => `${String(n.parts[k]!.from).padStart(2, '0')}:00 עד ${String(n.parts[k]!.to % 24).padStart(2, '0')}:00`;
      const known = n.parts.map((p, k) => ({ k, median: p.median })).filter((p): p is { k: number; median: number } => p.median !== null);
      const longest = known.length > 1 ? known.reduce((x, y) => (y.median > x.median ? y : x)) : null;
      const shortest = known.length > 1 ? known.reduce((x, y) => (y.median < x.median ? y : x)) : null;
      const basis =
        n.basis === 'part'
          ? `${PART_NAMES[n.part]} (${span(n.part)}) מאכילים בדרך כלל כל ${hm(n.gapMin)}`
          : `${n.basis === 'night' ? 'בלילה' : n.basis === 'day' ? 'ביום' : 'בדרך כלל'} מאכילים כל ${hm(n.gapMin)} (לחלק הזה של היום עוד אין מספיק נתונים משלו)`;
      return (
        <>
          {n.last === null ? (
            <div class="qa small">אין האכלה רשומה ב-12 השעות האחרונות</div>
          ) : (
            <>
              <div class="qa">
                בסביבות <bdi>{hhmm(n.at)}</bdi>
              </div>
              <div class="qs">
                ההאכלה האחרונה ב-<bdi>{hhmm(n.last)}</bdi> · {basis}
              </div>
              {n.at < now && <div class="qs">השעה הזו כבר עברה</div>}
            </>
          )}
          <div class="parts" data-testid="q-nextFeed-parts">
            {n.parts.map((p, k) => (
              <div key={k} class={k === n.part ? 'cur' : ''} data-testid={`q-part-${k}`}>
                <div class="k">{PART_NAMES[k]}</div>
                <div class="r">{span(k)}</div>
                <div class="v">{p.median === null ? 'אין מספיק' : `כל ${hm(p.median)}`}</div>
              </div>
            ))}
          </div>
          {longest && shortest && longest.median - shortest.median >= 30 && (
            <div class="qs" data-testid="q-nextFeed-range">
              הרווחים הארוכים ביותר: {PART_NAMES[longest.k]} ({hm(longest.median)}); הקצרים ביותר: {PART_NAMES[shortest.k]} ({hm(shortest.median)})
            </div>
          )}
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
      const hours = c.from === c.to ? `בסביבות ${clockOf(c.from)}` : `בדרך כלל בין ${clockOf(c.from)} ל-${clockOf(c.to)}`;
      if (c.days === 0)
        return (
          <>
            <div class="qa small">ההאכלות סדירות</div>
            <div class="qs">ב-7 הימים האחרונים לא היו שעות של הנקות צפופות{c.usualGap ? `; בדרך כלל מאכילים כל ${hm(c.usualGap)}` : ''}.</div>
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
          <div class="qf">{chip(toneOf(s.trend), more(s.trend, 'אתמול יותר מהרגיל אצלכם', 'אתמול פחות מהרגיל אצלכם', 'אתמול כמו בדרך כלל'), 'q-sleepDay-trend')}</div>
        </>
      );
    }
    case 'nightStart': {
      const n = m.nightStart!;
      return (
        <>
          <div class="qa">
            בסביבות <bdi>{clockOf(n.median)}</bdi>
          </div>
          <div class="qs">{n.low === n.high ? 'כמעט באותה שעה כל ערב' : `בדרך כלל בין ${clockOf(n.low)} ל-${clockOf(n.high)}`}</div>
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
    default:
      return <div class="qs">אין תשובה כרגע</div>;
  }
}

const FIRST_IDS = new Set<QuestionId>(['gaps', 'night', 'poop']);
const answer = (q: Question, a: AllData, now: number) => (FIRST_IDS.has(q.id) ? answerFirst(q, a.ins) : answerMore(q, a.more, now));

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
  const a = useMemo<AllData>(() => ({ ins: insights(events, now, settings.mergeWindowMin), more: moreAnswers(events, now, settings.mergeWindowMin) }), [events, now, settings.mergeWindowMin]);
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

  const states = QUESTIONS.map((q) => ({ q, ...questionState(q, a, choices[q.id]) }));

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
                    <small>{!shown && !ready && choices[q.id] === undefined ? 'תופיע לבד כשיהיו מספיק נתונים' : q.desc}</small>
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
  const howQ = QUESTIONS.find((q) => q.id === how);
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
                {ready ? answer(q, a, now) : waiting(q, a)}
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
      {howQ && (
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
