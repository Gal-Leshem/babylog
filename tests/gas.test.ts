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

function boot(opts?: { url?: string | null }) {
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
    expect([...rt.sheets.keys()].sort()).toEqual(['Events', 'Settings', 'קרא אותי'].sort());
    expect(rt.sheets.get('Events')![0]).toEqual(['id', 'type', 'detail', 'start', 'end', 'user', 'source', 'note', 'created', 'edited', 'deleted']);
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

  it('rejects calls without the right key and bad JSON', () => {
    const { g, post } = boot();
    g.setup!();
    expect(post({ key: 'wrong', action: 'ping' })).toEqual({ ok: false, error: 'unauthorized' });
    expect(JSON.parse(g.doPost!({ postData: { contents: 'not json' } }).getContent())).toEqual({ ok: false, error: 'bad_request' });
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

  it('keeps settings in the Settings sheet', () => {
    const { rt, g, post } = boot();
    g.setup!();
    const key = rt.props.get('API_KEY')!;
    const r = post({ key, action: 'settings', set: { babyName: 'Baby', parents: ['A', 'B'], mergeWindowMin: 25 } });
    expect(r.settings).toEqual({ babyName: 'Baby', mergeWindowMin: 25, parents: ['A', 'B'] });
    expect(post({ key, action: 'settings' }).settings).toEqual(r.settings);
    expect(rt.sheets.get('Settings')).toContainEqual(['mergeWindowMin', 25]);
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
