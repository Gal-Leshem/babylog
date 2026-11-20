import { useEffect, useRef, useState } from 'preact/hooks';
import { FEEDBACK_LOG_MAX, FEEDBACK_TEXT_MAX, type FeedbackItem, type FeedbackKind } from '../../shared/protocol';
import { parseLocal } from '../../shared/tz';
import { NetworkError } from '../api';
import { errorText } from '../labels';
import { engine } from '../state';
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
export function Feedback({ onBack }: { onBack: () => void }) {
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [text, setText] = useState('');
  // the sync log helps with a bug ("it was slow"); the owner did not decide the default for the other kinds: off
  const [attach, setAttach] = useState(true);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
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
        setItems((xs) => [item, ...(xs ?? []).filter((x) => x.id !== item.id)]);
        // only what was sent goes: something typed while it was on its way stays (the slow-server run caught this)
        setText((t) => (t.trim() === body ? '' : t));
        sendId.current = uid();
        setMsg(`נשלח (#${item.no})`);
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
          חזרה להגדרות
        </button>
      </div>
      <h2>
        <span class="emo">🐞</span> משוב
      </h2>
      <p class="muted">באג, רעיון או כל דבר אחר. נשמר בגיליון עם מספר, השעה, השם והגרסה, וגם ההורה השני רואה אותו.</p>
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
    </div>
  );
}
