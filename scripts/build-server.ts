import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

/**
 * Bundles the Apps Script server into apps-script/dist/Code.js.
 * `--test` bakes in FIXED_KEY (derived by CI) so live tests can authenticate; production never does.
 */
const testBuild = process.argv.includes('--test');
const fixedKey = testBuild ? (process.env.FIXED_KEY ?? '') : '';
if (testBuild && fixedKey.length < 32) throw new Error('FIXED_KEY (32+ chars) is required for the test build');

rmSync('apps-script/dist', { recursive: true, force: true });
mkdirSync('apps-script/dist', { recursive: true });

await build({
  entryPoints: ['src/server/gas.ts'],
  outfile: 'apps-script/dist/Code.js',
  bundle: true,
  format: 'iife',
  target: 'es2019',
  platform: 'neutral',
  charset: 'utf8',
  define: { __FIXED_KEY__: JSON.stringify(fixedKey) },
  legalComments: 'none',
  logLevel: 'warning',
});
copyFileSync('apps-script/appsscript.json', 'apps-script/dist/appsscript.json');

const out = readFileSync('apps-script/dist/Code.js', 'utf8');
if (!testBuild && /__FIXED_KEY__/.test(out)) throw new Error('unreplaced placeholder in production bundle');
if (!testBuild && fixedKey !== '') throw new Error('production build must not contain a fixed key');
console.log(`server bundle ready (${testBuild ? 'test' : 'production'}, ${Math.round(out.length / 1024)} KB)`);
