import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/core/di/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
