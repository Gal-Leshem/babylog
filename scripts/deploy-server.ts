import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Deploys the Apps Script server (creates the sheet + script on first run).
 *   usage: tsx scripts/deploy-server.ts test|prod
 * Needs CLASP_AUTH_DIR (folder with .clasprc.json). The test build also needs FIXED_KEY.
 * Ids are never printed; the script id is stored on the ci-status branch (envs/<env>.json).
 */
const env = process.argv[2];
if (env !== 'test' && env !== 'prod') throw new Error('usage: deploy-server.ts test|prod');
const title = env === 'test' ? 'BabyLog TEST' : 'BabyLog';
const authDir = process.env.CLASP_AUTH_DIR;
if (!authDir) throw new Error('CLASP_AUTH_DIR is not set');
const envFile = `.ci-status/envs/${env}.json`;
const outDir = process.env.RUNNER_TEMP ?? tmpdir();
const sha = (process.env.GITHUB_SHA ?? 'local').slice(0, 7);

const clasp = (...args: string[]): string =>
  execFileSync('node_modules/.bin/clasp', ['-A', join(authDir, '.clasprc.json'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const mask = (v: string) => console.log(`::add-mask::${v}`);

/** Describes the shape of a value without leaking its contents (for debugging blind). */
function shape(v: unknown): string {
  if (Array.isArray(v)) return `array(${v.length})[${v.length ? shape(v[0]) : ''}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${k}:${shape(x)}`).join(',')}}`;
  return typeof v;
}

function json<T>(out: string): T {
  const start = out.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in clasp output (${out.length} chars)`);
  return JSON.parse(out.slice(start)) as T;
}

interface Deployment {
  deploymentId: string;
  versionNumber?: number;
  description?: string;
}

function listDeployments(): Deployment[] {
  const out = clasp('--json', 'list-deployments');
  const list = json<Deployment[]>(out);
  if (!Array.isArray(list)) throw new Error(`unexpected deployments shape: ${shape(list)}`);
  for (const d of list) if (d.deploymentId) mask(d.deploymentId);
  return list;
}

// 1. Find or create the script (a sheet with a bound script)
let scriptId: string | undefined;
if (existsSync(envFile)) scriptId = (JSON.parse(readFileSync(envFile, 'utf8')) as { scriptId?: string }).scriptId;
if (scriptId) mask(scriptId);

rmSync('.clasp.json', { force: true });
mkdirSync('apps-script/dist', { recursive: true });

if (!scriptId) {
  console.log(`creating "${title}" (sheet + bound script)`);
  const out = clasp('--json', 'create-script', '--type', 'sheets', '--title', title, '--rootDir', 'apps-script/dist');
  const created = json<{ scriptId?: string }>(out);
  if (!created.scriptId) throw new Error(`create-script returned no scriptId: ${shape(created)}`);
  scriptId = created.scriptId;
  mask(scriptId);
  mkdirSync('.ci-status/envs', { recursive: true });
  writeFileSync(envFile, JSON.stringify({ scriptId, title }, null, 2) + '\n');
  // Save the id immediately: a bound script cannot be found again by name.
  execFileSync('bash', ['scripts/status-branch.sh', 'publish', `server id: ${env}`], { stdio: 'inherit' });
  console.log('script created and its id saved');
} else {
  console.log(`using existing ${env} script`);
}
rmSync('.clasp.json', { force: true });

// 2. Build (after create, which pulls a default file into the output folder) and push
execFileSync('npx', ['tsx', 'scripts/build-server.ts', ...(env === 'test' ? ['--test'] : [])], { stdio: 'inherit', env: process.env });
writeFileSync('.clasp.json', JSON.stringify({ scriptId, rootDir: 'apps-script/dist' }) + '\n');
console.log(clasp('push', '-f').trim().split('\n').slice(-3).join('\n'));

// 3. Deploy: update the existing web app deployment, or create it once
const webApps = listDeployments().filter((d) => d.versionNumber !== undefined && d.versionNumber !== null);
let deploymentId: string;
if (webApps.length > 0) {
  const current = webApps.sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0))[0]!;
  const out = clasp('--json', 'create-deployment', '--deploymentId', current.deploymentId, '--description', `babylog ${sha}`);
  const d = json<Deployment>(out);
  deploymentId = d.deploymentId || current.deploymentId;
  console.log(`redeployed existing web app deployment (version ${d.versionNumber ?? '?'})`);
} else {
  const out = clasp('--json', 'create-deployment', '--description', `babylog ${sha}`);
  const d = json<Deployment>(out);
  if (!d.deploymentId) throw new Error(`create-deployment returned no deploymentId: ${shape(d)}`);
  deploymentId = d.deploymentId;
  console.log(`created web app deployment (version ${d.versionNumber ?? '?'})`);
}
mask(deploymentId);

// 4. Hand the (secret) URL to later steps of this job only
writeFileSync(join(outDir, `server-${env}.json`), JSON.stringify({ url: `https://script.google.com/macros/s/${deploymentId}/exec` }));
console.log(`${env} server deployed`);
