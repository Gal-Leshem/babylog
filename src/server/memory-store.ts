import { DEFAULT_SETTINGS, type BabyEvent, type Settings } from '../shared/types';
import type { Store } from './core';

/** In-memory Store used by tests, the mock server and the app's optimistic layer. */
export class MemoryStore implements Store {
  private rows: BabyEvent[];
  private settings: Settings;
  private rev = 0;

  constructor(rows: readonly BabyEvent[] = [], settings: Settings = DEFAULT_SETTINGS) {
    this.rows = rows.map((r) => ({ ...r }));
    this.settings = { ...settings, parents: [...settings.parents] as [string, string] };
  }

  recent(n: number): BabyEvent[] {
    return this.rows.slice(-n).map((r) => ({ ...r }));
  }
  all(): BabyEvent[] {
    return this.rows.map((r) => ({ ...r }));
  }
  find(id: string): BabyEvent | undefined {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : undefined;
  }
  append(e: BabyEvent): void {
    this.rows.push({ ...e });
  }
  replace(e: BabyEvent): boolean {
    const i = this.rows.findIndex((x) => x.id === e.id);
    if (i < 0) return false;
    this.rows[i] = { ...e };
    return true;
  }
  getSettings(): Settings {
    return { ...this.settings, parents: [...this.settings.parents] as [string, string] };
  }
  setSettings(s: Settings): void {
    this.settings = { ...s, parents: [...s.parents] as [string, string] };
  }
  sheetUrl(): string {
    return '';
  }
  revision(): string {
    return String(this.rev);
  }
  bump(): void {
    this.rev += 1;
  }
}
