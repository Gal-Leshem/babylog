import { appendFileSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

/**
 * Bundles the Apps Script server into apps-script/dist/Code.js.
 * `--test` bakes in FIXED_KEY (derived by CI) so live tests can authenticate; production never does.
 */
const testBuild = process.argv.includes('--test');
const fixedKey = testBuild ? (process.env.FIXED_KEY ?? '') : '';
const execUrl = process.env.EXEC_URL ?? '';
if (execUrl && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(execUrl)) throw new Error('EXEC_URL has an unexpected shape');
if (testBuild && fixedKey.length < 32) throw new Error('FIXED_KEY (32+ chars) is required for the test build');

rmSync('apps-script/dist', { recursive: true, force: true });
mkdirSync('apps-script/dist', { recursive: true });

await build({
  entryPoints: ['src/server/gas.ts'],
  outfile: 'apps-script/dist/Code.js',
  bundle: true,
  format: 'iife',
  globalName: '__babylog',
  target: 'es2019',
  platform: 'neutral',
  charset: 'utf8',
  define: { __FIXED_KEY__: JSON.stringify(fixedKey), __EXEC_URL__: JSON.stringify(execUrl) },
  legalComments: 'none',
  logLevel: 'warning',
});
// Entry points must be plain top-level function declarations: the Apps Script editor's function list
// ("Run" dropdown) and the web app runtime only find those, not functions attached to the global object.
appendFileSync(
  'apps-script/dist/Code.js',
  `
function doPost(e) { return __babylog.doPost(e); }
function doGet(e) { return __babylog.doGet(e); }
function setup() { return __babylog.setup(); }
function rotateKey() { return __babylog.rotateKey(); }
function printInstallCode() { return __babylog.printInstallCode(); }
`,
);
copyFileSync('apps-script/appsscript.json', 'apps-script/dist/appsscript.json');

const out = readFileSync('apps-script/dist/Code.js', 'utf8');
if (/__FIXED_KEY__|__EXEC_URL__/.test(out)) throw new Error('unreplaced placeholder in the bundle');
if (!testBuild && fixedKey !== '') throw new Error('production build must not contain a fixed key');
console.log(`server bundle ready (${testBuild ? 'test' : 'production'}, ${Math.round(out.length / 1024)} KB)`);
