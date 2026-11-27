import { useEffect, useRef, useState } from 'preact/hooks';
import { FEEDBACK_LOG_MAX, FEEDBACK_TEXT_MAX, type FeedbackItem, type FeedbackKind } from '../../shared/protocol';
import { parseLocal } from '../../shared/tz';
import { NetworkError, callApi } from '../api';
import { decodeAdminCode } from '../config';
import { type FamilySource, type UsageGroup, loadFamilies, saveFamilies, usageText } from '../families';
import { DAILY_PROPS_QUOTA, propsEstimate, quotaCheck } from '../../shared/quota';
import { errorText } from '../labels';
import { count, engine } from '../state';
import { day, logLines } from './SyncLog';

const KINDS: [FeedbackKind, string, string][] = [
  ['bug', '🐞', 'באג'],
  ['idea', '💡', 'רעיון'],
  ['other', '💬', 'אחר'],
];
const KIND = Object.fromEntries(KINDS.map(([k, icon, label]) => [k, `${icon} ${label}`])) as Record<FeedbackKind, string>;

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** "#7 · 🐞 באג · היום 07:55 · <who> · גרסה abc1234": the header line of an item (also in the copied text). */
export function feedbackHead(f: FeedbackItem): string {
  const at = parseLocal(f.created);
  const when = Number.isNaN(at) ? f.created : `${day(at)} ${f.created.slice(11)}`;
  return [`#${f.no}`, KIND[f.kind] ?? f.kind, when, f.user, f.version ? `גרסה ${f.version}` : ''].filter(Boolean).join(' · ');
}

/** The whole list as text, newest first, for pasting into a chat (owner: Claude recognises repeats by their number). */
export function feedbackText(items: readonly FeedbackItem[]): string {
  return items.map((f) => [feedbackHead(f), f.text, ...(f.log ? ['יומן סנכרון:', f.log] : [])].join('\n')).join('\n\n');
}

/** The feedback of the other families, as one text: each family's items under its label (the owner's own label, on this phone only). */
export function familiesText(groups: readonly { label: string; items: readonly FeedbackItem[] }[]): string {
  return groups
    .filter((g) => g.items.length)
    .map((g) => `== ${g.label} ==\n${feedbackText(g.items)}`)
    .join('\n\n');
}

/** What one server said about yesterday: estimated property calls, or why there is no number. */
type LoadState = { calls: number; requests: number } | 'none' | 'old' | 'error' | null;

/**
 * (owner, family servers) Yesterday's load of every server on the owner's account, from the phones' own request counts:
 * the owner's server and each family's (through its admin code), the estimated share of the shared daily quota, and a warning
 * above 75% or when one family is far above the others. Numbers only.
 */
