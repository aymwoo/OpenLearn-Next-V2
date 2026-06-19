import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/core/di/__tests__/**/*.test.ts',
      'packages/core/esm-loader/__tests__/**/*.test.ts',
      'packages/core/plugin-host/__tests__/**/*.test.ts',
      'src/mfe/__tests__/**/*.test.ts',
      'src/mfe/__tests__/**/*.test.tsx',
      'src/plugin-host/__tests__/**/*.test.tsx',
    ],
    environment: 'jsdom',
  },
});
