import { defineConfig } from 'vitest/config';

// Unit tests live in tests/. The Playwright specs in e2e/ are run by `npm run e2e`.
export default defineConfig({
  define: { __APP_COMMIT__: JSON.stringify('test') },
  test: { include: ['tests/**/*.test.ts'] },
});
