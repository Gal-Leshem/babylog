import { DEFAULT_VITAMIN_D } from '../src/shared/medicines';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { T } from './helpers';
import { createGasRuntime } from './gas-fake';

let code = '';
beforeAll(() => {
  execFileSync('npx', ['tsx', 'scripts/build-server.ts'], { stdio: 'pipe' });
  code = readFileSync('apps-script/dist/Code.js', 'utf8');
});

function boot(opts?: Parameters<typeof createGasRuntime>[0]) {
  const rt = createGasRuntime(opts);
  const g = rt.load(code);
  const post = (body: unknown) => JSON.parse(g.doPost!({ postData: { contents: JSON.stringify(body) } }).getContent());
  return { rt, g, post };
}

describe('built Apps Script bundle against a fake Google runtime', () => {
  it('declares the entry points as top-level functions, which is what the editor lists', () => {
    // The Apps Script editor finds functions statically; a function attached at run time shows as "No function".
    for (const f of ['doPost', 'doGet', 'setup', 'rotateKey', 'printInstallCode']) {
      expect(code, f).toMatch(new RegExp(`^function ${f}\\(`, 'm'));
    }
  });

  it('exposes the entry points as globals', () => {
    const { g } = boot();
    for (const f of ['doPost', 'doGet', 'setup', 'rotateKey', 'printInstallCode']) expect(typeof g[f]).toBe('function');
    expect(JSON.parse(g.doGet!().getContent())).toMatchObject({ ok: true, app: 'babylog' });
  });

  it('setup creates sheets, a key and a decodable install code', () => {
    const { rt, g } = boot();
    g.setup!();
    expect([...rt.sheets.keys()].sort()).toEqual(['Events', 'Medicines', 'Settings', 'קרא אותי'].sort());
    expect(rt.sheets.get('Events')![0]).toEqual(['id', 'type', 'detail', 'start', 'end', 'user', 'source', 'note', 'created', 'edited', 'deleted', 'prev']);
    const key = rt.props.get('API_KEY')!;
    expect(key).toHaveLength(64);
    const line = rt.logs.find((l) => l.startsWith('BL1.'))!;
    const decoded = JSON.parse(Buffer.from(line.slice(4), 'base64url').toString('utf8'));
    expect(decoded).toEqual({ u: 'https://script.google.com/macros/s/FAKE/exec', k: key });
  });

  it('setup is repeatable and keeps the key and the data', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    post({ key, action: 'log', id: 'x1', type: 'diaper', detail: 'wet', start: '2000-01-01 00:00', user: 'P', source: 'app' });
    g.setup!();
    expect(rt.props.get('API_KEY')).toBe(key);
    expect(rt.sheets.get('Events')!.length).toBe(2);
  });

  it('falls back with guidance when the web app URL is unavailable', () => {
    const { rt, g } = boot({ url: null });
    g.setup!();
    expect(rt.logs.some((l) => l.startsWith('KEY: '))).toBe(true);
    expect(rt.logs.some((l) => l.startsWith('BL1.'))).toBe(false);
  });

  it('warns when only the editor test address (/dev) is available, but still prints a code', () => {
    const { rt, g } = boot({ url: 'https://script.google.com/macros/s/FAKE/dev' });
    g.setup!();
    expect(rt.logs.some((l) => l.startsWith('WARNING') && l.includes('/dev'))).toBe(true);
    expect(rt.logs.some((l) => l.startsWith('BL1.'))).toBe(true);
  });

  it('does not warn for a proper /exec address', () => {
    const { rt, g } = boot();
    g.setup!();
    expect(rt.logs.some((l) => l.startsWith('WARNING'))).toBe(false);
  });

  it('rejects calls without the right key and bad JSON', () => {
    const { g, post } = boot();
    g.setup!();
    expect(post({ key: 'wrong', action: 'ping' })).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(JSON.parse(g.doPost!({ postData: { contents: 'not json' } }).getContent())).toMatchObject({ ok: false, error: 'bad_request' });
  });

  // API 0.4.0: a phone's whole exchange in one request, through the real sheet code
  it('sync: applies a batch through the sheet, answers "unchanged" to an up-to-date phone, and reports its own time', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    const day = '2026-01-10';
    const range = { from: day, to: day };
    const first = post({ key, action: 'sync', ...range });
    expect(first.events).toEqual([]);
    const ops = [
      { action: 'log', id: 'f1', type: 'feed', detail: 'left', start: `${day} 01:00`, user: 'P', source: 'app' },
      { action: 'asleep', id: 's1', start: `${day} 02:00`, user: 'P', source: 'app' },
      { action: 'awake', id: 's2', end: `${day} 03:30`, user: 'P', source: 'app' },
    ];
    const r = post({ key, action: 'sync', ...range, rev: first.rev, ops });
    expect(r).toMatchObject({ ok: true, unchanged: true });
    expect(r.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, true, true]);
    expect(r.rev).not.toBe(first.rev);
    expect(rt.sheets.get('Events')!.slice(1).map((row) => row[0])).toEqual(['f1', 's1']);
    expect(rt.openLocks()).toBe(0);

    const idleCheck = post({ key, action: 'sync', ...range, rev: r.rev });
    expect(idleCheck).toMatchObject({ ok: true, unchanged: true, rev: r.rev });
    expect(idleCheck.events).toBeUndefined();
    expect(typeof idleCheck.ms).toBe('number');
    expect(idleCheck.t).toBeUndefined(); // the breakdown only on request

    const other = post({ key, action: 'log', id: 'd1', type: 'diaper', detail: 'wet', start: `${day} 04:00`, user: 'Q', source: 'app' });
    expect(other.ok).toBe(true);
    const news = post({ key, action: 'sync', ...range, rev: r.rev, debug: true });
    expect(news.events.map((e: { id: string }) => e.id)).toEqual(['f1', 's1', 'd1']);
    expect(news.t['read#']).toBeGreaterThan(0);
  });

  it('runs a full day of logging through the sheet and releases the lock', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    const base = { key, user: 'P', source: 'app' as const };
    // Times in the past avoid depending on the wall clock.
    const day = '2026-01-10';
    const a = post({ ...base, action: 'log', id: 'f1', type: 'feed', detail: 'left', start: `${day} 01:00` });
    expect(a).toMatchObject({ ok: true });
    expect(post({ ...base, action: 'log', id: 'f1', type: 'feed', detail: 'left', start: `${day} 01:00` })).toMatchObject({ ok: true, duplicate: true });
    post({ ...base, action: 'log', id: 'd1', type: 'diaper', detail: 'both', start: `${day} 01:30` });
    post({ ...base, action: 'asleep', id: 's1', start: `${day} 02:00` });
    expect(post({ ...base, action: 'awake', id: 's2', end: `${day} 03:30` })).toMatchObject({ ok: true, speech: 'Awake. Slept 1 hour 30 minutes' });

    const list = post({ key, action: 'list', from: day, to: day });
    expect(list.ok).toBe(true);
    expect(list.events.map((e: { id: string }) => e.id)).toEqual(['f1', 'd1', 's1']);
    expect(list.events[2]).toMatchObject({ start: `${day} 02:00`, end: `${day} 03:30`, type: 'sleep' });
    expect(list.settings.mergeWindowMin).toBe(20);

    const del = post({ key, action: 'delete', id: 'd1' });
    expect(del.event.deleted).toBe(true);
    expect(post({ key, action: 'list', from: day, to: day }).events).toHaveLength(2);
    expect(rt.sheets.get('Events')!.length).toBe(4); // header + 3 rows, nothing removed
    expect(rt.openLocks()).toBe(0);
  });

  it('stores times as real dates in the sheet and reads them back unchanged', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    post({ key, action: 'log', id: 'x', type: 'feed', detail: 'right', start: '2026-07-04 23:59', user: 'P', source: 'siri' });
    const row = rt.sheets.get('Events')![1]!;
    // The Date comes from the sandbox realm, so check its type tag instead of instanceof.
    expect(Object.prototype.toString.call(row[3])).toBe('[object Date]');
    expect((row[3] as Date).getTime()).toBe(T('2026-07-04 23:59'));
    expect(post({ key, action: 'list', from: '2026-07-04', to: '2026-07-04' }).events[0].start).toBe('2026-07-04 23:59');
  });

  it('keeps the data revision in a script property, so every phone sees the same number', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    const rev = () => post({ key, action: 'poll' }).rev;
    expect(rev()).toBe('0');
    post({ key, action: 'log', id: 'r1', type: 'diaper', detail: 'wet', start: '2000-01-01 00:00', user: 'P', source: 'app' });
    expect(rev()).toBe('1');
    post({ key, action: 'log', id: 'r1', type: 'diaper', detail: 'wet', start: '2000-01-01 00:00', user: 'P', source: 'app' }); // duplicate
    expect(rev()).toBe('1');
    post({ key, action: 'delete', id: 'r1' });
    expect(rev()).toBe('2');
    expect(rt.props.get('REV')).toBe('2');
  });

  it('keeps settings in the Settings sheet', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    const r = post({ key, action: 'settings', set: { babyName: 'Baby', parents: ['A', 'B'], mergeWindowMin: 25 } });
    expect(r.settings).toEqual({ babyName: 'Baby', mergeWindowMin: 25, parents: ['A', 'B'], medicines: [DEFAULT_VITAMIN_D] });
    expect(post({ key, action: 'settings' }).settings).toEqual(r.settings);
    expect(rt.sheets.get('Settings')).toContainEqual(['mergeWindowMin', 25]);
  });

  it('keeps medicines in their own readable sheet, one row each, and reads them back', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    // a sheet set up before medicines existed: no Medicines tab and an older guide
    rt.sheets.delete('Medicines');
    rt.sheets.set('קרא אותי', [['old guide']]);
    const med = { id: 'm1', name: 'אקמול', icon: '🍓', dose: '2.5', doseUnit: 'מ״ל', schedule: 'prn', minGapHours: 4, maxPerDay: 4, course: 'until', courseUntil: '2026-12-01' };
    const r = post({ key, action: 'settings', set: { medicines: [med] } });
    expect(r.ok).toBe(true);
    const rows = rt.sheets.get('Medicines')!;
    // new columns go at the end, so rows written by the first version still line up
    expect(rows[0]).toEqual(['id', 'name', 'dose', 'schedule', 'times_per_day', 'every_hours', 'min_gap_hours', 'max_per_day', 'course', 'course_count', 'status', 'created', 'icon', 'dose_unit', 'course_until']);
    expect(rows.map((r) => r[0])).toEqual(['id', 'vitamin_d', 'm1']); // vitamin D is written along, so the sheet shows it too
    expect(rows[2]!.slice(0, 11)).toEqual(['m1', 'אקמול', '2.5', 'prn', '', '', 4, 4, 'until', '', 'active']);
    expect(rows[2]!.slice(12)).toEqual(['🍓', 'מ״ל', "'2026-12-01"]);
    expect(post({ key, action: 'settings' }).settings.medicines).toEqual(r.settings.medicines);
    expect(JSON.stringify(rt.sheets.get('קרא אותי'))).toContain('Sheet \\"Medicines\\"');
    expect(post({ key, action: 'log', id: 'd1', type: 'medicine', detail: 'm1', start: '2000-01-01 08:00', user: 'P', source: 'app' }).ok).toBe(true);
    // archiving keeps the row, and a later names change does not lose the medicines
    post({ key, action: 'settings', set: { medicines: [{ ...med, status: 'archived' }] } });
    post({ key, action: 'settings', set: { babyName: 'B' } });
    expect(post({ key, action: 'settings' }).settings.medicines.map((m: { status: string }) => m.status)).toEqual(['active', 'archived']);
    // the sheet may hand the date back with its apostrophe, or as a date: both read as the same day
    expect(post({ key, action: 'settings' }).settings.medicines[1].courseUntil).toBe('2026-12-01');
    // (the server keeps a copy of the settings; these two checks are about reading the sheet itself, so the copy is dropped)
    rt.sheets.get('Medicines')![2]![14] = new Date('2026-12-01T10:00:00Z');
    rt.props.delete('SETTINGS_JSON');
    expect(post({ key, action: 'settings' }).settings.medicines[1].courseUntil).toBe('2026-12-01');
    // a row written by the first version (12 columns, dose as free text) still reads
    rt.sheets.get('Medicines')!.push(['old', 'ישן', '5 מ״ל', 'daily', '', '', '', '', 'none', '', 'active', '']);
    rt.props.delete('SETTINGS_JSON');
    expect(post({ key, action: 'settings' }).settings.medicines[2]).toMatchObject({ id: 'old', dose: '5 מ״ל', doseUnit: '', icon: '💊', course: 'none' });
  });

  // Measured on the real server: reading the settings tabs took 0.5 to 2 s of every list; properties 20 to 400 ms per call.
  describe('cheap requests: a copy of the settings, properties read once', () => {
    const day = '2026-01-10';
    const range = { from: day, to: day };
    const start = () => {
      const b = boot();
      b.g.setup!();
      const key = b.rt.props.get('API_KEY')!;
      const count = <T,>(fn: () => T) => {
        const before = { ...b.rt.calls };
        const out = fn();
        return { out, props: b.rt.calls.props - before.props, values: b.rt.calls.values - before.values, find: b.rt.calls.find - before.find };
      };
      return { ...b, key, count };
    };

    it('a list reads the settings tabs only the first time; later lists read just the events', () => {
      const { post, key, count } = start();
      post({ key, action: 'log', id: 'f0', type: 'feed', detail: 'left', start: `${day} 01:00`, user: 'P', source: 'app' });
      post({ key, action: 'sync', ...range }); // fills the copy
      const second = count(() => post({ key, action: 'sync', ...range }));
      expect(second.out.settings.medicines).toEqual([DEFAULT_VITAMIN_D]);
      expect(second.values, 'one read: the events').toBe(1);
      expect(second.props, 'one call for all properties').toBe(1);
    });

    it('a check with nothing new is ONE call to Google (the properties) and no sheet read', () => {
      const { post, key, count } = start();
      const first = post({ key, action: 'sync', ...range });
      const check = count(() => post({ key, action: 'sync', ...range, rev: first.rev }));
      expect(check.out.unchanged).toBe(true);
      expect([check.props, check.values, check.find]).toEqual([1, 0, 0]);
    });

    // Owner, after reading the sync log: catching up after the other parent wrote must not open the sheet.
    it('a phone a little behind gets only the changes: ONE call to Google (the properties) and no sheet read', () => {
      const { post, key, count } = start();
      const first = post({ key, action: 'sync', ...range });
      post({ key, action: 'log', id: 'f1', type: 'feed', detail: 'left', start: `${day} 01:00`, user: 'P2', source: 'app' });
      post({ key, action: 'sync', ...range, ops: [{ action: 'update', id: 'f1', patch: { note: 'שקט' } }] });
      const behind = count(() => post({ key, action: 'sync', ...range, rev: first.rev, delta: true }));
      expect(behind.out.changes.map((e: { id: string; note: string }) => [e.id, e.note])).toEqual([['f1', 'שקט']]);
      expect(behind.out.events).toBeUndefined();
      expect([behind.props, behind.values, behind.find]).toEqual([1, 0, 0]);
    });

    it('the revision and the journal of changes are written together in one call, and stay within the property limit', () => {
      const { rt, post, key, count } = start();
      const first = post({ key, action: 'sync', ...range });
      const tap = count(() => post({ key, action: 'log', id: 'n0', type: 'feed', detail: 'left', start: `${day} 01:00`, user: 'P', source: 'app' }));
      expect(tap.props, 'read, read under the lock, one write').toBe(3);
      const note = 'הערה ארוכה בעברית על הלילה 🌙 '.repeat(6).slice(0, 200);
      for (let i = 1; i <= 80; i++) expect(post({ key, action: 'log', id: `n${i}`, type: 'diaper', detail: 'wet', start: `${day} 02:00`, user: 'P', source: 'app', note }).ok).toBe(true);
      expect(Buffer.byteLength(rt.props.get('JOURNAL')!, 'utf8')).toBeLessThan(9000);
      const recent = post({ key, action: 'sync', ...range, rev: String(Number(rt.props.get('REV')) - 3), delta: true });
      expect(recent.changes.map((e: { id: string }) => e.id)).toEqual(['n78', 'n79', 'n80']);
      const far = post({ key, action: 'sync', ...range, rev: first.rev, delta: true }); // dropped out of the journal long ago
      expect(far.changes).toBeUndefined();
      expect(far.events).toHaveLength(81);
    });

    it('a saved change shows at once, on this request and the next ones', () => {
      const { post, key } = start();
      post({ key, action: 'sync', ...range });
      const saved = post({ key, action: 'settings', set: { babyName: 'New', medicines: [{ id: 'm1', name: 'ברזל', schedule: 'daily' }] } });
      expect(saved.settings.babyName).toBe('New');
      for (let i = 0; i < 2; i++) {
        const r = post({ key, action: 'sync', ...range });
        expect(r.settings.babyName).toBe('New');
        expect(r.settings.medicines.map((m: { id: string }) => m.id)).toEqual(['vitamin_d', 'm1']);
      }
      expect(post({ key, action: 'log', id: 'd1', type: 'medicine', detail: 'm1', start: `${day} 08:00`, user: 'P', source: 'app' }).ok).toBe(true);
    });

    it('a copy stored by a reader that raced with a save is ignored (it carries the older settings version)', () => {
      const { rt, post, key } = start();
      post({ key, action: 'sync', ...range });
      const stale = rt.props.get('SETTINGS_JSON')!; // what a slow reader is about to store
      post({ key, action: 'settings', set: { babyName: 'New' } });
      rt.props.set('SETTINGS_JSON', stale); // ...and it lands after the save
      expect(post({ key, action: 'sync', ...range }).settings.babyName).toBe('New');
    });

    it('settings too large for a property are simply read from the sheet every time', () => {
      const { rt, post, key } = start();
      const many = Array.from({ length: 29 }, (_, i) => ({ id: `m${i}`, name: `${'תרופה ארוכה מאוד '.repeat(3)}${i}`.slice(0, 30), schedule: 'prn', dose: '12.5', doseUnit: 'מ״ל', minGapHours: 4, maxPerDay: 4, course: 'until', courseUntil: '2026-12-01' }));
      for (let i = 0; i < 29; i += 10) expect(post({ key, action: 'settings', set: { medicines: many.slice(i, i + 10) } }).ok).toBe(true);
      const r = post({ key, action: 'sync', ...range });
      expect(r.settings.medicines).toHaveLength(30);
      expect((rt.props.get('SETTINGS_JSON') ?? '').includes('m28')).toBe(false);
      expect(post({ key, action: 'sync', ...range }).settings.medicines).toHaveLength(30);
    });

    it('running setup again takes in a hand edit of the settings tab', () => {
      const { rt, g, post, key } = start();
      post({ key, action: 'sync', ...range });
      rt.sheets.get('Settings')![0]![1] = 'ByHand';
      expect(post({ key, action: 'sync', ...range }).settings.babyName).not.toBe('ByHand'); // the copy still answers
      g.setup!();
      expect(post({ key, action: 'sync', ...range }).settings.babyName).toBe('ByHand');
    });

    it('a tap asks for the properties twice (before and under the lock) and writes the revision once', () => {
      const { post, key, count } = start();
      const first = post({ key, action: 'sync', ...range });
      const tap = count(() => post({ key, action: 'sync', ...range, rev: first.rev, ops: [{ action: 'log', id: 'f1', type: 'feed', detail: 'left', start: `${day} 01:00`, user: 'P', source: 'app' }] }));
      expect(tap.out.unchanged).toBe(true);
      expect(tap.props).toBe(3);
    });

    // (owner's sync log 3: a tap took 1.1 to 4.2 s on the server, of which 0.5 to 2.8 s was not timed: finding the Events tab
    // and counting its rows, several times per request; on the real sheet the spreadsheet loads on the first of these calls)
    it('a tap, a check after a foreign write and an edit each find the Events tab once and count its rows once', () => {
      const { post, key, rt } = start();
      const first = post({ key, action: 'sync', ...range });
      const tabsAndRows = (fn: () => unknown) => {
        const before = { ...rt.calls };
        fn();
        return [rt.calls.tabs - before.tabs, rt.calls.lastRow - before.lastRow];
      };
      const op = { action: 'log', id: 'f1', type: 'feed', detail: 'left', start: `${day} 01:00`, user: 'P', source: 'app', fresh: true };
      expect(tabsAndRows(() => post({ key, action: 'sync', ...range, rev: first.rev, ops: [op] })), 'a tap').toEqual([1, 1]);
      expect(tabsAndRows(() => post({ key, action: 'sync', ...range, rev: first.rev })), 'the list').toEqual([1, 1]);
      expect(tabsAndRows(() => post({ key, action: 'sync', ...range, ops: [{ action: 'update', id: 'f1', patch: { note: 'x' } }] })), 'an edit').toEqual([1, 1]);
      // three taps in one request: still once
      const three = [1, 2, 3].map((i) => ({ ...op, id: `t${i}` }));
      expect(tabsAndRows(() => post({ key, action: 'sync', ...range, ops: three })), 'three taps').toEqual([1, 1]);
      expect(rt.sheets.get('Events')!.filter((r) => /^t\d$/.test(String(r[0])))).toHaveLength(3);
    });

    it('rows that another request wrote while this one waited for the lock are seen (a re-sent entry is not written twice)', () => {
      let other: (() => void) | null = null;
      const b = boot({ whileWaitingForLock: () => { const run = other; other = null; run?.(); } });
      b.g.setup!();
      const key = b.rt.props.get('API_KEY')!;
      const op = { action: 'log', id: 'b1', type: 'feed', detail: 'left', start: `${day} 01:00`, user: 'P', source: 'app' };
      // the phone's beacon delivers the entry while the phone's own retry of it waits for the lock
      other = () => b.post({ key, ...op });
      const retry = b.post({ key, action: 'sync', ...range, ops: [{ ...op, queuedAt: Date.now() }] });
      expect(retry.results[0].ok).toBe(true);
      expect(b.rt.sheets.get('Events')!.filter((r) => r[0] === 'b1')).toHaveLength(1);
    });

    it('a first-attempt tap, a retry and an edit of a recent entry do not search the whole sheet', () => {
      const { post, key, count } = start();
      const first = post({ key, action: 'sync', ...range });
      const op = { action: 'log', id: 'f1', type: 'feed', detail: 'left', start: `${day} 01:00`, user: 'P', source: 'app' };
      const tap = count(() => post({ key, action: 'sync', ...range, rev: first.rev, ops: [{ ...op, fresh: true }] }));
      expect(tap.find).toBe(0);
      const retry = count(() => post({ key, action: 'sync', ...range, ops: [op] }));
      expect(retry.out.results[0].duplicate).toBe(true);
      expect(retry.find, 'a short sheet: the recent rows are all of it').toBe(0);
      const edit = count(() => post({ key, action: 'sync', ...range, ops: [{ action: 'update', id: 'f1', patch: { note: 'x' } }] }));
      expect(edit.out.results[0].event.note).toBe('x');
      // (owner's sync log: each "היה לפני" move searched the whole sheet) a recent entry is found in the recent rows
      expect(edit.find, 'a recent entry is not searched for').toBe(0);
      const del = count(() => post({ key, action: 'sync', ...range, ops: [{ action: 'delete', id: 'f1' }] }));
      expect([del.out.results[0].event.deleted, del.find]).toEqual([true, 0]);
    });

    it('on a long sheet a retry that says when it was queued is not searched for; one that does not (an older app) is', () => {
      const { post, key, count } = start();
      for (let i = 0; i < 510; i++) post({ key, action: 'log', id: `n${i}`, type: 'diaper', detail: 'wet', start: `${day} 01:00`, user: 'P', source: 'app' });
      const op = { action: 'log', id: 'r1', type: 'feed', detail: 'left', start: `${day} 02:00`, user: 'P', source: 'app' };
      // the sheet's rows were all written "now" in this test: queued a day and a half later, the recent rows reach back before it
      const later = count(() => post({ key, action: 'sync', ...range, ops: [{ ...op, queuedAt: Date.now() + 36 * 3_600_000 }] }));
      expect([later.out.results[0].ok, later.find]).toEqual([true, 0]);
      const old = count(() => post({ key, action: 'sync', ...range, ops: [{ ...op, id: 'r2' }] }));
      expect([old.out.results[0].ok, old.find]).toEqual([true, 1]);
    }, 60_000); // 500+ requests through the built bundle: about 1 s here, over 5 s on a busy CI runner

    it('an edit of an entry older than the recent rows still finds it (one search) and writes the right row', () => {
      const { rt, post, key, count } = start();
      post({ key, action: 'log', id: 'old', type: 'feed', detail: 'left', start: `${day} 00:30`, user: 'P', source: 'app' });
      for (let i = 0; i < 520; i++) post({ key, action: 'log', id: `n${i}`, type: 'diaper', detail: 'wet', start: `${day} 01:00`, user: 'P', source: 'app' });
      const edit = count(() => post({ key, action: 'sync', ...range, ops: [{ action: 'update', id: 'old', patch: { note: 'x' } }] }));
      expect(edit.out.results[0].event.note).toBe('x');
      expect(edit.find).toBe(1);
      const rows = rt.sheets.get('Events')!;
      expect(rows.find((r) => r[0] === 'old')![7]).toBe('x');
      expect(rows.filter((r) => r[7] === 'x')).toHaveLength(1);
    }, 60_000); // 500+ requests through the built bundle: about 1 s here, over 5 s on a busy CI runner

    it('the revision is read under the lock: a write that slipped in while waiting for it is not missed', () => {
      const { rt, post, key } = start();
      const first = post({ key, action: 'sync', ...range });
      // the other phone writes between this request's first look at the properties and its turn with the lock
      const ctx = rt.context;
      const realLock = ctx.LockService.getScriptLock;
      ctx.LockService.getScriptLock = () => {
        const l = realLock();
        return { ...l, waitLock: (ms: number) => (rt.props.set('REV', String(Number(rt.props.get('REV') ?? '0') + 1)), l.waitLock(ms)) };
      };
      const r = post({ key, action: 'sync', ...range, rev: first.rev, ops: [{ action: 'log', id: 'f1', type: 'feed', detail: 'left', start: `${day} 01:00`, user: 'P', source: 'app' }] });
      ctx.LockService.getScriptLock = realLock;
      expect(r.unchanged, 'someone else wrote: the list must come back').toBeUndefined();
      expect(r.events).toHaveLength(1);
      expect(Number(r.rev)).toBe(Number(first.rev) + 2); // theirs and ours
    });
  });

  // Owner: an edit made by mistake must be undoable later, also from the other phone: the version before the last edit is kept.
  it('an edit keeps the version before it in a "prev" column, added to a sheet made before that column existed', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    const ev = rt.sheets.get('Events')!;
    ev[0] = ev[0]!.slice(0, 11); // a sheet from before the column
    const day = '2026-01-10';
    post({ key, action: 'log', id: 's1', type: 'sleep', detail: '', start: `${day} 01:00`, user: 'P', source: 'app' });
    expect(rt.sheets.get('Events')![0]).toHaveLength(11); // a log does not need the column
    const r = post({ key, action: 'update', id: 's1', patch: { start: `${day} 01:30`, end: `${day} 03:00` } });
    expect(JSON.parse(r.event.prev)).toEqual({ type: 'sleep', detail: '', start: `${day} 01:00`, end: '', note: '' });
    expect(rt.sheets.get('Events')![0]![11]).toBe('prev');
    const listed = post({ key, action: 'list', from: day, to: day }).events[0];
    expect(JSON.parse(listed.prev).start).toBe(`${day} 01:00`);
    // restoring is an ordinary edit back to those values; its own "before" is the mistaken version
    const back = post({ key, action: 'update', id: 's1', patch: JSON.parse(listed.prev) });
    expect(back.event).toMatchObject({ start: `${day} 01:00`, end: '' });
    expect(JSON.parse(back.event.prev)).toMatchObject({ start: `${day} 01:30`, end: `${day} 03:00` });
  });

  it('every answer says which build it comes from (the live test waits for the new one after a deploy)', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    const build = post({ key, action: 'ping' }).build;
    expect(build).toBe((process.env.GITHUB_SHA ?? 'local').slice(0, 7));
    expect(post({ key: 'wrong', action: 'ping' }).build).toBe(build);
  });

  it("the baby's sex is a row of the Settings sheet and survives the settings copy", () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    expect(post({ key, action: 'settings' }).settings.babySex).toBeUndefined();
    post({ key, action: 'settings', set: { babySex: 'girl' } });
    expect(rt.sheets.get('Settings')!.some((r) => r[0] === 'babySex' && r[1] === 'girl')).toBe(true);
    expect(post({ key, action: 'sync', from: '2026-01-10', to: '2026-01-10' }).settings.babySex).toBe('girl');
    rt.props.delete('SETTINGS_JSON'); // straight from the sheet as well
    expect(post({ key, action: 'settings' }).settings.babySex).toBe('girl');
  });

  it('usage (F15): a "שימוש" tab with a column per counter, a row per day / parent / phone, replaced when sent again, without the lock or a new revision', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    let taken = 0;
    rt.context.LockService = { getScriptLock: () => ({ waitLock: () => void taken++, tryLock: () => (taken++, true), releaseLock: () => undefined }) };
    const rev = rt.props.get('REV');
    const send = (user: string, install: string, days: unknown) => post({ key, action: 'usage', user, install, version: 'abc1234', days });
    expect(send('Parent 1', 'p1', [{ date: '2026-11-12', counts: { open: 3, 'summary.insights': 2 } }])).toMatchObject({ ok: true });
    expect(send('Parent 2', 'p2', [{ date: '2026-11-12', counts: { 'log.wet': 1 } }])).toMatchObject({ ok: true });
    expect(send('Parent 1', 'p1', [{ date: '2026-11-12', counts: { open: 5 } }, { date: '2026-11-13', counts: { open: 1 } }])).toMatchObject({ ok: true });
    const rows = rt.sheets.get('שימוש')!;
    const head = rows[0]!.map(String);
    expect(head.slice(0, 5)).toEqual(['תאריך', 'הורה', 'מכשיר', 'גרסה', 'עודכן']);
    const col = (label: string) => head.indexOf(label);
    expect(col('פתיחת האפליקציה')).toBeGreaterThan(4);
    expect(col('סיכום: תובנות')).toBeGreaterThan(4);
    const body = rows.slice(1).map((r) => [String(r[0]).replace(/^'/, ''), r[1], r[2], r[col('פתיחת האפליקציה')], r[col('סיכום: תובנות')], r[col('רישום: פיפי')]]);
    expect(body).toEqual([
      ['2026-11-12', 'Parent 1', 'p1', 5, '', ''], // sent again: replaced, not added
      ['2026-11-12', 'Parent 2', 'p2', '', '', 1],
      ['2026-11-13', 'Parent 1', 'p1', 1, '', ''],
    ]);
    expect(taken).toBe(0);
    expect(rt.props.get('REV')).toBe(rev);
    // (owner) the state of each question that day, in words, in a column per question
    send('Parent 1', 'p1', [{ date: '2026-11-14', counts: { open: 1, 'seen.gaps': 2 }, states: { gaps: 'shown', night: 'off', sides: 'waiting', nextFeed: 'on' } }]);
    const h2 = rows[0]!.map(String);
    const last = rows[rows.length - 1]!;
    expect(last[h2.indexOf('שאלה: כל כמה זמן מאכילים')]).toBe('מוצגת');
    expect(last[h2.indexOf('שאלה: הרצף הארוך בלילה')]).toBe('כובתה ידנית');
    expect(last[h2.indexOf('שאלה: ימין ושמאל')]).toBe('ממתינה לנתונים');
    expect(last[h2.indexOf('שאלה: ההנקה הבאה')]).toBe('הודלקה ידנית');
    expect(last[h2.indexOf('נצפתה: כל כמה זמן מאכילים')]).toBe(2);
  });

  it('(F18) the feeding settings are rows of the Settings sheet, read back after the stored copy is gone; broken by hand: ignored', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    expect(post({ key, action: 'settings' }).settings.feeding).toBeUndefined();
    const f = { breast: false, expressed: true, formula: true, expressedMl: 70, formulaMl: 120 };
    post({ key, action: 'settings', set: { feeding: f } });
    const rows = rt.sheets.get('Settings')!;
    expect(rows.find((r) => r[0] === 'mlFormula')![1]).toBe(120);
    rt.props.delete('SETTINGS_JSON');
    expect(post({ key, action: 'settings' }).settings.feeding).toEqual(f);
    // the owner breaks an amount by hand: the default amount instead; a kind broken by hand: no feeding settings at all
    rows.find((r) => r[0] === 'mlFormula')![1] = 'lots';
    rt.props.delete('SETTINGS_JSON');
    expect(post({ key, action: 'settings' }).settings.feeding).toEqual({ ...f, formulaMl: 90 });
    rows.find((r) => r[0] === 'feedBreast')![1] = 'maybe';
    rt.props.delete('SETTINGS_JSON');
    expect(post({ key, action: 'settings' }).settings.feeding).toBeUndefined();
    // a bottle is logged through the real bundle
    expect(post({ key, action: 'log', id: 'b1', type: 'bottle', detail: 'formula:120:30', start: '2026-11-14 11:00', user: 'P', source: 'app' }).ok).toBe(true);
  });

  it("the baby's date of birth is a text row of the Settings sheet; a date typed by hand is read as that day", () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    expect(post({ key, action: 'settings' }).settings.babyBirth).toBeUndefined();
    post({ key, action: 'settings', set: { babyBirth: '2026-09-14' } });
    expect(rt.sheets.get('Settings')!.some((r) => r[0] === 'babyBirth' && r[1] === "'2026-09-14")).toBe(true);
    rt.props.delete('SETTINGS_JSON');
    expect(post({ key, action: 'settings' }).settings.babyBirth).toBe('2026-09-14');
    // the owner fixes it in the sheet by hand: Sheets keeps a Date there
    const row = rt.sheets.get('Settings')!.find((r) => r[0] === 'babyBirth')!;
    row[1] = new Date('2026-09-13T22:00:00Z'); // midnight of 14 September in Israel
    rt.props.delete('SETTINGS_JSON');
    expect(post({ key, action: 'settings' }).settings.babyBirth).toBe('2026-09-14');
  });

  // A text that starts like a formula must stay text in the sheet (Sheets would compute "=1+1").
  it('feedback starting with = + - or @ is kept as text in the sheet and comes back unchanged', () => {
    const b = boot();
    b.g.setup!();
    const key = b.rt.props.get('API_KEY')!;
    const r = b.post({ key, action: 'feedback', id: 'fx', kind: 'other', text: '=1+1 ולא 2', user: 'P', version: 'v' });
    expect(r.ok).toBe(true);
    const row = b.rt.sheets.get('משוב')!.find((x) => x[7] === 'fx')!;
    expect(row[4]).toBe("'=1+1 ולא 2");
    expect(b.post({ key, action: 'feedbackList' }).feedback[0].text).toBe('=1+1 ולא 2');
  });

  // Owner: feedback in its own readable tab; the number lives in a script property and survives clearing.
  it('feedback: a readable "משוב" tab, numbers that go on after clearing, a retry stored once', () => {
    const b = boot();
    b.g.setup!();
    const key = b.rt.props.get('API_KEY')!;
    const send = (id: string, kind: string, text: string) => b.post({ key, action: 'feedback', id, kind, text, user: 'P', version: 'abc1234', log: 'line' });
    expect(b.post({ key, action: 'feedbackList' }).feedback).toEqual([]); // no tab yet: nothing, and nothing created
    expect(b.rt.sheets.has('משוב')).toBe(false);
    expect(send('a', 'bug', 'טקסט ראשון').item.no).toBe(1);
    expect(send('b', 'idea', 'רעיון חדש').item.no).toBe(2);
    expect(send('a', 'bug', 'טקסט ראשון').duplicate).toBe(true);
    const tab = b.rt.sheets.get('משוב')!;
    expect(tab[0]).toEqual(['מספר', 'נוצר', 'מי', 'סוג', 'טקסט', 'גרסה', 'יומן סנכרון', 'id']);
    expect(tab[2]!.slice(2, 6)).toEqual(['P', 'רעיון', 'רעיון חדש', 'abc1234']);
    const list = b.post({ key, action: 'feedbackList' }).feedback;
    expect(list.map((f: { no: number; kind: string; log: string }) => [f.no, f.kind, f.log])).toEqual([
      [1, 'bug', 'line'],
      [2, 'idea', 'line'],
    ]);
    expect(list[0].created).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/);
    expect(b.post({ key, action: 'feedbackClear' }).feedback).toEqual([]);
    expect(b.post({ key, action: 'feedbackList' }).feedback).toEqual([]);
    expect(tab[0]![0]).toBe('מספר'); // the titles stay
    expect(send('c', 'other', 'עוד').item.no).toBe(3);
    expect(b.rt.props.get('FEEDBACK_SEQ')).toBe('3');
    expect(b.post({ key, action: 'feedbackList' }).feedback.map((f: { no: number }) => f.no)).toEqual([3]);
  });

  it('rotateKey invalidates the old key', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const old = rt.props.get('API_KEY')!;
    g.rotateKey!();
    expect(rt.props.get('API_KEY')).not.toBe(old);
    expect(post({ key: old, action: 'ping' })).toMatchObject({ ok: false, error: 'unauthorized' });
  });
});

