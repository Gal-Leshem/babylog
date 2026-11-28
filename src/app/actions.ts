import { type BottleKind, bottleDetail, clampGiven, defaultMl, feedingOf, parseBottle } from '../shared/bottle';
import { type Medicine, VITAMIN_D_ID, endsCourse } from '../shared/medicines';
import type { ApiRequest } from '../shared/protocol';
import { openSleep } from '../shared/domain';
import { formatLocal, parseLocal } from '../shared/tz';
import type { BabyEvent } from '../shared/types';
import { KIND_LABEL, errorText, fromKind, hm, kindOf, kindOfBottle, nowLocal, timeOf, type Kind } from './labels';
import { type Suggest, type Toast, count, declineDefault, engine, getPrefs as prefs, showToast } from './state';
import { babyWords } from './words';

const W = () => babyWords(engine.getState().settings.babySex);

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

function me(): string {
  return engine.getConfig()?.me ?? '?';
}

function fail(error: string, detail?: string): void {
  showToast({ text: `לא נשמר: ${errorText(error, detail)}`, tone: 'error' }, 6000);
}

function savedText(label: string, time: string, pending: boolean): string {
  return `${pending ? 'ממתין לסנכרון' : 'נשמר'}: ${label} ${time}`;
}

/**
 * How long the toast after a one-tap log stays when none of its buttons is used (owner: 6, 5 and then 4 s were still long), and
 * while the baby is marked asleep (one more row to read). A used button closes it sooner (TOAST_DONE_MS).
 */
export const TAP_TOAST_MS = 3_000;
/** (owner, feedback #6) the toast after a medicine's last dose offers to archive it: a little longer to read and decide */
export const OFFER_TOAST_MS = 6_000;
const TAP_TOAST_ASLEEP_MS = 5_000;

/** Minutes offered in the toast after a one-tap log for "it happened earlier" (owner). */
export const EARLIER_MIN = [5, 10, 15, 30] as const;

/**
 * The toast's "earlier" buttons for the entry just logged. Each moves the entry's time (`field`) to the logged time minus the
 * minutes (always counted from the logged time, so 10 and then 15 means 15 minutes before it). `text(t)` is the toast text
 * for a time. `unmove` takes the moves back, newest first; the toast's undo calls it before taking back the entry itself.
 */
export function earlierFor(id: string, field: 'start' | 'end', at: string, text: (t: string) => string) {
  const moves: { opId: string; before: string }[] = [];
  let current = at;
  return {
    earlier: {
      pick: (mins: number): string | null => {
        const t = formatLocal(parseLocal(at) - mins * 60_000);
        if (t === current) return text(t);
        const r = engine.dispatch({ action: 'update', id, patch: { [field]: t } });
        if (!r.ok) {
          fail(r.error, r.detail);
          return null;
        }
        if (r.opId) moves.push({ opId: r.opId, before: current });
        current = t;
        return text(t);
      },
    },
    unmove: () => {
      for (const m of moves.reverse()) engine.undo(m.opId, { action: 'update', id, patch: { [field]: m.before } });
      moves.length = 0;
    },
  };
}