function ServerLoad({ list }: { list: readonly FamilySource[] }) {
  const [own, setOwn] = useState<LoadState>(null);
  const [fams, setFams] = useState<Record<string, LoadState>>({});
  const read = (r: Awaited<ReturnType<typeof engine.ask>>): LoadState => {
    if (!r.ok) return r.error === 'unknown_action' ? 'old' : 'error';
    const y = r.usageTotals?.[0]; // two days asked: yesterday (whole) and today (still counting)
    if (!y || (y.requests === 0 && y.phones === 0)) return 'none';
    return { calls: propsEstimate(y), requests: y.requests };
  };
  useEffect(() => {
    engine.ask({ action: 'usageTotals', days: 2 }).then(
      (r) => setOwn(read(r)),
      () => setOwn('error'),
    );
  }, []);
  useEffect(() => {
    for (const f of list) {
      callApi(f, { action: 'usageTotals', days: 2 }).then(
        (r) => setFams((m) => ({ ...m, [f.url]: read(r) })),
        () => setFams((m) => ({ ...m, [f.url]: 'error' })),
      );
    }
  }, [list.length]);
  const rows: [string, LoadState][] = [['שלנו', own], ...list.map((f): [string, LoadState] => [f.label, fams[f.url] ?? null])];
  const check = quotaCheck(rows.map(([label, s]) => ({ label, calls: s && typeof s === 'object' ? s.calls : null })));
  const loadLine = (s: LoadState): string =>
    s === null ? 'טוען…' : s === 'none' ? 'אין נתונים עדיין' : s === 'old' ? 'השרת עוד לא מעודכן' : s === 'error' ? 'לא ענה' : `כ-${s.calls.toLocaleString('he-IL')} פעולות (${s.requests.toLocaleString('he-IL')} בקשות)`;
  const anyNumber = rows.some(([, s]) => s && typeof s === 'object');
  const [copied, setCopied] = useState('');
  // (owner) the block as shown, for pasting into a chat
  const copy = () => {
    const total = anyNumber
      ? `סך הכל: כ-${check.total.toLocaleString('he-IL')} מתוך ${DAILY_PROPS_QUOTA.toLocaleString('he-IL')} ביום (${Math.round(check.share * 100)}%)${check.over ? '. קרוב למכסה היומית המשותפת' : ''}${check.heavy.length ? `. הרבה מעל האחרים: ${check.heavy.join(', ')}` : ''}`
      : 'אין עדיין מספרים';
    const text = ['עומס על השרתים (אתמול)', ...rows.map(([label, s]) => `${label}: ${loadLine(s)}`), total].join('\n');
    void navigator.clipboard?.writeText(text).then(
      () => setCopied('הועתק'),
      () => setCopied('לא ניתן להעתיק'),
    );
  };
  return (
    <div class="srvload" data-testid="srv-load">
      <h3>עומס על השרתים (אתמול)</h3>
      <ul class="loglist">
        {rows.map(([label, s]) => (
          <li key={label} data-testid="srv-load-row" data-label={label}>
            <bdi>{label}</bdi>: {loadLine(s)}
          </li>
        ))}
      </ul>
      {anyNumber && (
        <p class={check.over || check.heavy.length ? 'err' : 'muted'} data-testid="srv-load-total">
          סך הכל: כ-{check.total.toLocaleString('he-IL')} מתוך {DAILY_PROPS_QUOTA.toLocaleString('he-IL')} ביום ({Math.round(check.share * 100)}%)
          {check.over ? '. קרוב למכסה היומית המשותפת: אם תיגמר, כל השרתים ייעצרו עד למחרת.' : ''}
          {check.heavy.length ? (
            <>
              . הרבה מעל האחרים: <bdi>{check.heavy.join(', ')}</bdi>
            </>
          ) : (
            ''
          )}
        </p>
      )}
      {!anyNumber && <p class="muted">הטלפונים סופרים את הבקשות מהגרסה הנוכחית ושולחים פעם ביום: המספרים יופיעו מחר.</p>}
      <div class="actions">
        <button type="button" data-testid="srv-load-copy" onClick={copy}>
          העתקה
        </button>
      </div>
      {copied && (
        <p class="muted" role="status" data-testid="srv-load-msg">
          {copied}
        </p>
      )}
    </div>
  );
}

interface Loaded {
  items: FeedbackItem[] | null;
  error: string;
}

/**
 * (owner, family servers) The other families' feedback, read from each family's server with its admin key (feedback only, never
 * the log). Shown only on the owner's phone: a family's own server answers `send_only` to a list, so a family never sees this.
 */
