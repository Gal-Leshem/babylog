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

// Owner (family servers): on a family's server the family's own key may only send feedback; the owner's admin key may only
// read and clear it. The family's sheet link is never handed out.
describe('a family server', () => {
  const ADMIN = 'admin-key';
  const fam = (): Deps => ({ ...deps, familyServer: true, checkAdmin: (k) => k === ADMIN });
  const as = (key: string, req: Record<string, unknown>): ApiResponse => handle({ key, ...req }, fam());

  it("the family's key sends feedback, and is refused the list and clearing", () => {
    const sent = ok(as(KEY, { action: 'feedback', id: 'f1', kind: 'bug', text: 'x', user: 'P' }));
    expect(sent.item?.no).toBe(1);
    expect(sent.sendOnly).toBe(true); // the phone may get this before the list's refusal (seen against a slow server)
    expect(as(KEY, { action: 'feedbackList' })).toEqual({ ok: false, error: 'send_only' });
    expect(as(KEY, { action: 'feedbackClear' })).toEqual({ ok: false, error: 'send_only' });
    expect(store.feedbackAll()).toHaveLength(1); // nothing was cleared
    expect(ok(send('f0')).sendOnly).toBeUndefined(); // the owner's own server: as before
  });

  it("the admin key reads and clears the feedback, and nothing else: no log, no settings, no writes", () => {
    as(KEY, { action: 'feedback', id: 'f1', kind: 'bug', text: 'x', user: 'P' });
    expect(ok(as(ADMIN, { action: 'feedbackList' })).feedback!.map((f) => f.id)).toEqual(['f1']);
    for (const action of ['list', 'sync', 'settings', 'status', 'next', 'poll', 'log', 'feedback']) {
      expect(as(ADMIN, { action, from: '2026-11-14', to: '2026-11-14', id: 'a1', type: 'diaper', detail: 'wet', start: '2026-11-14 11:00', user: 'P', source: 'app', kind: 'bug', text: 'x' }), action).toEqual({
        ok: false,
        error: 'unauthorized',
      });
    }
    expect(store.all()).toHaveLength(0);
    expect(ok(as(ADMIN, { action: 'feedbackClear' })).feedback).toEqual([]);
  });

  it("the admin key means nothing on the owner's own server", () => {
    expect(handle({ key: ADMIN, action: 'feedbackList' }, { ...deps, checkAdmin: (k) => k === ADMIN })).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('clearing with ids removes only the items the owner saw; one sent meanwhile stays', () => {
    for (const id of ['f1', 'f2', 'f3']) as(KEY, { action: 'feedback', id, kind: 'bug', text: id, user: 'P' });
    expect(ok(as(ADMIN, { action: 'feedbackClear', ids: ['f1', 'f2'] })).feedback!.map((f) => f.id)).toEqual(['f3']);
    expect(as(ADMIN, { action: 'feedbackClear', ids: 'f3' })).toMatchObject({ ok: false, error: 'bad_request' });
  });

  it('never gives out the sheet link, also not inside the answer to an operation in a sync', () => {
    const withUrl = new MemoryStore();
    withUrl.sheetUrl = () => 'https://docs.google.com/spreadsheets/d/x/edit';
    const d: Deps = { ...fam(), store: withUrl };
    const settings = handle({ key: KEY, action: 'settings' }, d);
    expect(ok(settings).sheetUrl).toBeUndefined();
    const s = ok(handle({ key: KEY, action: 'sync', from: '2026-11-14', to: '2026-11-14', ops: [{ action: 'settings', set: { babyName: 'B' } }] }, d));
    expect(s.sheetUrl).toBeUndefined();
    expect(s.results![0]!.ok && s.results![0]!.sheetUrl).toBeFalsy();
    // the owner's own server still gives it
    expect(ok(handle({ key: KEY, action: 'settings' }, { ...deps, store: withUrl })).sheetUrl).toContain('spreadsheets');
  });
});

// Owner (family servers, the shared daily quota): the day totals of the phones' request counts, numbers only.
describe('usage totals', () => {
  const ADMIN = 'admin-key';
  const fam = (): Deps => ({ ...deps, familyServer: true, checkAdmin: (k) => k === ADMIN });
  const save = (d: Deps, install: string, date: string, counts: Record<string, number>, user = 'P') =>
    ok(handle({ key: KEY, action: 'usage', user, install, days: [{ date, counts }] }, d));

  it('sums requests and operations per day over every phone, counts the phones, and reads only what was asked', () => {
    const d = fam();
    save(d, 'phone-a', '2026-11-13', { 'sync.requests': 300, 'sync.ops': 20, open: 9 });
    save(d, 'phone-b', '2026-11-13', { 'sync.requests': 200, 'sync.ops': 5 }, 'Q');
    save(d, 'phone-a', '2026-11-14', { 'sync.requests': 40 });
    const r = ok(handle({ key: ADMIN, action: 'usageTotals', days: 2 }, d));
    expect(r.usageTotals).toEqual([
      { date: '2026-11-13', requests: 500, ops: 25, phones: 2 },
      { date: '2026-11-14', requests: 40, ops: 0, phones: 1 },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/"P"|"Q"|phone-a/); // numbers only: no names, no phones' ids
  });
  it("a family's own key may not read them; the owner's own server gives them to the owner's key; bad sizes are refused", () => {
    expect(handle({ key: KEY, action: 'usageTotals' }, fam())).toEqual({ ok: false, error: 'send_only' });
    expect(ok(call({ action: 'usageTotals' })).usageTotals).toHaveLength(7);
    expect(call({ action: 'usageTotals', days: 30 })).toMatchObject({ ok: false, error: 'bad_request' });
  });
});

// Owner (F15 option B, 27 Nov 2026): every phone's usage per day for the owner, with the parents as "הורה 1" / "הורה 2".
describe('usage days', () => {
  const ADMIN = 'admin-key';
  const fam = (): Deps => ({ ...deps, familyServer: true, checkAdmin: (k) => k === ADMIN });
  const save = (d: Deps, user: string, install: string, date: string, counts: Record<string, number>, states?: Record<string, string>) =>
    ok(handle({ key: KEY, action: 'usage', user, install, version: 'v1', days: [{ date, counts, ...(states ? { states } : {}) }] }, d));

  it('hands out the counts and question states per phone and day, parents as "הורה 1" / "הורה 2", phones as numbers, never names', () => {
    const d = fam();
    ok(handle({ key: KEY, action: 'settings', set: { parents: ['Parent A', 'Parent B'] } }, d));
    save(d, 'Parent B', 'phone-b', '2026-11-14', { 'log.wet': 2 });
    save(d, 'Parent A', 'phone-a', '2026-11-13', { 'log.feed_left': 3, 'sync.requests': 40 }, { gaps: 'on', night: 'shown' });
    save(d, 'Old name', 'phone-c', '2026-11-14', { 'history.day': 1 }); // a name no longer in Settings
    save(d, 'Parent A', 'phone-a', '2026-11-01', { 'log.wet': 9 }); // too old for the days asked
    const r = ok(handle({ key: ADMIN, action: 'usageDays', days: 2 }, d));
    expect(r.usageDays).toEqual([
      { date: '2026-11-13', parent: 'הורה 1', phone: 1, version: 'v1', counts: { 'log.feed_left': 3, 'sync.requests': 40 }, states: { gaps: 'on', night: 'shown' } },
      { date: '2026-11-14', parent: 'הורה 2', phone: 2, version: 'v1', counts: { 'log.wet': 2 } },
      { date: '2026-11-14', parent: 'הורה', phone: 3, version: 'v1', counts: { 'history.day': 1 } },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/Parent A|Parent B|Old name|phone-/);
  });

  it("a family's own key may not read them; the owner's key on the owner's server may; 14 days by default; bad sizes are refused", () => {
    expect(handle({ key: KEY, action: 'usageDays' }, fam())).toEqual({ ok: false, error: 'send_only' });
    expect(ok(call({ action: 'usageDays' })).usageDays).toEqual([]);
    expect(call({ action: 'usageDays', days: 15 })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(handle({ key: 'nope', action: 'usageDays' }, fam())).toEqual({ ok: false, error: 'unauthorized' });
  });
});
