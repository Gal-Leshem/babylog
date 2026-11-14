/** localStorage that never throws (private mode, blocked storage) and tolerates corrupt data. */
export interface KV {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export const browserStorage: KV = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: the app keeps working in memory */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export function memoryStorage(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: <T,>(k: string) => {
      const v = data.get(k);
      if (v === undefined) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return null;
      }
    },
    set: (k, v) => void data.set(k, JSON.stringify(v)),
    remove: (k) => void data.delete(k),
  };
}
