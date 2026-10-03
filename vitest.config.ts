import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Dynamically determine safe concurrency level based on memory and CPU limits.
 * Each worker in JSDOM + Vite environment consumes ~400-600MB. Capping maxForks
 * prevents memory thrashing, GC stalls, and worker IPC timeouts on machines with
 * high core count but constrained memory.
 */
const cpus = os.cpus().length;
const freeMemGb = os.freemem() / (1024 * 1024 * 1024);
const safeForks = Math.max(1, Math.min(4, Math.floor(freeMemGb / 0.6), Math.ceil(cpus / 2)));

/**
 * Resolve an in-repo path relative to this config file (the repo root), so the
 * aliases work on any machine and on CI. Previously these were hard-coded to
 * `/home/wuxf/Develop/openlearnv2/...`, which broke `pnpm test` everywhere else.
 */
const fromRepoRoot = (relativePath: string): string => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  test: {
    pool: 'forks',
    maxWorkers: process.env.VITEST_MAX_FORKS ? parseInt(process.env.VITEST_MAX_FORKS, 10) : safeForks,
    include: [
      // 广覆盖：任何 `__tests__` 下的 *.test.ts(x) 都应被执行。
      //
      // 此前这里是 20 条逐目录白名单，对**当时已存在**的目录覆盖是完整的
      // （实测两种配置都收集 324 个文件）。但它是"新增目录必须手动登记"的
      // 模式：把新测试放进未登记的目录（如 packages/core/ai-capability/__tests__/）
      // 时，测试文件会被静默跳过 —— 写在磁盘上、tsc 能过、CI 全绿，唯独它不跑。
      // 这类盲区没有任何报错，只能靠人发现。
      //
      // 改为通配后，新增子系统目录无需再改本文件。
      'packages/**/__tests__/**/*.test.{ts,tsx}',
      'server/**/__tests__/**/*.test.{ts,tsx}',
      'src/**/__tests__/**/*.test.{ts,tsx}',
    ],

    // CHANGELOG[v0.3.21]：lti-provider-plugin.test.ts 引用 v2_plugins/*/*源码、
    // v2_plugins/ 被 .gitignore 排除，新克隆必红。这是预期的（v2 插件是独立仓库），
    // 跳过以避免 CI 失败。本地机器若有 v2_plugins 仓库仍可通过 `pnpm test:l2i` 单独跑。
    exclude: ['**/node_modules/**', 'packages/core/__tests__/lti-provider-plugin.test.ts'],

    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      '@openlearn/plugin-sdk': fromRepoRoot('./packages/plugin-sdk/index.ts'),
      '@openlearn/plugin-test-kit': fromRepoRoot('./packages/plugin-test-kit/index.ts'),
      exceljs: fromRepoRoot('./packages/core/__mocks__/xlsx.ts'),
    },
    // Kernel integration tests include ZIP plugin seeding which can take >5s
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/__tests__/**',
        '**/__mocks__/**',
        'e2e/**',
        'dist/**',
        'v2_plugins/**',
        'scripts/**',
      ],
      thresholds: {
        lines: 54,
        branches: 44,
        functions: 50,
        statements: 54,
      },
    },
  },
});
