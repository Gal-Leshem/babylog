import { defineConfig } from '@playwright/test';

/**
 * Tests run in parallel, one worker per CPU (at most 4). Each worker has its own mock server (port 8787 + its index, see
 * e2e/helpers.ts), so parallel tests never see each other's data; every test resets its server in beforeEach.
 * E2E_WORKERS=1 runs them one by one (the old way).
 */
const workers = Math.max(1, Number(process.env.E2E_WORKERS ?? 4));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  workers,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    // A small modern phone screen (portrait) with touch, Israeli locale and time zone.
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    serviceWorkers: 'allow',
  },
  webServer: [
    { command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4173/', reuseExistingServer: true, timeout: 60_000 },
    {
      command: 'npx tsx scripts/mock-server.ts',
      url: `http://127.0.0.1:${8787 + workers - 1}/`, // ready when the last one answers
      env: { MOCK_SERVERS: String(workers) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