/** One-tap logging of a kind "right now", with a 5 second undo. */
export function quickLog(kind: Kind): void {
  const { type, detail } = fromKind(kind);
  const start = nowLocal();
  const id = uid();
  const res = engine.dispatch({ action: 'log', id, type, detail, start, user: me(), source: 'app' });
  if (!res.ok) return fail(res.error, res.detail);
  if (kind === 'feed_left' || kind === 'feed_right' || kind === 'wet' || kind === 'poop' || kind === 'both') count(`log.${kind}`);
  else if (kind === 'vitamin_d') count('log.medicine');
  const label = KIND_LABEL[kind];
  const offline = engine.getState().status === 'offline';
  const vit = engine.getState().settings.medicines.find((m) => m.id === VITAMIN_D_ID);
  const toastFor = (text: (t: string) => string, extra: Partial<Parameters<typeof showToast>[0]> = {}, ms = TAP_TOAST_MS) => {
    const mv = earlierFor(id, 'start', start, text);
    showToast({ text: text(start), earlier: mv.earlier, undo: () => (mv.unmove(), undoOp(res.opId, { action: 'delete', id })), ...extra }, ms);
  };
  if (res.warning === 'vitamin_d_already_given' && (!vit || vit.schedule === 'daily')) {
    const first = engine.getState().events.find((e) => e.type === 'vitamin_d' && e.start.slice(0, 10) === start.slice(0, 10) && e.id !== id);
    return toastFor((t) => `כבר ניתן היום${first ? ` ב-${timeOf(first.start)}` : ''} · נרשם שוב ${timeOf(t)}`, { tone: 'warn' });
  }
  // A feed or a diaper while the baby is marked asleep: often he really is still asleep (a night feed or change), so nothing
  // changes by itself; the toast says so and offers to mark him awake with one tap.
  if ((type === 'feed' || type === 'diaper') && openSleep(engine.getState().events)) {
    // (owner) the offer to mark the wake-up is a row of its own, clearly apart from the confirmation
    return toastFor((t) => savedText(label, timeOf(t), offline), { action: { label: W().markAwake, note: W().stillMarkedAsleep, run: toggleSleep } }, TAP_TOAST_ASLEEP_MS);
  }
  // (owner, feedback #6) vitamin D on Home logs here, not through logMedicine: its last dose offers the archive too
  const offer = kind === 'vitamin_d' ? lastDoseOffer(vit, start) : undefined;
  toastFor((t) => savedText(label, timeOf(t), offline), offer ? { offer } : {}, offer ? OFFER_TOAST_MS : TAP_TOAST_MS);
}

/** (owner, F18) After this many bottles of a kind in a row with the same amount, other than the default, offer to make it the default. */
export const SAME_BOTTLES = 5;

/**
 * (owner, F18) The offer to update the default amount of a bottle kind: when the bottle just logged (`id`, now `ml`) and the
 * SAME_BOTTLES - 1 bottles of that kind before it all have the same amount, and it is not the default, and this parent did not
 * already say "לא עכשיו" to that amount. Null otherwise.
 */
export function suggestDefault(kind: BottleKind, ml: number, id: string): Suggest | null {
  const { events, settings } = engine.getState();
  const feeding = feedingOf(settings);
  if (ml === defaultMl(feeding, kind) || prefs().declined?.[kind] === ml) return null;
  const before = events
    .filter((e) => e.type === 'bottle' && !e.deleted && e.id !== id && e.start)
    .map((e) => ({ e, b: parseBottle(e.detail) }))
    .filter((x) => x.b?.kind === kind)
    .sort((x, y) => (x.e.start < y.e.start ? 1 : -1))
    .slice(0, SAME_BOTTLES - 1);
  if (before.length < SAME_BOTTLES - 1 || before.some((x) => x.b!.given !== ml)) return null;
  const words = SAME_BOTTLES === 5 ? 'חמשת' : String(SAME_BOTTLES);
  return {
    text: `${words} הבקבוקים האחרונים היו ${ml} מ״ל. לעדכן את ברירת המחדל?`,
    yes: () => {
      count('bottle.defaultYes');
      engine.dispatch({ action: 'settings', set: { feeding: { ...feeding, [kind === 'formula' ? 'formulaMl' : 'expressedMl']: ml } } });
    },
    no: () => {
      count('bottle.defaultNo');
      declineDefault(kind, ml);
    },
  };
}

/** (owner, F18) How long the toast after a bottle stays, and stays again after each tap on it (short, not excessive). */
export const BOTTLE_TOAST_MS = 4_000;
/** (owner) the amount buttons in the toast after a bottle */
export const TOAST_ML = [-20, -10, 10, 20] as const;

/**
 * (owner, F18) Logs a bottle now: the kind's default amount (never the previous bottle's), or `ml` when it was picked in the
 * bottle window. The toast offers − / + for the amount and "היה לפני", and stays while it is used.
 */
