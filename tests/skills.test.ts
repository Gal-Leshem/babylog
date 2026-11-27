import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deadRefs, domainSkill, domainSkills, pathRefs, readGuides, skillsFor } from '../scripts/skills-lib';

describe('guides for Claude (CLAUDE.md, .claude/skills, .claude/agents)', () => {
  it('name only paths that exist (a renamed file must be renamed in the guides too)', () => {
    const guides = readGuides();
    expect(guides.map((g) => g.path)).toContain('CLAUDE.md');
    expect(deadRefs(guides, existsSync)).toEqual([]);
  });

  it('have exactly one fallback domain skill, and every domain skill owns something', () => {
    const skills = domainSkills(readGuides());
    expect(skills.length).toBeGreaterThanOrEqual(3);
    expect(skills.filter((s) => s.fallback)).toHaveLength(1);
    for (const s of skills) expect(s.owns.length, s.name).toBeGreaterThan(0);
  });

  it('give the sync engine to performance, the family deploy to families, a screen to features', () => {
    const map = skillsFor(['src/app/engine.ts', 'scripts/deploy-families.ts', 'src/app/screens/Home.tsx'], domainSkills(readGuides()));
    expect(map.get('performance')).toEqual(['src/app/engine.ts']);
    expect(map.get('families')).toEqual(['scripts/deploy-families.ts']);
    expect(map.get('features')).toEqual(['src/app/screens/Home.tsx']);
  });
});

describe('skills-lib', () => {
  it('finds repository paths in backticks and ignores the rest', () => {
    expect(
      pathRefs('see `src/app/engine.ts`, `docs/` and `scripts/ship.sh <sha7>`; not `npm test`, `Engine.sync`, `src/**/*.ts`, `x`'),
    ).toEqual(['src/app/engine.ts', 'docs/', 'scripts/ship.sh']);
    expect(pathRefs('`src/server/core.ts:120` and `docs/ARCHITECTURE.md#sync`')).toEqual(['src/server/core.ts', 'docs/ARCHITECTURE.md']);
  });

  it('reports a path that does not exist', () => {
    const g = [{ path: 'x.md', text: 'uses `src/gone.ts` and `src/here.ts`' }];
    expect(deadRefs(g, (p) => p === 'src/here.ts')).toEqual([{ guide: 'x.md', ref: 'src/gone.ts' }]);
  });

  it('reads ownership only from the "## Owns" section', () => {
    const s = domainSkill({
      path: 's.md',
      text: '---\nname: a\n---\nmentions `src/other.ts`\n## Owns\n- `src/a/`\n- `src/b.ts`\n- fallback\n## Next\n`src/c.ts`\n',
    });
    expect(s).toEqual({ name: 'a', path: 's.md', owns: ['src/a/', 'src/b.ts'], fallback: true });
    expect(domainSkill({ path: 'n.md', text: '---\nname: n\n---\nno section' })).toBeNull();
  });

  it('maps a shared file to every owner, an unowned file to the fallback, and the guides and handoff docs to none', () => {
    const skills = [
      { name: 'p', path: '', owns: ['src/server/core.ts', 'src/app/engine.ts'], fallback: false },
      { name: 'f', path: '', owns: ['src/server/core.ts', 'families.json'], fallback: false },
      { name: 'x', path: '', owns: ['src/app/screens/'], fallback: true },
    ];
    const m = skillsFor(
      ['src/server/core.ts', 'src/app/screens/Home.tsx', 'scripts/ship.sh', 'CLAUDE.md', '.claude/skills/x/SKILL.md', 'docs/CHANGELOG.md', 'docs/ARCHITECTURE.md'],
      skills,
    );
    expect(Object.fromEntries(m)).toEqual({
      p: ['src/server/core.ts'],
      f: ['src/server/core.ts'],
      x: ['src/app/screens/Home.tsx', 'scripts/ship.sh'],
    });
  });
});
