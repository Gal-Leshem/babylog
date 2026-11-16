import type { NightMode } from './config';

/**
 * Whether the night theme is on. The same rule is repeated in a small inline script in index.html, which sets the theme
 * before the first paint (otherwise the app flashed day colours when opened at night); a unit test keeps the two identical.
 */
export function isNight(mode: NightMode, israelHour: number, systemDark: boolean): boolean {
  return mode === 'always' || (mode === 'auto' && (israelHour >= 21 || israelHour < 7 || systemDark));
}