export function logBottle(kind: BottleKind, ml?: number): void {
  const feeding = feedingOf(engine.getState().settings);
  const given = clampGiven(ml ?? defaultMl(feeding, kind));
  const start = nowLocal();
  const id = uid();
  const res = engine.dispatch({ action: 'log', id, type: 'bottle', detail: bottleDetail({ kind, given, left: 0 }), start, user: me(), source: 'app' });
  if (!res.ok) return fail(res.error, res.detail);
  count('log.bottle');
  const label = KIND_LABEL[kindOfBottle(kind)];
  const offline = engine.getState().status === 'offline';
  let current = given;
  let at = start;
  const text = () => savedText(`${label} · ${current} מ״ל`, timeOf(at), offline);
  const mv = earlierFor(id, 'start', start, (t) => ((at = t), text()));
  const changes: { opId: string; before: number }[] = [];
  const step = (delta: number): { text: string; ml: number; suggest: Suggest | null } | null => {
    const next = clampGiven(current + delta);
    if (next === current) return { text: text(), ml: current, suggest: suggestDefault(kind, current, id) };
    const r = engine.dispatch({ action: 'update', id, patch: { detail: bottleDetail({ kind, given: next, left: 0 }) } });
    if (!r.ok) {
      fail(r.error, r.detail);
      return null;
    }
    if (r.opId) changes.push({ opId: r.opId, before: current });
    current = next;
    return { text: text(), ml: current, suggest: suggestDefault(kind, current, id) };
  };
  const undo = () => {
    for (const c of changes.reverse()) engine.undo(c.opId, { action: 'update', id, patch: { detail: bottleDetail({ kind, given: c.before, left: 0 }) } });
    changes.length = 0;
    mv.unmove();
    undoOp(res.opId, { action: 'delete', id });
  };
  const asleep = openSleep(engine.getState().events) ? { action: { label: W().markAwake, note: W().stillMarkedAsleep, run: toggleSleep } } : {};
  showToast({ text: text(), earlier: mv.earlier, amount: { ml: given, step, suggest: suggestDefault(kind, given, id) }, sticky: true, undo, ...asleep }, BOTTLE_TOAST_MS);
}

/** The sleep button: falls asleep or wakes up depending on the current state. */
export function toggleSleep(): void {
  const open = openSleep(engine.getState().events);
  const start = nowLocal();
  const offline = engine.getState().status === 'offline';
  if (!open) {
    const id = uid();
    const res = engine.dispatch({ action: 'asleep', id, user: me(), source: 'app', start });
    if (!res.ok) return fail(res.error, res.detail);
    count('log.asleep');
    const mv = earlierFor(id, 'start', start, (t) => savedText(W().fellAsleep, timeOf(t), offline));
    showToast({ text: savedText(W().fellAsleep, timeOf(start), offline), earlier: mv.earlier, undo: () => (mv.unmove(), undoOp(res.opId, { action: 'delete', id })) }, TAP_TOAST_MS);
    return;
  }
  const id = uid();
  const res = engine.dispatch({ action: 'awake', id, user: me(), source: 'app', end: start });
  if (!res.ok) return fail(res.error, res.detail);
  count('log.awake');
  // If an open sleep was closed, undo reopens it; if an end-only row was created, undo deletes it.
  const sleepId = res.event?.id ?? id;
  const inverse: ApiRequest = sleepId !== id ? { action: 'update', id: sleepId, patch: { end: '', detail: '' } } : { action: 'delete', id };
  // (owner) the wake-up toast also says how long the sleep was
  const slept = res.event?.start ? parseLocal(res.event.start) : NaN;
  const text = (t: string) => savedText(W().wokeUp, timeOf(t), offline) + (Number.isNaN(slept) ? '' : ` · ${W().slept} ${hm((parseLocal(t) - slept) / 60_000)}`);
  const mv = earlierFor(sleepId, 'end', start, text);
  showToast({ text: text(start), earlier: mv.earlier, undo: () => (mv.unmove(), undoOp(res.opId, inverse)) }, TAP_TOAST_MS);
}

/** The toast's undo (the toast itself shows "בוטל" for a moment and goes; a failure replaces it with its own). */
function undoOp(opId: string, inverse: ApiRequest): void {
  const r = engine.undo(opId, inverse);
  if (!r.ok) fail(r.error, r.detail);
}

/** What the toast says after a delete (owner: "רישום השינה נמחק" / "רישום ההתעוררות נמחק" for sleeps, kinder than "נמחק: שינה"). */
export function deletedText(e: BabyEvent): string {
  if (e.type === 'sleep') return e.start ? 'רישום השינה נמחק' : 'רישום ההתעוררות נמחק';
  return `נמחק: ${KIND_LABEL[kindOf(e)]} ${timeOf(e.start || e.end)}`;
}

/** Soft delete from history, with undo. */
export function deleteEvent(e: BabyEvent): void {
  const res = engine.dispatch({ action: 'delete', id: e.id });
  if (!res.ok) return fail(res.error, res.detail);
  count('form.delete');
  showToast({ text: deletedText(e), undo: () => undoOp(res.opId, { action: 'restore', id: e.id }) });
}

