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
      'src/plugin-host/__tests__/**/*.test.{ts,tsx}',
      'src/mfe/__tests__/**/*.test.{ts,tsx}',
    ],
    environment: 'jsdom',
  },
});
