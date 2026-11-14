import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compileDenylist, findLines, matches, parseDenylist } from './privacy-lib';

/**
 * Fails (exit 1) if any forbidden word appears in tracked files, file names, the built site,
 * or git history (author names, e-mails, commit messages). Output only says WHERE, never WHAT.
 */
const words = parseDenylist(process.env.PRIVACY_DENYLIST);
if (words.length === 0) {
  console.error('PRIVACY_DENYLIST is missing or empty: refusing to continue without a word list.');
  process.exit(1);
}
const patterns = compileDenylist(words);
const problems: string[] = [];

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function scanFile(path: string, label = path): void {
  if (matches(path, patterns)) problems.push(`${label}: file name`);
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return;
  }
  if (buf.includes(0)) return; // binary
  for (const line of findLines(buf.toString('utf8'), patterns)) problems.push(`${label}:${line}`);
}

// 1. Working tree (tracked + untracked, minus ignored)
for (const f of git('ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(Boolean)) scanFile(f);

// 2. Built site
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
if (existsSync('dist')) for (const f of walk('dist')) scanFile(f);

// 3. Git history: identities and messages of every commit on every ref
try {
  const log = git('log', '--all', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e').split('\x1e');
  for (const entry of log) {
    const [sha, ...rest] = entry.trim().split('\x1f');
    if (!sha) continue;
    if (matches(rest.join('\n'), patterns)) problems.push(`git history: commit ${sha.slice(0, 8)} (author, e-mail or message)`);
  }
} catch {
  // no history available (e.g. fresh repository)
}

if (problems.length > 0) {
  console.error(`Privacy check FAILED: ${problems.length} place(s) contain a forbidden word (words are not shown):`);
  for (const p of problems.slice(0, 50)) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`Privacy check passed (${words.length} forbidden words, tree + build + history scanned).`);