/**
 * (owner bug) Deletes only the wake-up of a finished sleep: the sleep is open again ("still asleep"), as when a baby woke for a
 * moment and went straight back to sleep. Deleting the whole row took the falling asleep with it. "בטל" puts the wake-up back.
 * Returns the error when the server rules refuse it (another sleep is open), so the form can show it.
 */
export function deleteWake(e: BabyEvent): { error: string } | null {
  const res = engine.dispatch({ action: 'update', id: e.id, patch: { end: '', detail: '' } });
  if (!res.ok) return { error: errorText(res.error, res.detail) };
  count('form.deleteWake');
  showToast({ text: `רישום ההתעוררות נמחק · ${W().stillAsleep}`, undo: () => undoOp(res.opId, { action: 'update', id: e.id, patch: { end: e.end, detail: e.detail } }) });
  return null;
}

export interface Mark {
  opId: string;
  id: string;
  medicineId: string;
  /** (owner) "it was given earlier": moves this dose to that many minutes before it was marked (null: could not) */
  pick?: (mins: number) => string | null;
  /** takes the moves back (before the dose itself is taken back) */
  unmove?: () => void;
  /** the minutes picked last, if any */
  chosen?: number;
}

/**
 * Logs one dose of a medicine now (vitamin D keeps its own event type). With `toast`, shows the usual saved toast with undo
 * (used by the single medicine button); the medicines window keeps its own list of marks instead.
 */
export function logMedicine(m: Medicine, toast = false): Mark | null {
  const id = uid();
  const start = nowLocal();
  const res =
    m.id === VITAMIN_D_ID
      ? engine.dispatch({ action: 'log', id, type: 'vitamin_d', detail: '', start, user: me(), source: 'app' })
      : engine.dispatch({ action: 'log', id, type: 'medicine', detail: m.id, start, user: me(), source: 'app' });
  if (!res.ok) {
    fail(res.error, res.detail);
    return null;
  }
  count(toast ? 'log.medicine' : 'meds.mark');
  const offline = engine.getState().status === 'offline';
  const mv = earlierFor(id, 'start', start, (t) => savedText(m.name, timeOf(t), offline));
  const offer = toast ? lastDoseOffer(m, start) : undefined;
  if (toast) showToast({ text: savedText(m.name, timeOf(start), offline), earlier: mv.earlier, undo: () => (mv.unmove(), undoOp(res.opId, { action: 'delete', id })), ...(offer ? { offer } : {}) }, offer ? OFFER_TOAST_MS : TAP_TOAST_MS);
  return { opId: res.opId, id, medicineId: m.id, pick: mv.earlier.pick, unmove: mv.unmove };
}

/**
 * (owner, feedback #6 / #7) Moves a medicine whose course is over to the archive: it leaves Home and the medicines window; its
 * doses stay, and Settings > תרופות brings it back. The toast's "בטל" makes it active again.
 */
export function archiveMedicine(m: Medicine, toast = true): (() => void) | null {
  const { created: _c, ...rest } = m;
  const withStatus = (status: Medicine['status']): ApiRequest => ({ action: 'settings', set: { medicines: [{ ...rest, status }] } });
  const res = engine.dispatch(withStatus('archived'));
  if (!res.ok) {
    fail(res.error, res.detail);
    return null;
  }
  count('meds.archive');
  const undo = () => undoOp(res.opId, withStatus('active'));
  // (the medicines window shows its own line instead: a toast would cover the window's buttons)
  if (toast) showToast({ text: `הועבר לארכיון: ${m.name}`, undo });
  return undo;
}

/** (owner, feedback #6) The toast's offer after the dose that ended `m`'s course, if it did. */
function lastDoseOffer(m: Medicine | undefined, start: string): Toast['offer'] | undefined {
  if (!m || !endsCourse(m, engine.getState().allEvents, parseLocal(start))) return undefined;
  return { text: 'זו הייתה המנה האחרונה', label: 'העברה לארכיון', act: () => void archiveMedicine(m) };
}

/** Takes back doses marked by mistake (newest first). */
export function undoMarks(marks: readonly Mark[]): void {
  for (const mk of [...marks].reverse()) {
    mk.unmove?.();
    const r = engine.undo(mk.opId, { action: 'delete', id: mk.id });
    if (!r.ok) fail(r.error, r.detail);
  }
}
