import { type Medicine, VITAMIN_D_ID } from '../shared/medicines';
import type { ApiRequest } from '../shared/protocol';
import { openSleep } from '../shared/domain';
import type { BabyEvent } from '../shared/types';
import { KIND_LABEL, errorText, fromKind, kindOf, nowLocal, timeOf, type Kind } from './labels';
import { engine, hideToast, showToast } from './state';

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

/** One-tap logging of a kind "right now", with a 5 second undo. */
export function quickLog(kind: Kind): void {
  const { type, detail } = fromKind(kind);
  const start = nowLocal();
  const id = uid();
  const res = engine.dispatch({ action: 'log', id, type, detail, start, user: me(), source: 'app' });
  if (!res.ok) return fail(res.error, res.detail);
  const label = KIND_LABEL[kind];
  const time = timeOf(start);
  const offline = engine.getState().status === 'offline';
  if (res.warning === 'vitamin_d_already_given') {
    const first = engine.getState().events.find((e) => e.type === 'vitamin_d' && e.start.slice(0, 10) === start.slice(0, 10) && e.id !== id);
    showToast({ text: `כבר ניתן היום${first ? ` ב-${timeOf(first.start)}` : ''} · נרשם שוב`, tone: 'warn', undo: () => undoOp(res.opId, { action: 'delete', id }) });
    return;
  }
  // A feed or a diaper while the baby is marked asleep: often he really is still asleep (a night feed or change), so nothing
  // changes by itself; the toast says so and offers to mark him awake with one tap.
  if ((type === 'feed' || type === 'diaper') && openSleep(engine.getState().events)) {
    showToast(
      { text: `${savedText(label, time, offline)} · עדיין מסומן שישן`, undo: () => undoOp(res.opId, { action: 'delete', id }), action: { label: 'התעורר', run: toggleSleep } },
      8000,
    );
    return;
  }
  showToast({ text: savedText(label, time, offline), undo: () => undoOp(res.opId, { action: 'delete', id }) });
}

/** The sleep button: falls asleep or wakes up depending on the current state. */
export function toggleSleep(): void {
  const open = openSleep(engine.getState().events);
  const start = nowLocal();
  const time = timeOf(start);
  const offline = engine.getState().status === 'offline';
  if (!open) {
    const id = uid();
    const res = engine.dispatch({ action: 'asleep', id, user: me(), source: 'app', start });
    if (!res.ok) return fail(res.error, res.detail);
    showToast({ text: savedText('נרדם', time, offline), undo: () => undoOp(res.opId, { action: 'delete', id }) });
    return;
  }
  const id = uid();
  const res = engine.dispatch({ action: 'awake', id, user: me(), source: 'app', end: start });
  if (!res.ok) return fail(res.error, res.detail);
  // If an open sleep was closed, undo reopens it; if an end-only row was created, undo deletes it.
  const inverse: ApiRequest = res.event && res.event.id !== id ? { action: 'update', id: res.event.id, patch: { end: '' } } : { action: 'delete', id };
  showToast({ text: savedText('התעורר', time, offline), undo: () => undoOp(res.opId, inverse) });
}

function undoOp(opId: string, inverse: ApiRequest): void {
  const r = engine.undo(opId, inverse);
  hideToast();
  if (!r.ok) fail(r.error, r.detail);
}

/** Soft delete from history, with undo. */
export function deleteEvent(e: BabyEvent): void {
  const res = engine.dispatch({ action: 'delete', id: e.id });
  if (!res.ok) return fail(res.error, res.detail);
  showToast({ text: `נמחק: ${KIND_LABEL[kindOf(e)]} ${timeOf(e.start || e.end)}`, undo: () => undoOp(res.opId, { action: 'restore', id: e.id }) });
}

export interface Mark {
  opId: string;
  id: string;
  medicineId: string;
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
  if (toast) showToast({ text: savedText(m.name, timeOf(start), engine.getState().status === 'offline'), undo: () => undoOp(res.opId, { action: 'delete', id }) });
  return { opId: res.opId, id, medicineId: m.id };
}

/** Takes back doses marked by mistake (newest first). */
export function undoMarks(marks: readonly Mark[]): void {
  for (const mk of [...marks].reverse()) {
    const r = engine.undo(mk.opId, { action: 'delete', id: mk.id });
    if (!r.ok) fail(r.error, r.detail);
  }
}