// Owner (family servers): the same bundle built with --family is a family's server.
describe('the bundle built for a family (--family)', () => {
  let famCode = '';
  beforeAll(() => {
    execFileSync('npx', ['tsx', 'scripts/build-server.ts', '--family'], { stdio: 'pipe' });
    famCode = readFileSync('apps-script/dist/Code.js', 'utf8');
    execFileSync('npx', ['tsx', 'scripts/build-server.ts'], { stdio: 'pipe' }); // leave the owner's build in place
  });
  const bootFam = () => {
    const rt = createGasRuntime();
    const g = rt.load(famCode);
    const post = (body: unknown) => JSON.parse(g.doPost!({ postData: { contents: JSON.stringify(body) } }).getContent());
    return { rt, g, post };
  };

  it("setup makes a separate admin key and prints the admin code for the owner after the family's code", () => {
    const { rt, g } = bootFam();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    const admin = rt.props.get('ADMIN_KEY')!;
    expect(admin).toHaveLength(64);
    expect(admin).not.toBe(key);
    const decode = (l: string) => JSON.parse(Buffer.from(l.slice(4), 'base64url').toString('utf8'));
    const famLine = rt.logs.findIndex((l) => l.startsWith('BL1.'));
    const adminLine = rt.logs.findIndex((l) => l.startsWith('BLA.'));
    expect(decode(rt.logs[famLine]!)).toEqual({ u: 'https://script.google.com/macros/s/FAKE/exec', k: key });
    expect(decode(rt.logs[adminLine]!)).toEqual({ u: 'https://script.google.com/macros/s/FAKE/exec', k: admin });
    expect(adminLine).toBeGreaterThan(famLine);
    g.setup!(); // repeatable: the keys stay
    expect([rt.props.get('API_KEY'), rt.props.get('ADMIN_KEY')]).toEqual([key, admin]);
  });

  it("works for the family, gives no sheet link, and keeps the feedback for the owner's admin key", () => {
    const { rt, g, post } = bootFam();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    const admin = rt.props.get('ADMIN_KEY')!;
    expect(post({ key, action: 'log', id: 'x1', type: 'diaper', detail: 'wet', start: '2000-01-01 00:00', user: 'P', source: 'app' }).ok).toBe(true);
    const s = post({ key, action: 'settings' });
    expect(s.ok).toBe(true);
    expect(s.sheetUrl).toBeUndefined();
    expect(post({ key, action: 'feedback', id: 'f1', kind: 'idea', text: 'רעיון', user: 'P' }).item.no).toBe(1);
    expect(post({ key, action: 'feedbackList' }).error).toBe('send_only');
    expect(post({ key: admin, action: 'feedbackList' }).feedback.map((f: { id: string }) => f.id)).toEqual(['f1']);
    expect(post({ key: admin, action: 'list', from: '2000-01-01', to: '2000-01-01' }).error).toBe('unauthorized');
    expect(post({ key: admin, action: 'feedbackClear', ids: ['f1'] }).feedback).toEqual([]);
  });

  it("the admin key reads the day totals of the phones' request counts from the usage tab (numbers only)", () => {
    const { rt, g, post } = bootFam();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    const admin = rt.props.get('ADMIN_KEY')!;
    const today = post({ key, action: 'ping' }).serverNow.slice(0, 10);
    expect(post({ key, action: 'usage', user: 'P', install: 'i1', days: [{ date: today, counts: { 'sync.requests': 120, 'sync.ops': 7 } }] }).ok).toBe(true);
    expect(post({ key, action: 'usage', user: 'Q', install: 'i2', days: [{ date: today, counts: { 'sync.requests': 30 } }] }).ok).toBe(true);
    const r = post({ key: admin, action: 'usageTotals', days: 1 });
    expect(r.usageTotals).toEqual([{ date: today, requests: 150, ops: 7, phones: 2 }]);
    expect(post({ key, action: 'usageTotals' }).error).toBe('send_only');
  });

  it("the owner's build has no admin key: setup makes none and prints no admin code", () => {
    const { rt, g } = boot();
    g.setup!();
    expect(rt.props.has('ADMIN_KEY')).toBe(false);
    expect(rt.logs.some((l) => l.startsWith('BLA.'))).toBe(false);
  });
});
