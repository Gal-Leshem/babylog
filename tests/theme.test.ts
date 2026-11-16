import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { NightMode } from '../src/app/config';
import { isNight } from '../src/app/theme';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const boot = /<script id="theme-boot">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

/** Runs the inline boot script with a given stored preference, Israel hour and system dark mode; returns the <html> dataset. */
function runBoot(stored: string | null, hour: number, dark: boolean): Record<string, string> {
  const dataset: Record<string, string> = {};
  const utc = new Date(Date.UTC(2026, 0, 15, (hour - 2 + 24) % 24, 30)); // Israel is UTC+2 in January
  class FixedDate extends Date {
    constructor(...a: []) {
      super(...(a.length ? a : [utc.getTime()]) as [number]);
    }
  }
  runInNewContext(boot, {
    localStorage: { getItem: () => stored },
    matchMedia: () => ({ matches: dark }),
    document: { documentElement: { dataset } },
    Date: FixedDate,
    Intl,
    JSON,
  });
  return dataset;
}

describe('theme before first paint', () => {
  it('the inline script exists', () => expect(boot).toContain('dataset.theme'));

  it('agrees with isNight for every hour, mode and system setting', () => {
    for (const mode of ['auto', 'always', 'never'] as NightMode[])
      for (let h = 0; h < 24; h++)
        for (const dark of [false, true]) {
          const ds = runBoot(JSON.stringify({ nightMode: mode }), h, dark);
          expect(ds.theme, `${mode} ${h}:30 dark=${dark}`).toBe(isNight(mode, h, dark) ? 'night' : 'day');
        }
  });

  it('defaults to auto and amber without stored preferences, and tolerates corrupt storage', () => {
    expect(runBoot(null, 23, false)).toEqual({ theme: 'night', tint: 'amber' });
    expect(runBoot(null, 12, false)).toEqual({ theme: 'day', tint: 'amber' });
    expect(runBoot('{not json', 12, false)).toEqual({}); // the app sets the theme itself a moment later
    expect(runBoot(JSON.stringify({ nightTint: 'red' }), 2, false).tint).toBe('red');
  });
});
