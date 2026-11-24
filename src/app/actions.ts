import { type Medicine, VITAMIN_D_ID } from '../shared/medicines';
import type { ApiRequest } from '../shared/protocol';
import { openSleep } from '../shared/domain';
import { formatLocal, parseLocal } from '../shared/tz';
import type { BabyEvent } from '../shared/types';
import { KIND_LABEL, errorText, fromKind, hm, kindOf, nowLocal, timeOf, type Kind } from './labels';
import { engine, showToast } from './state';
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
  toastFor((t) => savedText(label, timeOf(t), offline));
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
    const mv = earlierFor(id, 'start', start, (t) => savedText(W().fellAsleep, timeOf(t), offline));
    showToast({ text: savedText(W().fellAsleep, timeOf(start), offline), earlier: mv.earlier, undo: () => (mv.unmove(), undoOp(res.opId, { action: 'delete', id })) }, TAP_TOAST_MS);
    return;
  }
  const id = uid();
  const res = engine.dispatch({ action: 'awake', id, user: me(), source: 'app', end: start });
  if (!res.ok) return fail(res.error, res.detail);
  // If an open sleep was closed, undo reopens it; if an end-only row was created, undo deletes it.
  const sleepId = res.event?.id ?? id;
  const inverse: ApiRequest = sleepId !== id ? { action: 'update', id: sleepId, patch: { end: '' } } : { action: 'delete', id };
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
  showToast({ text: deletedText(e), undo: () => undoOp(res.opId, { action: 'restore', id: e.id }) });
}

/**
 * (owner bug) Deletes only the wake-up of a finished sleep: the sleep is open again ("still asleep"), as when a baby woke for a
 * moment and went straight back to sleep. Deleting the whole row took the falling asleep with it. "בטל" puts the wake-up back.
 * Returns the error when the server rules refuse it (another sleep is open), so the form can show it.
 */
export function deleteWake(e: BabyEvent): { error: string } | null {
  const res = engine.dispatch({ action: 'update', id: e.id, patch: { end: '' } });
  if (!res.ok) return { error: errorText(res.error, res.detail) };
  showToast({ text: `רישום ההתעוררות נמחק · ${W().stillAsleep}`, undo: () => undoOp(res.opId, { action: 'update', id: e.id, patch: { end: e.end } }) });
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
  const offline = engine.getState().status === 'offline';
  const mv = earlierFor(id, 'start', start, (t) => savedText(m.name, timeOf(t), offline));
  if (toast) showToast({ text: savedText(m.name, timeOf(start), offline), earlier: mv.earlier, undo: () => (mv.unmove(), undoOp(res.opId, { action: 'delete', id })) }, TAP_TOAST_MS);
  return { opId: res.opId, id, medicineId: m.id, pick: mv.earlier.pick, unmove: mv.unmove };
}

/** Takes back doses marked by mistake (newest first). */
export function undoMarks(marks: readonly Mark[]): void {
  for (const mk of [...marks].reverse()) {
    mk.unmove?.();
    const r = engine.undo(mk.opId, { action: 'delete', id: mk.id });
    if (!r.ok) fail(r.error, r.detail);
  }
}