function FamiliesFeedback() {
  const [list, setList] = useState<FamilySource[]>(() => loadFamilies());
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(''); // "clear:<url>" or "remove:<url>": the second tap does it

  const load = async (f: FamilySource) => {
    setLoaded((m) => ({ ...m, [f.url]: { items: m[f.url]?.items ?? null, error: '' } }));
    try {
      const r = await callApi(f, { action: 'feedbackList' });
      const next: Loaded = r.ok ? { items: [...(r.feedback ?? [])].reverse(), error: '' } : { items: null, error: r.error === 'unauthorized' ? 'קוד המנהל לא תקין' : 'השרת סירב' };
      setLoaded((m) => ({ ...m, [f.url]: next }));
    } catch {
      setLoaded((m) => ({ ...m, [f.url]: { items: m[f.url]?.items ?? null, error: 'אין חיבור לשרת' } }));
    }
  };
  useEffect(() => {
    for (const f of list) void load(f);
  }, []);

  const store = (next: FamilySource[]) => {
    setList(next);
    saveFamilies(next);
  };
  const add = () => {
    const decoded = decodeAdminCode(code);
    const name = label.trim();
    if (!name) return setMsg('תנו שם (נשמר רק בטלפון הזה)');
    if (!decoded) return setMsg('קוד מנהל לא תקין (מתחיל ב-BLA)');
    if (list.some((f) => f.url === decoded.url)) return setMsg('המשפחה הזאת כבר ברשימה');
    const f = { label: name, ...decoded };
    store([...list, f]);
    setAdding(false);
    setLabel('');
    setCode('');
    setMsg('');
    void load(f);
  };
  const clear = async (f: FamilySource) => {
    if (confirm !== `clear:${f.url}`) return setConfirm(`clear:${f.url}`);
    setConfirm('');
    const ids = (loaded[f.url]?.items ?? []).map((x) => x.id); // only what is shown: an item sent meanwhile stays
    try {
      const r = await callApi(f, { action: 'feedbackClear', ids });
      if (r.ok) setLoaded((m) => ({ ...m, [f.url]: { items: [...(r.feedback ?? [])].reverse(), error: '' } }));
      else setMsg(`${f.label}: לא נוקה`);
    } catch {
      setMsg(`${f.label}: לא נוקה, אין חיבור לשרת`);
    }
  };
  const remove = (f: FamilySource) => {
    if (confirm !== `remove:${f.url}`) return setConfirm(`remove:${f.url}`);
    setConfirm('');
    store(list.filter((x) => x.url !== f.url));
  };
  const groups = list.map((f) => ({ label: f.label, items: loaded[f.url]?.items ?? [] }));
  // (owner, F15 option B) every server's usage of the last 14 days, parents as "הורה 1" / "הורה 2", as one text
  const copyUsage = () => {
    const read = (r: Awaited<ReturnType<typeof engine.ask>>): UsageGroup['rows'] => (r.ok ? (r.usageDays ?? []) : r.error === 'unknown_action' ? 'old' : 'error');
    const text = Promise.all([
      engine.ask({ action: 'usageDays' }).then(read, (): UsageGroup['rows'] => 'error').then((rows) => ({ label: 'שלנו', rows })),
      ...list.map((f) => callApi(f, { action: 'usageDays' }).then(read, (): UsageGroup['rows'] => 'error').then((rows) => ({ label: f.label, rows }))),
    ]).then(usageText);
    setMsg('אוסף נתוני שימוש…');
    count('feedback.usageCopy');
    // iOS allows the copy only in the tap itself: the text is handed over as a promise that the requests fill in later
    let done: Promise<void>;
    try {
      done =
        typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write
          ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })])
          : text.then((t) => navigator.clipboard.writeText(t));
    } catch (e) {
      done = Promise.reject(e);
    }
    void done.then(
      () => setMsg('נתוני השימוש הועתקו (14 ימים)'),
      () => setMsg('לא ניתן להעתיק'),
    );
  };
  const copy = () => {
    void navigator.clipboard?.writeText(familiesText(groups)).then(
      () => setMsg('הועתק'),
      () => setMsg('לא ניתן להעתיק'),
    );
  };

  return (
    <section data-testid="fam-section">
      <ServerLoad list={list} />
      <h3>משפחות נוספות</h3>
      {list.map((f) => {
        const l = loaded[f.url];
        return (
          <div key={f.url} class="famsrc" data-testid="fam-source" data-label={f.label}>
            <div class="lh">
              <bdi>{f.label}</bdi>
            </div>
            {l?.error && (
              <p class="err" data-testid="fam-error">
                {l.error}
              </p>
            )}
            {!l?.error && l?.items === null && <p class="muted">טוען…</p>}
            {l?.items?.length === 0 && <p class="empty">אין משובים</p>}
            <ul class="loglist fblist">
              {(l?.items ?? []).map((x) => (
                <li key={x.id} data-testid="fam-item">
                  <div class="lh">
                    <bdi>{feedbackHead(x)}</bdi>
                  </div>
                  <div class="fbbody">
                    <bdi>{x.text}</bdi>
                  </div>
                  {x.log && <div class="ld">יומן סנכרון מצורף</div>}
                </li>
              ))}
            </ul>
            <div class="actions">
              <button type="button" class="danger" data-testid="fam-clear" disabled={!l?.items?.length} onClick={() => void clear(f)}>
                {confirm === `clear:${f.url}` ? 'לחצו שוב לניקוי' : 'ניקוי'}
              </button>
              <button type="button" data-testid="fam-remove" onClick={() => remove(f)}>
                {confirm === `remove:${f.url}` ? 'לחצו שוב להסרה מהטלפון' : 'הסרה מהרשימה'}
              </button>
            </div>
          </div>
        );
      })}
      {adding ? (
        <div class="famadd">
          <label class="fl">שם (רק בטלפון הזה)</label>
          <input data-testid="fam-label" value={label} maxLength={30} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} />
          <label class="fl">קוד מנהל (מתחיל ב-<bdi>BLA</bdi>)</label>
          <textarea data-testid="fam-code" rows={3} dir="ltr" value={code} onInput={(e) => setCode((e.target as HTMLTextAreaElement).value)} />
          <div class="actions">
            <button type="button" class="primary" data-testid="fam-add" onClick={add}>
              הוספה
            </button>
            <button type="button" onClick={() => setAdding(false)}>
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <div class="actions">
          <button type="button" data-testid="fam-add-open" onClick={() => setAdding(true)}>
            הוספת משפחה
          </button>
          {list.length > 0 && (
            <button type="button" data-testid="fam-copy" disabled={!groups.some((g) => g.items.length)} onClick={copy}>
              העתקה של כולם
            </button>
          )}
          <button type="button" data-testid="usage-copy" onClick={copyUsage}>
            העתקת נתוני שימוש
          </button>
        </div>
      )}
      {msg && (
        <p class="muted" data-testid="fam-msg" role="status">
          {msg}
        </p>
      )}
    </section>
  );
}

