import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { SHORTCUTS, buildShortcut } from './shortcuts/builder';

/** Writes the shortcut templates and the Mac signing script into dist/shortcuts (served by the site). */
const dir = 'dist/shortcuts';
mkdirSync(`${dir}/templates`, { recursive: true });
const fileOf = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.plist`;

writeFileSync(
  `${dir}/index.txt`,
  SHORTCUTS.map((s) => `${fileOf(s.name)}\t${s.name}`).join('\n') + '\n',
);
for (const s of SHORTCUTS) writeFileSync(`${dir}/templates/${fileOf(s.name)}`, buildShortcut(s));
copyFileSync('scripts/shortcuts/sign.sh', `${dir}/sign.sh`);
chmodSync(`${dir}/sign.sh`, 0o755);
console.log(`shortcut templates written (${SHORTCUTS.length})`);
