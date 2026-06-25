import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
    watch:
      process.env.DISABLE_HMR === 'true'
        ? null
        : {
            ignored: [
              '**/*.db',
              '**/*.db-journal',
              '**/*.db-wal',
              '**/*.db-shm',
              '**/packages/core/db/**',
              '**/*.d.ts',
            ],
          },
  },
  build: {
    target: 'esnext',
    modulePreload: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 将大型依赖单独分块，避免 Rollup 单 chunk 渲染卡死
          if (id.includes('node_modules/konva')) return 'vendor-konva';
          if (id.includes('node_modules/react-konva')) return 'vendor-konva';
          if (id.includes('node_modules/react-konva-utils')) return 'vendor-konva';
          if (id.includes('node_modules/reveal.js')) return 'vendor-reveal';
          if (id.includes('node_modules/pptx-preview')) return 'vendor-pptx';
          if (id.includes('node_modules/html2canvas')) return 'vendor-html2canvas';
          if (id.includes('src/features/whiteboard')) return 'whiteboard';
          if (id.includes('src/features/courseware')) return 'courseware';
        },
      },
    },
  },
});
