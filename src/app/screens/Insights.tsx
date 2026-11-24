import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { type Insights as InsightsData, LONG_STRETCH_MIN, insights } from '../../shared/insights';
import { addDays } from '../../shared/tz';
import { hm } from '../labels';
import { CATEGORIES, NOT_MEDICAL, type Question, type QuestionId, QUESTIONS, questionState } from '../questions';
import { count, engine, hideToast, setQuestion, showToast, useEngine, useNow, usePrefs } from '../state';
import { Feedback } from './Feedback';

const shortDate = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`;
/** minutes after midnight (may pass 24:00) -> 'HH:MM' */
const clockOf = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
/** ranges in words: a dash between numbers reads backwards in right-to-left text */
const range = (lo: number, hi: number) => (lo === hi ? `סביב ${hm(lo)}` : `בין ${hm(lo)} ל-${hm(hi)}`);
const many = (n: number) => (n === 1 ? 'אחד' : n === 2 ? 'שניים' : String(n));

// Plain functions returning JSX (no components defined inside components).

/** The answer of a question that has enough data (also "no clear pattern" for the after-a-feed questions). */
function answer(q: Question, r: InsightsData): JSX.Element {
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
  if (q.id === 'poop' || q.id === 'diaper') {
    const a = q.id === 'poop' ? r.poopAfterFeed : r.diaperAfterFeed;
    if (!a)
      return (
        <>
          <div class="qa">אין קשר ברור</div>
          <div class="qs">{q.id === 'poop' ? 'קקי לא מגיע אחרי האכלה יותר מאשר בשעות אחרות' : 'חיתול לא מוחלף אחרי האכלה יותר מאשר בשעות אחרות'}</div>
        </>
      );
    return (
      <>
        <div class="qa">
          כ-{a.lagMin} דק׳ <small>אחרי תחילת האכלה</small>
        </div>
        <div class="qs">{q.id === 'poop' ? `${a.hits} מתוך ${a.total} הפעמים היו תוך שעה מתחילת האכלה` : `ב-${a.hits} מתוך ${a.total} האכלות הוחלף חיתול תוך שעה`}</div>
      </>
    );
  }
  return <div class="qs">אין תשובה כרגע</div>;
}

/** Not enough data yet (shown only for a question the parent turned on by hand): how much there is and how much is needed. */
function waiting(q: Question, r: InsightsData): JSX.Element {
  const p = r.progress[q.key];
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
  const r = useMemo(() => insights(events, now, settings.mergeWindowMin), [events, now, settings.mergeWindowMin]);
  const [mode, setMode] = useState<'cards' | 'pick' | 'suggest'>('cards');
  const [menu, setMenu] = useState<QuestionId | null>(null);
  const [how, setHow] = useState<QuestionId | null>(null);

  useEffect(() => {
    const from = addDays(r.from, -1);
    if (from < engine.defaultRange().from) void engine.ensureRange(from, r.to);
  }, [r.from]);

  const suggest = () => {
    count('questions.suggest');
    setMode('suggest');
  };
  if (mode === 'suggest') return <Feedback onBack={() => setMode('cards')} start={{ kind: 'idea', text: 'שאלה מוצעת: ' }} backLabel="חזרה לתובנות" />;

  const states = QUESTIONS.map((q) => ({ q, ...questionState(q, r, choices[q.id]) }));

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

  return (
    <div data-testid="insights">
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
              <div class="q" key={q.id} data-testid={`q-${q.id}`}>
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
                      onClick={() => {
                        setMenu(null);
                        count('questions.how');
                        hideToast(); // a sheet opens: the toast would lie over its button
                        setHow(q.id);
                      }}
                    >
                      <span class="emo">ℹ️</span> איך זה מחושב?
                    </button>
                  </div>
                )}
                <div class="qq">{q.q}</div>
                {ready ? answer(q, r) : waiting(q, r)}
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
          <div class="sheet" role="dialog" aria-modal="true" aria-label="איך זה מחושב?">
            <h2>איך זה מחושב?</h2>
            <p class="muted">{howQ.q}</p>
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
