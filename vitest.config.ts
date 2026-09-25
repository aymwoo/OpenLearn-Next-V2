import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Resolve an in-repo path relative to this config file (the repo root), so the
 * aliases work on any machine and on CI. Previously these were hard-coded to
 * `/home/wuxf/Develop/openlearnv2/...`, which broke `pnpm test` everywhere else.
 */
const fromRepoRoot = (relativePath: string): string => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  test: {
    include: [
      'packages/core/di/__tests__/**/*.test.ts',
      'packages/core/esm-loader/__tests__/**/*.test.ts',
      'packages/core/plugin-host/__tests__/**/*.test.ts',
      'packages/core/worker-runtime/__tests__/**/*.test.ts',
      'packages/plugins/__tests__/**/*.test.ts',
      'packages/core/event-bus/__tests__/**/*.test.ts',
      'packages/core/__tests__/**/*.test.ts',
      'packages/plugin-sdk/__tests__/**/*.test.ts',
      'packages/activity-ecosystem/__tests__/**/*.test.ts',
      'server/__tests__/**/*.test.ts',
      'v2_plugins/**/__tests__/**/*.test.ts', // 目录不存在时自动匹配为空；保留以支持未来 v2 插件仓库
      'src/plugin-host/__tests__/**/*.test.{ts,tsx}',
      'src/mfe/__tests__/**/*.test.{ts,tsx}',
      'src/features/**/__tests__/**/*.test.{ts,tsx}',
      'src/components/**/__tests__/**/*.test.{ts,tsx}',
      'src/utils/__tests__/**/*.test.{ts,tsx}',
      'src/services/__tests__/**/*.test.{ts,tsx}',
      'src/store/__tests__/**/*.test.{ts,tsx}',
      'src/hooks/**/__tests__/**/*.test.{ts,tsx}',
    ],

    // CHANGELOG[v0.3.21]：lti-provider-plugin.test.ts 引用 v2_plugins/*/*源码、
    // v2_plugins/ 被 .gitignore 排除，新克隆必红。这是预期的（v2 插件是独立仓库），
    // 跳过以避免 CI 失败。本地机器若有 v2_plugins 仓库仍可通过 `pnpm test:l2i` 单独跑。
    exclude: [
      '**/node_modules/**',
      'packages/core/__tests__/lti-provider-plugin.test.ts',
    ],

    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      '@openlearn/plugin-sdk': fromRepoRoot('./packages/plugin-sdk/index.ts'),
      '@openlearn/plugin-test-kit': fromRepoRoot('./packages/plugin-test-kit/index.ts'),
      exceljs: fromRepoRoot('./packages/core/__mocks__/xlsx.ts'),
    },
    // Kernel integration tests include ZIP plugin seeding which can take >5s
    testTimeout: 60000,
    fileParallelism: true,
  },
});
