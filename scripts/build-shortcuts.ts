import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { SHORTCUTS, buildShortcut } from './shortcuts/builder';

/** Writes the shortcut templates and the Mac signing script into dist/shortcuts (served by the site). */
const dir = 'dist/shortcuts';
mkdirSync(`${dir}/templates`, { recursive: true });
// file names stay ASCII (Hebrew names live in the index): <lang>-<number>.plist
const fileOf = (i: number) => `${SHORTCUTS[i]!.lang}-${String(i + 1).padStart(2, '0')}.plist`;

// index: file, name (also the Siri phrase), language, baby's sex the shortcut is for ('' = any)
writeFileSync(`${dir}/index.txt`, SHORTCUTS.map((s, i) => `${fileOf(i)}\t${s.name}\t${s.lang}\t${s.sex ?? ''}`).join('\n') + '\n');
SHORTCUTS.forEach((s, i) => writeFileSync(`${dir}/templates/${fileOf(i)}`, buildShortcut(s)));
copyFileSync('scripts/shortcuts/sign.sh', `${dir}/sign.sh`);
chmodSync(`${dir}/sign.sh`, 0o755);
console.log(`shortcut templates written (${SHORTCUTS.length})`);
