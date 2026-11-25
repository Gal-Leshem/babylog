import { createHash } from 'node:crypto';

/**
 * Apps Script keeps at most 200 versions per script, and every deploy makes one (the test server reached the limit in
 * November 2026: test is deployed for every dev AND main push). Most commits do not change the server at all (app, docs), so a
 * deploy is skipped when the server bundle is the same as the one the web app already runs. The bundle differs from commit to
 * commit only by its build id, so the hash leaves that out. The deployment's description carries the build and the hash.
 */
export function bundleHash(code: string, manifest: string, sha: string): string {
  const neutral = sha ? code.split(JSON.stringify(sha)).join('"BUILD"') : code;
  return createHash('sha256').update(neutral).update('\0').update(manifest).digest('hex').slice(0, 12);
}

export const describeAs = (sha: string, hash: string): string => `babylog ${sha} h:${hash}`;

/** The build and hash a deployment's description names (null for descriptions from before the hash, or anything else). */
export function deployedAs(description: string | undefined): { build: string; hash: string } | null {
  const m = /^babylog (\w+) h:([0-9a-f]{12})$/.exec(description ?? '');
  return m ? { build: m[1]!, hash: m[2]! } : null;
}
