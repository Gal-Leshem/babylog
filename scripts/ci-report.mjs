// Writes .ci-status/reports/<job>.json from .ci-logs/*.log (sanitized). Plain JS: no install needed.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { sanitizeLog } from './sanitize.mjs';

const [job = 'unknown', status = 'unknown'] = process.argv.slice(2);
const forbidden = (process.env.PRIVACY_DENYLIST ?? '').split(/\r?\n/).map((w) => w.trim()).filter(Boolean);

const logs = {};
if (existsSync('.ci-logs')) {
  for (const f of readdirSync('.ci-logs').sort()) {
    if (f.endsWith('.log')) logs[f.replace(/\.log$/, '')] = sanitizeLog(readFileSync(`.ci-logs/${f}`, 'utf8'), forbidden);
  }
}

const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
const report = {
  job,
  status,
  sha: (process.env.GITHUB_SHA ?? '').slice(0, 7),
  ref: process.env.GITHUB_REF_NAME ?? '',
  at: new Date().toISOString(),
  run: process.env.GITHUB_RUN_ID ? `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '',
  logs,
};
mkdirSync('.ci-status/reports', { recursive: true });
writeFileSync(`.ci-status/reports/${job}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(`report written for ${job}: ${status}`);
