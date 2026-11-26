import { describe, expect, it } from 'vitest';
import { DAILY_PROPS_QUOTA, propsEstimate, quotaCheck } from '../src/shared/quota';

describe('the shared daily quota (owner, family servers)', () => {
  it('estimates property calls from the counted requests, operations and phones', () => {
    expect(propsEstimate({ requests: 500, ops: 40, phones: 2 })).toBe(500 + 120 + 4);
  });
  it('warns above 75% of the quota, and names a family far above the others (only with three servers or more)', () => {
    expect(quotaCheck([{ label: 'שלנו', calls: 1500 }, { label: 'א', calls: 1200 }])).toEqual({ total: 2700, share: 2700 / DAILY_PROPS_QUOTA, over: false, heavy: [] });
    expect(quotaCheck([{ label: 'שלנו', calls: 30_000 }, { label: 'א', calls: 8_000 }]).over).toBe(true);
    expect(quotaCheck([{ label: 'שלנו', calls: 1500 }, { label: 'א', calls: 1200 }, { label: 'ב', calls: 9000 }]).heavy).toEqual(['ב']);
    expect(quotaCheck([{ label: 'א', calls: 100 }, { label: 'ב', calls: 9000 }]).heavy).toEqual([]); // two servers: no median to speak of
    expect(quotaCheck([{ label: 'א', calls: null }, { label: 'ב', calls: 1000 }]).total).toBe(1000); // a server that did not answer
  });
});
