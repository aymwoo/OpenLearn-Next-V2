import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/core/esm-loader/__tests__/**/*.test.ts',
    ],
    environment: 'node',
  },
});
