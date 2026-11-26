import type { JSX } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { bottleKindsOn, feedingOf } from '../../shared/bottle';
import { dailySummary } from '../../shared/domain';
import { type TimelineRow, insightWindow, timeline } from '../../shared/insights';
import { addDays, localDate } from '../../shared/tz';
import { count, engine, useEngine, useNow } from '../state';

/**
 * The last week at a glance, under the day table in "סיכום" (owner: a dashboard, not an insight): a timeline row per day from
 * 06:00 to 06:00 and the daily counts (the 7 full days and today so far). Moved here unchanged from "תובנות".
 */
const shortDate = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`;

const WEEKDAY_LETTER = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const weekdayOf = (d: string) => WEEKDAY_LETTER[new Date(`${d}T12:00:00Z`).getUTCDay()]!;
/** pee: ring, poop: filled dot, pee + poop: ring with a dot inside */
const DOT_CLASS = { pee: 'w', poop: 'p', both: 'b' } as const;
const pct = (f: number) => `${(f * 100).toFixed(2)}%`;

/** One day from 06:00 to 06:00; time runs right to left like the text. */
function timelineRow(r: TimelineRow, today: string): JSX.Element {
  const label = r.date === today ? 'היום' : r.date === addDays(today, -1) ? 'אתמול' : `${weekdayOf(r.date)} ${shortDate(r.date)}`;
  return (
    <div class="tl-row" key={r.date} data-testid="tl-row">
      <span class="tl-day">{label}</span>
      <div class="rib">
        {r.until < 1 && <div class="rest" style={{ right: pct(r.until), width: pct(1 - r.until) }} />}
        {r.sleeps.map((s) => (
          <div key={`s${s.from}`} class="s" data-testid="tl-sleep" style={{ right: pct(s.from), width: pct(s.to - s.from) }} />
        ))}
        {r.feeds.map((f) => (
          <div key={`f${f}`} class="f" data-testid="tl-feed" style={{ right: pct(f) }} />
        ))}
        {r.diapers.map((d) => (
          <div key={`d${d.at}`} class={`d ${DOT_CLASS[d.kind]}`} data-kind={d.kind} data-testid="tl-diaper" style={{ right: pct(d.at) }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Small bars, oldest on the right (time runs right to left), with the number above and the weekday below: the seven full
 * days and then today so far (owner), set a little apart, labelled "היום" and drawn lighter (the day is not over).
 */
function countCard(id: string, title: string, days: string[], values: number[], today: string, wide = false): JSX.Element {
  const max = Math.max(1, ...values);
  return (
    <div class={`cnt ${wide ? 'wide' : ''}`} data-testid={`cnt-${id}`} key={id}>
      <div class="ie">{title}</div>
      <div class="bars">
        {values.map((v, i) => (
          <div class={`bar ${days[i] === today ? 'today' : ''}`} key={days[i]}>
            <span class="bn">{v}</span>
            <div class="bt">
              <div class="bv" style={{ height: `${Math.round((v / max) * 100)}%` }} />
            </div>
            <span class="bd">{days[i] === today ? 'היום' : weekdayOf(days[i]!)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Week() {
  const { events, settings } = useEngine();
  const now = useNow(60_000);
  // Recomputed only when the events change or a minute passes (the engine keeps `events` the same object while nothing changed).
  const { w, rows, countDays, sums } = useMemo(() => {
    const w = insightWindow(now);
    const rows = timeline(events, now, settings.mergeWindowMin);
    const days: string[] = [];
    for (let d = w.from; d <= w.to; d = addDays(d, 1)) days.push(d);
    // the 7 full days and then today so far
    const countDays = [...days, localDate(now)];
    const sums = countDays.map((d) => dailySummary(events, d, now, settings.mergeWindowMin));
    return { w, rows, countDays, sums };
  }, [events, now, settings.mergeWindowMin]);
  const today = localDate(now);
  // the family's bottle settings, or bottles given this week (before they were turned off)
  const withBottles = bottleKindsOn(feedingOf(settings)).length > 0 || sums.some((s) => s.feeds.bottles > 0);
  const tlRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const from = addDays(w.from, -1);
    if (from < engine.defaultRange().from) void engine.ensureRange(from, w.to);
  }, [w.from]);

  // (owner, F15) whether the parent scrolled down to the timeline / the daily counts (once per visit to this view)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Set<Element>();
    const io = new IntersectionObserver(
      (list) => {
        for (const e of list) {
          if (!e.isIntersecting || seen.has(e.target)) continue;
          seen.add(e.target);
          count(e.target === tlRef.current ? 'summary.timeline' : 'summary.bars');
          io.unobserve(e.target);
        }
      },
      { threshold: 0.6 },
    );
    for (const el of [tlRef.current, barsRef.current]) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div class="week" data-testid="week">
      <h3>ציר זמן, מ-06:00 עד 06:00</h3>
      <div class="tl-axis" aria-hidden="true">
        {['06', '12', '18', '24', '06'].map((h, i) => (
          <span key={i} style={{ right: pct(i / 4) }}>
            {h}
          </span>
        ))}
      </div>
      <div data-testid="timeline" ref={tlRef}>{rows.map((row) => timelineRow(row, today))}</div>
      <div class="tl-legend">
        <span>
          <i class="s" /> שינה
        </span>
        <span>
          <i class="f" /> האכלה
        </span>
        <span>
          <i class="d w" /> פיפי
        </span>
        <span>
          <i class="d p" /> קקי
        </span>
        <span>
          <i class="d b" /> פיפי + קקי
        </span>
      </div>

      <h3>ספירות יומיות</h3>
      <div class="cnts" ref={barsRef}>
        {countCard('feeds', 'האכלות', countDays, sums.map((s) => s.feeds.count), today)}
        {/* (owner, F18) with bottles: the ml eaten from them per day (a count of bottles is not needed); three-digit numbers:
            the whole width, so each fits over its bar */}
        {withBottles && countCard('bottleMl', 'מ״ל בבקבוקים', countDays, sums.map((s) => s.feeds.bottleMl), today, true)}
        {countCard('wet', 'פיפי (כולל פיפי + קקי)', countDays, sums.map((s) => s.diapers.wet + s.diapers.both), today)}
        {countCard('poop', 'קקי (כולל פיפי + קקי)', countDays, sums.map((s) => s.diapers.poop + s.diapers.both), today)}
        {countCard('sleep', 'שינה (שעות)', countDays, sums.map((s) => Math.round(s.sleep.totalMin / 60)), today)}
      </div>
      <p class="muted" data-testid="week-note">
        7 הימים המלאים האחרונים, מ-{shortDate(w.from)} עד {shortDate(w.to)}, והיום עד עכשיו בצד.
      </p>
    </div>
  );
}
