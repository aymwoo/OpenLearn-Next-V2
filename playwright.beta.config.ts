import { defineConfig } from '@playwright/test';

/**
 * 公测关键旅程。独立端口和临时库，不设置 PLAYWRIGHT_TEST，
 * 因此登录后的强制改密与生产一致。只走 API，不启动浏览器。
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'public-beta-journey.spec.ts',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:9107',
  },
  webServer: {
    command: 'node scripts/e2e-beta-server.mjs',
    url: 'http://127.0.0.1:9107/health',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
