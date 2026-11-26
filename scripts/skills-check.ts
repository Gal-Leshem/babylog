import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { deadRefs, domainSkills, readGuides, skillsFor } from './skills-lib';

/**
 * Closing a task (.claude/skills/close-task):  npx tsx scripts/skills-check.ts [base]
 *  1. every path named in CLAUDE.md, the skills and the agents must exist (exit 1 otherwise);
 *  2. with a base (default origin/dev), the files changed since it, grouped by the domain skill that owns them:
 *     each skill listed must be re-read and updated before the task is closed.
 */
const base = process.argv[2] ?? 'origin/dev';
const guides = readGuides();
const dead = deadRefs(guides, existsSync);
for (const d of dead) console.log(`STALE ${d.guide}: \`${d.ref}\` does not exist`);

let changed: string[] = [];
try {
  const mergeBase = execFileSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' }).trim();
  const committed = execFileSync('git', ['diff', '--name-only', mergeBase], { encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  changed = [...new Set([...committed.split('\n'), ...untracked.split('\n')].filter(Boolean))].sort();
} catch {
  console.log(`(no diff: ${base} not found; run git fetch origin)`);
}

if (changed.length > 0) {
  console.log(`\nChanged since ${base}: ${changed.length} file(s). Skills to review before closing:`);
  for (const [skill, files] of skillsFor(changed, domainSkills(guides))) {
    console.log(`- ${skill}: ${files.join(', ')}`);
  }
  const guideEdits = changed.filter((f) => f === 'CLAUDE.md' || f.startsWith('.claude/'));
  console.log(guideEdits.length ? `Guides edited: ${guideEdits.join(', ')}` : 'Guides edited: none (is nothing worth keeping?)');
  console.log(changed.includes('docs/CHANGELOG.md') ? 'CHANGELOG: edited' : 'CHANGELOG: NOT edited');
}
process.exit(dead.length > 0 ? 1 : 0);
