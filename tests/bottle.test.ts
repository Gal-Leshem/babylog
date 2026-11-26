import { describe, expect, it } from 'vitest';
import { bottleDetail, eaten, feedingOf, parseBottle } from '../src/shared/bottle';

describe('bottle detail (F18)', () => {
  it('reads and writes the kind and the amounts', () => {
    expect(parseBottle('formula:90')).toEqual({ kind: 'formula', given: 90, left: 0 });
    expect(parseBottle('expressed:120:30')).toEqual({ kind: 'expressed', given: 120, left: 30 });
    expect(bottleDetail({ kind: 'formula', given: 90, left: 0 })).toBe('formula:90');
    expect(bottleDetail({ kind: 'expressed', given: 120, left: 30 })).toBe('expressed:120:30');
    expect(eaten({ kind: 'expressed', given: 120, left: 30 })).toBe(90);
    for (const bad of ['', 'formula', 'formula:4', 'formula:501', 'formula:90:91', 'cow:90', 'formula:090x', 'formula:90:-1']) expect(parseBottle(bad)).toBeNull();
  });
  it('families without feeding settings breastfeed only', () => {
    expect(feedingOf({})).toMatchObject({ breast: true, expressed: false, formula: false });
    expect(feedingOf({ feeding: { breast: false, expressed: false, formula: true, expressedMl: 60, formulaMl: 150 } }).formulaMl).toBe(150);
  });
});
