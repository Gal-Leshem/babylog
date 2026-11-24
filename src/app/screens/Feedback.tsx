import { useEffect, useRef, useState } from 'preact/hooks';
import { FEEDBACK_LOG_MAX, FEEDBACK_TEXT_MAX, type FeedbackItem, type FeedbackKind } from '../../shared/protocol';
import { parseLocal } from '../../shared/tz';
import { NetworkError, callApi } from '../api';
import { decodeAdminCode } from '../config';
import { type FamilySource, loadFamilies, saveFamilies } from '../families';
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
  const copy = () => {
    void navigator.clipboard?.writeText(familiesText(groups)).then(
      () => setMsg('הועתק'),
      () => setMsg('לא ניתן להעתיק'),
    );
  };

  return (
    <section data-testid="fam-section">
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
        setItems((xs) => [item, ...(xs ?? []).filter((x) => x.id !== item.id)]);
        // only what was sent goes: something typed while it was on its way stays (the slow-server run caught this)
        setText((t) => (t.trim() === body ? '' : t));
        sendId.current = uid();
        count('feedback.sent');
        setMsg(sendOnly ? 'נשלח, תודה' : `נשלח (#${item.no})`);
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