/** The last syncs of this phone, as the sync log copies them (times and sizes only), cut to what the server keeps. */
function syncLogText(): string {
  return engine
    .syncLog()
    .slice(0, 20)
    .map((e) => logLines(e).join('\n'))
    .join('\n\n')
    .slice(0, FEEDBACK_LOG_MAX);
}

/**
 * (owner) A quick place to note a bug, an idea or anything else: kept in the sheet's "משוב" tab with a number from the
 * server, seen by both phones. Settings > מתקדם > "🐞 משוב". Sent directly (not queued): a failure says so and keeps the text.
 */
export function Feedback({ onBack, start, backLabel = 'חזרה להגדרות' }: { onBack: () => void; /** (F16) opened from "הציעו שאלה": the kind and a first line */ start?: { kind: FeedbackKind; text: string }; backLabel?: string }) {
  const [kind, setKind] = useState<FeedbackKind>(start?.kind ?? 'bug');
  const [text, setText] = useState(start?.text ?? '');
  // the sync log helps with a bug ("it was slow"); the owner did not decide the default for the other kinds: off
  const [attach, setAttach] = useState((start?.kind ?? 'bug') === 'bug');
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // a family's server: its key may only send (the owner reads the feedback); learnt from the answer to the list
  const [sendOnly, setSendOnly] = useState(false);
  // the same id until a send succeeds: a retry after an unclear failure is not stored twice
  const sendId = useRef(uid());

  const problem = (e: unknown, what: string): string => {
    if (e instanceof NetworkError) return `${what}: אין חיבור לשרת. נסו שוב.`;
    return what;
  };
  const refused = (error: string, detail: string | undefined, what: string): string =>
    error === 'unknown_action' ? 'השרת עוד לא מעודכן למשוב. נסו שוב בעוד כמה דקות.' : `${what}: ${errorText(error, detail)}`;

  const load = async () => {
    try {
      const r = await engine.ask({ action: 'feedbackList' });
      if (r.ok) setItems([...(r.feedback ?? [])].reverse());
      else if (r.error === 'send_only') setSendOnly(true);
      else setMsg(refused(r.error, r.detail, 'הרשימה לא נטענה'));
    } catch (e) {
      setMsg(problem(e, 'הרשימה לא נטענה'));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await engine.ask({
        action: 'feedback',
        id: sendId.current,
        kind,
        text: body,
        user: engine.getConfig()?.me ?? '?',
        version: __APP_COMMIT__,
        ...(attach ? { log: syncLogText() } : {}),
      });
      if (r.ok && r.item) {
        const item = r.item;
        const only = sendOnly || r.sendOnly === true;
        if (r.sendOnly) setSendOnly(true);
        if (!only) setItems((xs) => [item, ...(xs ?? []).filter((x) => x.id !== item.id)]);
        // only what was sent goes: something typed while it was on its way stays (the slow-server run caught this)
        setText((t) => (t.trim() === body ? '' : t));
        sendId.current = uid();
        count('feedback.sent');
        setMsg(only ? 'נשלח, תודה' : `נשלח (#${item.no})`);
      } else if (!r.ok) setMsg(refused(r.error, r.detail, 'לא נשלח'));
    } catch (e) {
      setMsg(problem(e, 'לא נשלח, הטקסט נשמר כאן'));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    void navigator.clipboard?.writeText(feedbackText(items ?? [])).then(
      () => setMsg('הועתק'),
      () => setMsg('לא ניתן להעתיק'),
    );
  };

  const clear = async () => {
    if (!confirmClear) return setConfirmClear(true);
    setConfirmClear(false);
    try {
      const r = await engine.ask({ action: 'feedbackClear' });
      if (r.ok) {
        setItems([]);
        setMsg('הרשימה נוקתה');
      } else setMsg(refused(r.error, r.detail, 'לא נוקה'));
    } catch (e) {
      setMsg(problem(e, 'לא נוקה'));
    }
  };

  return (
    <div data-testid="feedback">
      <div class="actions">
        <button type="button" data-testid="fb-back" onClick={onBack}>
          {backLabel}
        </button>
      </div>
      <h2>
        <span class="emo">🐞</span> משוב
      </h2>
      <p class="muted" data-testid="fb-intro">
        {sendOnly
          ? 'באג, רעיון או כל דבר אחר. נשלח ליוצר האפליקציה עם השעה, השם והגרסה.'
          : items !== null
            ? 'באג, רעיון או כל דבר אחר. נשמר בגיליון עם מספר, השעה, השם והגרסה, וגם ההורה השני רואה אותו.'
            : 'באג, רעיון או כל דבר אחר.'}
      </p>
      <div class="chips" role="radiogroup" aria-label="סוג">
        {KINDS.map(([k, icon, label]) => (
          <button
            type="button"
            key={k}
            class={`chip ${kind === k ? 'on' : ''}`}
            role="radio"
            aria-checked={kind === k}
            data-testid={`fb-kind-${k}`}
            onClick={() => {
              setKind(k);
              setAttach(k === 'bug');
            }}
          >
            <span class="emo">{icon}</span> {label}
          </button>
        ))}
      </div>
      <textarea
        class="fbtext"
        data-testid="fb-text"
        rows={5}
        maxLength={FEEDBACK_TEXT_MAX}
        placeholder={kind === 'bug' ? 'מה קרה? מה ציפיתם שיקרה?' : kind === 'idea' ? 'מה היה עוזר?' : 'מה תרצו לכתוב?'}
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />
      <label class="fbattach">
        <input type="checkbox" data-testid="fb-attach" checked={attach} onChange={(e) => setAttach((e.target as HTMLInputElement).checked)} />
        <span>לצרף את יומן הסנכרון (זמנים בלבד)</span>
      </label>
      <div class="actions">
        <button type="button" class="primary fbsend" data-testid="fb-send" disabled={busy || !text.trim()} onClick={() => void send()}>
          {busy ? 'שולח…' : 'שליחה'}
        </button>
        {msg && (
          <span class="muted" data-testid="fb-msg" role="status">
            {msg}
          </span>
        )}
      </div>

      {!sendOnly && (
        <>
          <h3>שנשלחו</h3>
          {items === null && <p class="muted">טוען…</p>}
          {items !== null && items.length === 0 && <p class="empty">עוד אין משובים</p>}
          <ul class="loglist fblist">
            {(items ?? []).map((f) => (
              <li key={f.id} data-testid="fb-item">
                <div class="lh">
                  <bdi>{feedbackHead(f)}</bdi>
                </div>
                <div class="fbbody">
                  <bdi>{f.text}</bdi>
                </div>
                {f.log && <div class="ld">יומן סנכרון מצורף</div>}
              </li>
            ))}
          </ul>
          <div class="actions">
            <button type="button" data-testid="fb-copy" disabled={!items?.length} onClick={copy}>
              העתקה
            </button>
            <button type="button" class="danger" data-testid="fb-clear" disabled={!items?.length} onClick={() => void clear()}>
              {confirmClear ? 'לחצו שוב לניקוי כל הרשימה' : 'ניקוי הרשימה'}
            </button>
          </div>
          {items !== null && <FamiliesFeedback />}
        </>
      )}
    </div>
  );
}
