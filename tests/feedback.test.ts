import { beforeEach, describe, expect, it } from 'vitest';
import { type Deps, handle } from '../src/server/core';
import { MemoryStore } from '../src/server/memory-store';
import type { ApiOk, ApiResponse } from '../src/shared/protocol';
import { T } from './helpers';

const KEY = 'test-key';
let store: MemoryStore;
let deps: Deps;

beforeEach(() => {
  store = new MemoryStore();
  deps = { store, now: () => T('2026-11-14 12:00'), checkKey: (k) => k === KEY, withLock: (fn) => fn() };
});

const call = (req: Record<string, unknown>): ApiResponse => handle({ key: KEY, ...req }, deps);
const ok = (r: ApiResponse): ApiOk => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error} ${r.detail ?? ''}`);
  return r;
};
const send = (id: string, extra: Record<string, unknown> = {}) =>
  call({ action: 'feedback', id, kind: 'bug', text: 'הטוסטר נעלם', user: 'Parent 1', version: 'abc1234', ...extra });

// Owner: a quick place in the app to note a bug or an idea; each item gets a number that is never reused.
describe('feedback', () => {
  it('numbers the items 1, 2, 3; a retried send is not stored twice; the list is oldest first', () => {
    expect(ok(send('f1')).item).toEqual({ no: 1, id: 'f1', kind: 'bug', text: 'הטוסטר נעלם', user: 'Parent 1', version: 'abc1234', created: '2026-11-14 12:00', log: '' });
    expect(ok(send('f2', { kind: 'idea', text: '  בקבוק עם כמות  ', log: '12:00:01 · היום · פתיחה · 2.0 ש׳' })).item).toMatchObject({ no: 2, kind: 'idea', text: 'בקבוק עם כמות' });
    const again = ok(send('f1'));
    expect([again.duplicate, again.item?.no]).toEqual([true, 1]);
    expect(ok(call({ action: 'feedbackList' })).feedback!.map((f) => [f.no, f.id])).toEqual([
      [1, 'f1'],
      [2, 'f2'],
    ]);
  });

  it('clearing removes everything but the numbering goes on (repeats stay recognisable)', () => {
    send('f1');
    send('f2');
    expect(ok(call({ action: 'feedbackClear' })).feedback).toEqual([]);
    expect(ok(call({ action: 'feedbackList' })).feedback).toEqual([]);
    expect(ok(send('f3')).item?.no).toBe(3);
  });

  it('refuses an empty or too long text, an unknown kind and a missing name; cuts a long log', () => {
    expect(send('x1', { text: '   ' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(send('x2', { text: 'a'.repeat(2001) })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(send('x3', { kind: 'rant' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(send('x4', { user: '' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(ok(send('x5', { log: 'l'.repeat(5000) })).item?.log).toHaveLength(4000);
    expect(ok(send('x6', { text: 'a'.repeat(2000) })).item?.text).toHaveLength(2000);
  });

  it('is not log data: the data revision does not move, and it cannot travel inside sync', () => {
    const rev = store.revision();
    send('f1');
    call({ action: 'feedbackClear' });
    expect(store.revision()).toBe(rev);
    const r = ok(call({ action: 'sync', from: '2026-11-01', to: '2026-11-14', ops: [{ action: 'feedback', id: 'x', kind: 'bug', text: 't', user: 'Parent 1' }] }));
    expect(r.results?.[0]).toMatchObject({ ok: false, error: 'bad_request' });
    expect(ok(call({ action: 'feedbackList' })).feedback!.map((f) => f.id)).toEqual([]);
  });

  it('needs the key', () => {
    expect(handle({ action: 'feedbackList' }, deps)).toEqual({ ok: false, error: 'unauthorized' });
  });
});
