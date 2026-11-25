import { describe, expect, it } from 'vitest';
import type { ApiRequest } from '../src/shared/protocol';
import { USAGE_KEY, Usage } from '../src/app/usage';
import { T } from './helpers';

// (owner, F15) the phone counts in memory, writes on leaving, and sends whole past days once, in one background request
function setup() {
  const kv = new Map<string, string>();
  let writes = 0;
  const storage = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => (writes++, void kv.set(k, v)) };
  let now = T('2026-11-13 09:00');
  const u = () => new Usage(storage, () => now, () => 'inst1');
  const sent: ApiRequest[] = [];
  let accept = true;
  const send = (r: ApiRequest) => (sent.push(r), accept);
  return { kv, u, sent, send, writes: () => writes, at: (s: string) => (now = T(s)), refuse: (v: boolean) => (accept = !v) };
}

describe('usage on the phone', () => {
  it('counting costs no storage write and no request; leaving writes once; today is never sent', () => {
    const s = setup();
    const u = s.u();
    for (let i = 0; i < 50; i++) u.count('open');
    u.count('tab.summary');
    expect(s.writes()).toBe(0);
    u.leave(s.send, 'Parent 1', 'v1');
    expect(s.writes()).toBe(1);
    expect(s.sent).toEqual([]);
    expect(JSON.parse(s.kv.get(USAGE_KEY)!).days['2026-11-13']).toEqual({ open: 50, 'tab.summary': 1 });
    u.leave(s.send, 'Parent 1', 'v1'); // nothing changed: no second write
    expect(s.writes()).toBe(1);
  });

  it('the next day, past days go once in one request, by parent and phone, and are then forgotten', () => {
    const s = setup();
    const a = s.u();
    a.count('open');
    a.leave(s.send, 'Parent 1', 'v1');
    s.at('2026-11-14 08:00');
    const b = s.u(); // the app opened again the next day
    b.count('return');
    b.leave(s.send, 'Parent 1', 'v2');
    expect(s.sent).toEqual([{ action: 'usage', user: 'Parent 1', install: 'inst1', version: 'v2', days: [{ date: '2026-11-13', counts: { open: 1 } }] }]);
    b.leave(s.send, 'Parent 1', 'v2');
    expect(s.sent).toHaveLength(1);
    expect(b.peek()).toEqual({ '2026-11-14': { return: 1 } });
  });

  it('a counter this version no longer knows (renamed since) is left out, so the server does not refuse the day', () => {
    const s = setup();
    s.kv.set(USAGE_KEY, JSON.stringify({ install: 'old', days: { '2026-11-13': { open: 2, 'insights.timeline': 1 } } }));
    s.at('2026-11-14 08:00');
    s.u().leave(s.send, 'Parent 1', 'v2');
    expect(s.sent).toEqual([{ action: 'usage', user: 'Parent 1', install: 'old', version: 'v2', days: [{ date: '2026-11-13', counts: { open: 2 } }] }]);
  });

  it("the questions' state is kept per day (the last one of the day wins) and sent with that day", () => {
    const s = setup();
    const a = s.u();
    a.count('open');
    a.leave(s.send, 'Parent 1', 'v1', () => ({ gaps: 'waiting' }));
    a.leave(s.send, 'Parent 1', 'v1', () => ({ gaps: 'shown', night: 'off' }));
    s.at('2026-11-14 08:00');
    a.leave(s.send, 'Parent 1', 'v1', () => ({ gaps: 'shown', night: 'on' }));
    expect(s.sent).toEqual([{ action: 'usage', user: 'Parent 1', install: 'inst1', version: 'v1', days: [{ date: '2026-11-13', counts: { open: 1 }, states: { gaps: 'shown', night: 'off' } }] }]);
    expect(JSON.parse(s.kv.get(USAGE_KEY)!).states).toEqual({}); // sent: forgotten (today has no counts yet, so no state kept for it)
  });

  it('a question removed since (its state kept from the previous version) is left out of the day sent', () => {
    const s = setup();
    s.kv.set(USAGE_KEY, JSON.stringify({ install: 'old', days: { '2026-11-13': { open: 1 } }, states: { '2026-11-13': { gaps: 'shown', diaper: 'off' } } }));
    s.at('2026-11-14 08:00');
    s.u().leave(s.send, 'Parent 1', 'v3');
    expect(s.sent).toEqual([{ action: 'usage', user: 'Parent 1', install: 'old', version: 'v3', days: [{ date: '2026-11-13', counts: { open: 1 }, states: { gaps: 'shown' } }] }]);
  });

  it('a send the browser refused is kept for next time; without a parent chosen nothing is sent; at most 14 days are kept', () => {
    const s = setup();
    const a = s.u();
    a.count('open');
    s.at('2026-11-14 08:00');
    s.refuse(true);
    a.leave(s.send, 'Parent 1', 'v1');
    expect(s.sent).toHaveLength(1);
    expect(Object.keys(a.peek())).toEqual(['2026-11-13']);
    a.leave(s.send, undefined, 'v1');
    expect(s.sent).toHaveLength(1);
    for (let d = 1; d <= 20; d++) {
      s.at(`2026-12-${String(d).padStart(2, '0')} 08:00`);
      a.count('open');
    }
    a.leave(s.send, undefined, 'v1');
    expect(Object.keys(a.peek())).toHaveLength(14);
  });
});
