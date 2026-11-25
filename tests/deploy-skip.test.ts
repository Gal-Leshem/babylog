import { describe, expect, it } from 'vitest';
import { bundleHash, deployedAs, describeAs } from '../scripts/deploy-skip';

// Apps Script keeps at most 200 versions a script (the test server reached it): an unchanged server is not deployed again.
describe('skipping a deploy of an unchanged server', () => {
  const code = (sha: string, extra = '') => `var x={build:${JSON.stringify(sha)}};function doPost(){}${extra}`;
  it('two commits with the same server code have the same hash; any other change, or another manifest, a different one', () => {
    expect(bundleHash(code('aaaaaaa'), '{}', 'aaaaaaa')).toBe(bundleHash(code('bbbbbbb'), '{}', 'bbbbbbb'));
    expect(bundleHash(code('aaaaaaa', ';1'), '{}', 'aaaaaaa')).not.toBe(bundleHash(code('bbbbbbb'), '{}', 'bbbbbbb'));
    expect(bundleHash(code('aaaaaaa'), '{"a":1}', 'aaaaaaa')).not.toBe(bundleHash(code('aaaaaaa'), '{}', 'aaaaaaa'));
  });
  it('the description carries the build and the hash; older descriptions never match (that deploy goes ahead)', () => {
    const h = bundleHash(code('abc1234'), '{}', 'abc1234');
    expect(deployedAs(describeAs('abc1234', h))).toEqual({ build: 'abc1234', hash: h });
    expect(deployedAs('babylog abc1234')).toBeNull();
    expect(deployedAs(undefined)).toBeNull();
  });
});
