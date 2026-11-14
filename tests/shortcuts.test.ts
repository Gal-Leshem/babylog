import { beforeEach, describe, expect, it } from 'vitest';
import { type Deps, handle } from '../src/server/core';
import { MemoryStore } from '../src/server/memory-store';
import { formatLocal } from '../src/shared/tz';
import { FAILURE_PHRASE, PLACEHOLDER, SHORTCUTS, buildShortcut } from '../scripts/shortcuts/builder';
import { KNOWN_ACTIONS, parseShortcut, runShortcut } from './shortcut-interp';
import { T } from './helpers';

const KEY = 'a-test-key-1234567890';
let store: MemoryStore;
let now: number;
let rngSeed: number;

const rng = () => ((rngSeed = (rngSeed * 16807) % 2147483647) / 2147483647);
const deps = (): Deps => ({ store, now: () => now, checkKey: (k) => k === KEY, withLock: (f) => f() });

const fill = (xml: string, key = KEY, me = 'Parent One') =>
  xml.replaceAll(PLACEHOLDER.url, 'https://example.test/exec').replaceAll(PLACEHOLDER.key, key).replaceAll(PLACEHOLDER.me, me);

async function run(name: string, opts: { key?: string; offline?: boolean } = {}) {
  const spec = SHORTCUTS.find((s) => s.name === name)!;
  const sent: string[] = [];
  const result = await runShortcut(fill(buildShortcut(spec), opts.key), {
    now,
    random: rng,
    http: async (_url, body) => {
      if (opts.offline) throw new Error('The Internet connection appears to be offline.');
      sent.push(body);
      return JSON.stringify(handle(JSON.parse(body), deps()));
    },
  });
  return { ...result, sent: sent.map((s) => JSON.parse(s)) };
}

beforeEach(() => {
  store = new MemoryStore();
  now = T('2026-11-14 03:12') + 17_345; // with seconds and milliseconds
  rngSeed = 42;
});

describe('generated shortcut files', () => {
  it('are well-formed property lists using only verified actions', () => {
    for (const s of SHORTCUTS) {
      const wf = parseShortcut(buildShortcut(s));
      expect(wf.WFWorkflowActions.length).toBeGreaterThan(5);
      for (const a of wf.WFWorkflowActions) expect(KNOWN_ACTIONS).toContain(a.WFWorkflowActionIdentifier);
      expect(wf.WFWorkflowIcon.WFWorkflowIconGlyphNumber).toBeGreaterThan(0);
    }
  });

  it('keep every personal value out of the templates', () => {
    for (const s of SHORTCUTS) {
      const xml = buildShortcut(s);
      expect(xml).toContain(PLACEHOLDER.url);
      expect(xml).toContain(PLACEHOLDER.key);
      expect(xml).toContain(PLACEHOLDER.me);
      expect(xml).not.toMatch(/https?:\/\/(?!www\.apple\.com)/); // no addresses at all
    }
  });

  it('have unique names, the nine Siri phrases', () => {
    expect(SHORTCUTS.map((s) => s.name)).toEqual(['Left feed', 'Right feed', 'Wet diaper', 'Poop', 'Full diaper', 'Asleep', 'Awake', 'Vitamin D', 'Last feed']);
  });

  it('are deterministic', () => {
    expect(buildShortcut(SHORTCUTS[0]!)).toBe(buildShortcut(SHORTCUTS[0]!));
  });
});

describe('running the shortcuts against the real server logic', () => {
  it('Left feed logs a feed and speaks the answer', async () => {
    const r = await run('Left feed');
    expect(r.spoken).toEqual(['Logged left, 3:12. Next: right']);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({ type: 'feed', detail: 'left', start: '2026-11-14 03:12', user: 'Parent One', source: 'siri' });
    expect(r.sent[0]).toMatchObject({ key: KEY, action: 'log', type: 'feed', detail: 'left' });
  });

  it.each([
    ['Right feed', 'feed', 'right', 'Logged right, 3:12. Next: left'],
    ['Wet diaper', 'diaper', 'wet', 'Wet diaper logged, 3:12'],
    ['Poop', 'diaper', 'poop', 'Poop logged, 3:12'],
    ['Full diaper', 'diaper', 'both', 'Full diaper logged, 3:12'],
    ['Vitamin D', 'vitamin_d', '', 'Vitamin D logged for today'],
  ])('%s records the right event', async (name, type, detail, speech) => {
    const r = await run(name);
    expect(r.spoken).toEqual([speech]);
    expect(store.all()[0]).toMatchObject({ type, detail, source: 'siri' });
  });

  it('Asleep then Awake gives one sleep row and speaks the duration', async () => {
    expect((await run('Asleep')).spoken).toEqual(['Asleep at 3:12']);
    now += 85 * 60_000;
    expect((await run('Awake')).spoken).toEqual(['Awake. Slept 1 hour 25 minutes']);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({ start: '2026-11-14 03:12', end: '2026-11-14 04:37' });
  });

  it('Asleep while already asleep says so and writes nothing', async () => {
    await run('Asleep');
    now += 10 * 60_000;
    expect((await run('Asleep')).spoken).toEqual(['Already asleep since 3:12']);
    expect(store.all()).toHaveLength(1);
  });

  it('Last feed answers the question', async () => {
    expect((await run('Last feed')).spoken).toEqual(['No feeds logged yet']);
    await run('Left feed');
    now += 130 * 60_000;
    expect((await run('Last feed')).spoken).toEqual(['2 hours 10 minutes ago, left side. Next: right']);
    expect(store.all()).toHaveLength(1); // asking does not write
  });

  it('each run uses a fresh request id', async () => {
    const a = await run('Wet diaper');
    now += 1;
    const b = await run('Wet diaper');
    expect(a.sent[0].id).toMatch(/^siri-\d{17}-\d{6}$/);
    expect(a.sent[0].id).not.toBe(b.sent[0].id);
    expect(store.all()).toHaveLength(2);
  });

  it('a second vitamin D the same day is recorded with a warning phrase', async () => {
    await run('Vitamin D');
    now += 3_600_000;
    expect((await run('Vitamin D')).spoken).toEqual(['Vitamin D logged again. Already given today at 3:12']);
  });

  it('with the wrong key it says nothing was saved', async () => {
    const r = await run('Left feed', { key: 'wrong-key-wrong-key-1234' });
    expect(r.spoken).toEqual([FAILURE_PHRASE]);
    expect(store.all()).toHaveLength(0);
  });

  it('without a connection the shortcut stops with an error instead of pretending', async () => {
    await expect(run('Left feed', { offline: true })).rejects.toThrow(/offline/);
    expect(store.all()).toHaveLength(0);
  });

  it('time is sent in the format the server expects', async () => {
    const r = await run('Poop');
    expect(r.sent[0].start).toBe(formatLocal(now));
  });
});
