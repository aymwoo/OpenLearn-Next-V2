import { defineConfig, devices } from '@playwright/test';

/**
 * OpenLearn V2 Playwright E2E 配置
 */
export default defineConfig({
  testDir: './e2e',
  // Issue #230：`pnpm test:e2e` 会把 e2e/ 下全部用例扫进来。
  // 但 `public-beta-journey.spec.ts` 属于**独立**的公测配置
  // （playwright.beta.config.ts）：它跑在 9107 端口的独立服务上，
  // 且刻意不豁免强制改密门 —— 用本配置的 9000 端口服务去跑它必然
  // ECONNREFUSED / 端口错配。它由 `pnpm test:e2e:beta` 单独驱动。
  testIgnore: 'public-beta-journey.spec.ts',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:9000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: 'PLAYWRIGHT_TEST=1 pnpm dev',
    url: 'http://localhost:9000',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      PLAYWRIGHT_TEST: '1',
      // Issue #229：CI 里启用的路由数据范围声明门禁。
      // 显式带上而不是只依赖进程 env —— 避免不同 Playwright 版本对 env 合并语义的差异。
      ROUTE_SCOPE_ENFORCE: 'true',
    },
  },
});
