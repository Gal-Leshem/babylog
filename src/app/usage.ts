import type { ApiRequest } from '../shared/protocol';
import { localDate } from '../shared/tz';
import { USAGE_MAX_DAYS, type UsageName } from '../shared/usage';

/**
 * (owner, F15) Usage counts of this phone, per day (numbers only). Costs nothing while the app is used: `count` adds one in
 * memory; the counts are written to the phone's storage only when the app is left, and whole past days are sent then, once,
 * in one background request (a beacon: nobody waits for it, it is not in the sync queue and takes no lock on the server).
 * A day whose beacon was not taken is sent the next time; one that was taken and lost is simply missing (analytics only).
 */
export interface UsageKV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const USAGE_KEY = 'bl.usage.v1';

interface Saved {
  install: string;
  days: Record<string, Record<string, number>>;
}

export class Usage {
  private saved: Saved | null = null;
  private dirty = false;

  constructor(
    private readonly storage: UsageKV,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => Math.random().toString(36).slice(2, 10),
  ) {}

  private data(): Saved {
    if (this.saved) return this.saved;
    let s: Partial<Saved> | null = null;
    try {
      s = JSON.parse(this.storage.getItem(USAGE_KEY) ?? 'null') as Partial<Saved> | null;
    } catch {
      s = null;
    }
    this.saved = { install: typeof s?.install === 'string' && s.install ? s.install : this.newId(), days: s?.days && typeof s.days === 'object' ? s.days : {} };
    if (!s?.install) this.dirty = true;
    return this.saved;
  }

  count(name: UsageName): void {
    const days = this.data().days;
    const d = (days[localDate(this.now())] ??= {});
    d[name] = (d[name] ?? 0) + 1;
    this.dirty = true;
  }

  /** The app is being left: keep the counts, and hand whole past days to `send` (once; kept for next time if it was refused). */
  leave(send: (req: ApiRequest) => boolean, user: string | undefined, version: string): void {
    const s = this.data();
    const today = localDate(this.now());
    const dates = Object.keys(s.days).sort();
    for (const d of dates.slice(0, Math.max(0, dates.length - USAGE_MAX_DAYS))) delete s.days[d]; // never grows without end
    const past = Object.keys(s.days).filter((d) => d < today).sort();
    if (user && past.length) {
      const ok = send({ action: 'usage', user, install: s.install, version, days: past.map((date) => ({ date, counts: s.days[date]! })) });
      if (ok) {
        for (const d of past) delete s.days[d];
        this.dirty = true;
      }
    }
    if (!this.dirty) return;
    try {
      this.storage.setItem(USAGE_KEY, JSON.stringify(s));
      this.dirty = false;
    } catch {
      /* storage full or blocked: the counts stay in memory */
    }
  }

  /** Counts kept on this phone (tests). */
  peek(): Record<string, Record<string, number>> {
    return this.data().days;
  }
}
