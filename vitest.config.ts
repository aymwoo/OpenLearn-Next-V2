import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/core/di/__tests__/**/*.test.ts',
      'packages/core/esm-loader/__tests__/**/*.test.ts',
      'packages/core/plugin-host/__tests__/**/*.test.ts',
      'packages/core/worker-runtime/__tests__/**/*.test.ts',
    ],
    environment: 'node',
  },
});
