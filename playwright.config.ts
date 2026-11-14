import { defineConfig } from '@playwright/test';

const PORT = 4173;
/** The production build is served under the GitHub Pages base path. */
const BASE_URL = `http://localhost:${PORT}/tuner/`;

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: BASE_URL,
    // The installed Google Chrome; set PW_CHANNEL=chromium to use Playwright's own build.
    channel: process.env.PW_CHANNEL ?? 'chrome',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  webServer: {
    // `npm run test:e2e` builds first; this only serves the result.
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
