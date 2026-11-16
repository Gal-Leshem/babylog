import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The dev and main pipelines both write reports/<job>.json on the ci-status branch. When two runs published at the same moment,
// the rebase hit a conflict on that file, was aborted, and the report was lost (seen twice: a dev server report went missing).
const SCRIPT = join(process.cwd(), 'scripts/status-branch.sh');
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env, stdio: 'pipe' }).toString().trim();

function clone(root: string, origin: string, name: string): string {
  const dir = join(root, name);
  execFileSync('git', ['clone', '-q', `file://${origin}`, dir], { env, stdio: 'pipe' });
  return dir;
}
const run = (cwd: string, ...a: string[]) => spawnSync('bash', [SCRIPT, ...a], { cwd, env, encoding: 'utf8' });

describe('ci-status publishing', () => {
  it('two runs writing the same report file both get their commit in, the later one wins', () => {
    const root = mkdtempSync(join(tmpdir(), 'bl-status-'));
    const origin = join(root, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', origin], { env });
    const seedDir = join(root, 'seed');
    execFileSync('git', ['init', '-q', seedDir], { env });
    writeFileSync(join(seedDir, 'x'), 'x');
    git(seedDir, 'add', 'x');
    git(seedDir, 'commit', '-q', '-m', 'init');
    git(seedDir, 'push', '-q', `file://${origin}`, 'HEAD:refs/heads/main');
    execFileSync('git', ['--git-dir', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { env });

    const a = clone(root, origin, 'a');
    expect(run(a, 'init').status).toBe(0);
    writeFileSync(join(a, '.ci-status/reports/server.json'), '{"sha":"first"}');
    expect(run(a, 'publish', 'report: server first').status).toBe(0);

    // b attached before a published, so its branch is behind and its report file conflicts
    const b = clone(root, origin, 'b');
    git(b, 'fetch', '-q', 'origin', 'ci-status');
    git(b, 'worktree', 'add', '-q', '-f', '-B', 'ci-status', '.ci-status', 'FETCH_HEAD~0');
    git(join(b, '.ci-status'), 'reset', '-q', '--hard', 'HEAD~1');
    execFileSync('mkdir', ['-p', join(b, '.ci-status/reports')]);
    writeFileSync(join(b, '.ci-status/reports/server.json'), '{"sha":"second"}');
    const r = run(b, 'publish', 'report: server second');
    expect(r.status, r.stderr).toBe(0);

    const check = clone(root, origin, 'check');
    git(check, 'fetch', '-q', 'origin', 'ci-status');
    const log = git(check, 'log', '--format=%s', 'FETCH_HEAD');
    expect(log).toContain('report: server first');
    expect(log).toContain('report: server second');
    expect(git(check, 'show', 'FETCH_HEAD:reports/server.json')).toBe('{"sha":"second"}');
    expect(readFileSync(join(b, '.ci-status/reports/server.json'), 'utf8')).toBe('{"sha":"second"}');
  }, 90_000);
});
