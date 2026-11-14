import { parseLocal } from '../src/shared/tz';
import type { BabyEvent } from '../src/shared/types';

let n = 0;
export function ev(p: Partial<BabyEvent> & Pick<BabyEvent, 'type'>): BabyEvent {
  n += 1;
  return {
    id: `e${n}`,
    detail: '',
    start: '',
    end: '',
    user: 'Parent 1',
    source: 'app',
    note: '',
    created: p.start ?? '',
    edited: '',
    deleted: false,
    ...p,
  };
}

export const T = (s: string): number => {
  const t = parseLocal(s);
  if (Number.isNaN(t)) throw new Error(`bad test time ${s}`);
  return t;
};
