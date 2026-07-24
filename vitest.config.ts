import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/core/di/__tests__/**/*.test.ts',
      'packages/core/esm-loader/__tests__/**/*.test.ts',
      'packages/core/plugin-host/__tests__/**/*.test.ts',
      'packages/core/worker-runtime/__tests__/**/*.test.ts',
      'packages/plugins/__tests__/**/*.test.ts',
      'packages/core/__tests__/**/*.test.ts',
      'packages/plugin-sdk/__tests__/**/*.test.ts',
      'packages/activity-ecosystem/__tests__/**/*.test.ts',
      'src/plugin-host/__tests__/**/*.test.{ts,tsx}',
      'src/mfe/__tests__/**/*.test.{ts,tsx}',
      'src/features/**/__tests__/**/*.test.{ts,tsx}',
    ],

    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      'xlsx': '/home/wuxf/Develop/openlearnv2/packages/core/__mocks__/xlsx.ts'
    },
    // Kernel integration tests include ZIP plugin seeding which can take >5s
    testTimeout: 60000,
    // Disable parallel execution of test files to prevent SQLite write race conditions
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});

