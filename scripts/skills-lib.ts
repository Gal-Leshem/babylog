import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The working guides for Claude: CLAUDE.md, the skills in .claude/skills/<name>/SKILL.md and the agents in .claude/agents/*.md.
 * Two checks keep them from going stale:
 *  - every repository path a guide names in backticks must exist (a renamed or removed file is caught by `npm test`);
 *  - a change's files are mapped to the domain skills that own them, so closing a task knows which skills to review.
 */

export interface Guide {
  path: string;
  text: string;
}

export interface DomainSkill {
  name: string;
  path: string;
  /** Exact files, or folders when the entry ends with '/'. */
  owns: string[];
  /** The skill that takes every file no other skill owns. */
  fallback: boolean;
}

const ROOTS = ['src/', 'scripts/', 'docs/', 'tests/', 'e2e/', 'apps-script/', '.github/', '.claude/', 'public/'];
const TOP = new Set(['CLAUDE.md', 'README.md', 'families.json', 'index.html', 'package.json', 'playwright.config.ts', 'vite.config.ts']);

export function guideFiles(root = '.'): string[] {
  const out: string[] = [];
  if (existsSync(join(root, 'CLAUDE.md'))) out.push('CLAUDE.md');
  const skills = join(root, '.claude/skills');
  if (existsSync(skills)) {
    for (const d of readdirSync(skills).sort()) {
      if (existsSync(join(skills, d, 'SKILL.md'))) out.push(`.claude/skills/${d}/SKILL.md`);
    }
  }
  const agents = join(root, '.claude/agents');
  if (existsSync(agents)) {
    for (const f of readdirSync(agents).sort()) if (f.endsWith('.md')) out.push(`.claude/agents/${f}`);
  }
  return out;
}

export function readGuides(root = '.'): Guide[] {
  return guideFiles(root).map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));
}

/** Repository paths named in backticks: `src/app/engine.ts`, `docs/`, `scripts/ship.sh <sha7>` (first word only). */
export function pathRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    let t = (m[1] ?? '').trim().split(/\s+/)[0] ?? '';
    t = t.replace(/[#:].*$/, '').replace(/[),.;]+$/, '');
    if (!t || /[*<>{}$]/.test(t)) continue;
    if (ROOTS.some((r) => t.startsWith(r)) || TOP.has(t)) refs.add(t);
  }
  return [...refs];
}

/** Paths named in the guides that do not exist: `{ guide, ref }` for each. */
export function deadRefs(guides: Guide[], exists: (p: string) => boolean): { guide: string; ref: string }[] {
  const out: { guide: string; ref: string }[] = [];
  for (const g of guides) for (const ref of pathRefs(g.text)) if (!exists(ref)) out.push({ guide: g.path, ref });
  return out;
}

/**
 * A domain skill lists what it owns under a heading "## Owns": backticked paths (a folder ends with '/'),
 * and the word "fallback" on a line of its own for the skill that takes every file nobody else owns.
 */
export function domainSkill(g: Guide): DomainSkill | null {
  const name = /^name:\s*(.+)$/m.exec(g.text)?.[1]?.trim();
  const section = /^## Owns\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(g.text)?.[1];
  if (!name || section === undefined) return null;
  return {
    name,
    path: g.path,
    owns: pathRefs(section),
    fallback: /^\s*[-*]?\s*fallback\b/im.test(section),
  };
}

export function domainSkills(guides: Guide[]): DomainSkill[] {
  return guides.map(domainSkill).filter((d): d is DomainSkill => d !== null);
}

/** What `close-task` itself writes on every task: never a reason to review a domain skill. */
export const isHandoff = (file: string) =>
  file === 'CLAUDE.md' || file.startsWith('.claude/') || file === 'docs/CHANGELOG.md' || file === 'docs/PROGRESS.md' || file === 'docs/ARCHITECTURE.md';

const owned = (file: string, entry: string) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry);

/** For each changed file, the skills that own it (several when a file is shared; the fallback skill when nobody does).
 * The guides and the handoff docs are left out (`isHandoff`). */
export function skillsFor(files: string[], skills: DomainSkill[]): Map<string, string[]> {
  const bySkill = new Map<string, string[]>();
  const fallback = skills.find((s) => s.fallback)?.name;
  for (const f of files) {
    if (isHandoff(f)) continue;
    let names = skills.filter((s) => s.owns.some((e) => owned(f, e))).map((s) => s.name);
    if (names.length === 0 && fallback) names = [fallback];
    for (const n of names) bySkill.set(n, [...(bySkill.get(n) ?? []), f]);
  }
  return bySkill;
}
