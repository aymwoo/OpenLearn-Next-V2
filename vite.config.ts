import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:9000', changeOrigin: true },
      '/plugins': { target: 'http://127.0.0.1:9000', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:9000', changeOrigin: true },
      '/scratch': { target: 'http://127.0.0.1:9000', changeOrigin: true },
      '/_tools': {
        target: 'http://127.0.0.1:9000',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/_tools/, ''),
      },
    },
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
              '**/storage/**',
              '**/uploads/**',
            ],
          },
  },
  build: {
    target: 'esnext',
    modulePreload: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // React Core
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
              return 'vendor-react';
            }
            // Lucide Icons
            if (id.includes('/lucide-react/')) {
              return 'vendor-icons';
            }
            // Framer Motion Animation (仅作为 motion 的间接依赖存在)
            if (id.includes('/motion-dom/')) {
              return 'vendor-motion';
            }
            // Recharts & D3 Data Visualization
            if (id.includes('/recharts/') || id.includes('/d3-') || id.includes('/victory-')) {
              return 'vendor-charts';
            }
            // PDF Generation
            if (id.includes('/jspdf/') || id.includes('/jspdf-autotable/') || id.includes('/html2canvas/')) {
              return 'vendor-pdf';
            }
            // Konva Canvas
            if (id.includes('/konva/') || id.includes('/react-konva/') || id.includes('/react-konva-utils/')) {
              return 'vendor-konva';
            }
            // Presentations & Previews
            if (id.includes('/reveal.js/')) {
              return 'vendor-reveal';
            }
            if (id.includes('/pptx-preview/')) {
              return 'vendor-pptx';
            }
            // Markdown & Sanitization
            if (id.includes('/marked/') || id.includes('/dompurify/') || id.includes('/highlight.js/')) {
              return 'vendor-content';
            }
            // Utilities
            if (id.includes('/es-toolkit/') || id.includes('/zustand/') || id.includes('/clsx/') || id.includes('/tailwind-merge/')) {
              return 'vendor-utils';
            }
          }
        },
      },
    },
  },
});
