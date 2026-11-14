import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  workers: 1,
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
    { command: 'npx tsx scripts/mock-server.ts', url: 'http://127.0.0.1:8787/', reuseExistingServer: true, timeout: 60_000 },
  ],
});
