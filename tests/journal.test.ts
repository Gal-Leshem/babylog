import { describe, expect, it } from 'vitest';
import { MAX_BYTES, type Journal, parseJournal, record, since, utf8Bytes } from '../src/server/journal';
import { ev } from './helpers';

const e = (id: string, note = '') => ev({ id, type: 'feed', detail: 'left', start: '2026-11-14 10:00', user: 'P', note });
/** Revisions 1..n, one event each, starting from an empty journal at revision 0. */
const chain = (n: number, note = '', from: Journal | null = null): Journal => {
  let j = from;
  for (let r = 1; r <= n; r++) j = record(j, String(r - 1), String(r), { events: [e(`e${r}`, note)] });
  return j!;
};

describe('journal of recent changes ("changes since your version")', () => {
  it('tells a phone exactly what changed after its revision', () => {
    const j = chain(3);
    expect(since(j, '1', '3')!.events.map((x) => x.id)).toEqual(['e2', 'e3']);
    expect(since(j, '0', '3')!.events.map((x) => x.id)).toEqual(['e1', 'e2', 'e3']);
    expect(since(j, '3', '3')).toEqual({ rev: '3', events: [], settings: false });
  });

  it('an event changed twice is sent once, in its newest state', () => {
    let j = chain(2);
    j = record(j, '2', '3', { events: [{ ...e('e1'), note: 'later' }] });
    const d = since(j, '0', '3')!;
    expect(d.events.map((x) => [x.id, x.note])).toEqual([['e2', ''], ['e1', 'later']]);
    expect(since(j, '2', '3')!.events.map((x) => x.id)).toEqual(['e1']); // a phone at 2 still gets the edit
  });

  it('settings changes are flagged', () => {
    let j = chain(1);
    j = record(j, '1', '2', { events: [], settings: true });
    expect(since(j, '1', '2')).toEqual({ rev: '2', events: [], settings: true });
    expect(since(j, '0', '2')!.settings).toBe(true);
    expect(since(chain(2), '0', '2')!.settings).toBe(false);
  });

  it('cannot tell (so the full list is sent): unknown or odd revisions, a journal not ending at the current one, none at all', () => {
    const j = chain(3);
    expect(since(j, 'x', '3')).toBeNull();
    expect(since(j, '4', '3')).toBeNull(); // a phone "ahead" of the server: something is off
    expect(since(j, '1', '4')).toBeNull(); // the revision moved without the journal
    expect(since(null, '1', '3')).toBeNull();
    expect(since(parseJournal('{broken'), '1', '3')).toBeNull();
  });

  it('a write that does not say what it changed starts the journal over', () => {
    const j = record(chain(3), '3', '4', undefined);
    expect(since(j, '3', '4')).toBeNull();
    expect(since(j, '4', '4')).toEqual({ rev: '4', events: [], settings: false });
    const k = record(j, '4', '5', { events: [e('n')] });
    expect(since(k, '4', '5')!.events.map((x) => x.id)).toEqual(['n']);
  });

  it('a journal that does not end where the revision was (lost, or from an older server) restarts from there', () => {
    const j = record(chain(3), '7', '8', { events: [e('n')] });
    expect(j.base).toBe(7);
    expect(since(j, '7', '8')!.events.map((x) => x.id)).toEqual(['n']);
    expect(since(j, '3', '8')).toBeNull();
  });

  it('stays within one script property: the oldest changes drop out and a phone that far behind gets the list', () => {
    const note = 'האכלה ארוכה בלילה, נרדם באמצע 🌙'.repeat(5);
    const j = chain(200, note);
    expect(utf8Bytes(JSON.stringify(j))).toBeLessThanOrEqual(MAX_BYTES);
    expect(j.items.length).toBeGreaterThan(5);
    expect(since(j, String(j.base), '200')!.events).toHaveLength(200 - j.base);
    expect(since(j, String(j.base - 1), '200')).toBeNull();
  });

  it('counts bytes as the property store does (Hebrew two, emoji four)', () => {
    expect(utf8Bytes('ab')).toBe(2);
    expect(utf8Bytes('שלום')).toBe(8);
    expect(utf8Bytes('🌙')).toBe(4);
    expect(utf8Bytes('—')).toBe(3);
  });
});
