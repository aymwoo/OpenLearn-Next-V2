import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const targetPort = parseInt(process.env.PORT || '9000', 10);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /**
   * 依赖预打包缓存目录：**按仓库根隔离，且不放在 node_modules 下**。
   *
   * 为什么不能沿用 Vite 默认的 `node_modules/.vite`：
   * linked worktree 通常把 node_modules 软链到主仓库，于是 `<worktree>/node_modules/.vite`
   * 物理上就是主仓库的 `node_modules/.vite` —— 两个 Vite root 抢同一个预打包缓存目录。
   * 两者的 browserHash 不同（随 root 变化）、chunk 划分也不同，于是各自写盘互相覆盖：
   * 浏览器同一页面里会同时加载两代产物，而 react 的 CJS 模块在两代里落在**不同 chunk 文件**，
   * 于是同页出现两份 React。react-konva 那份的 `ReactSharedInternals.H` 永远是 null，
   * 白板 `<Stage>` 一挂载就抛 `Cannot read properties of null (reading 'useRef')`。
   *
   * 放到仓库根下（`<root>/.vite-cache`）后，每个 root 各写各的，跨 worktree 不再互相覆盖。
   */
  cacheDir: path.resolve(__dirname, '.vite-cache'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
    /**
     * 单 React 实例：react-dom / react-konva / 插件各自 `import 'react'` 必须落到同一份。
     * 否则渲染器与被渲染组件可能拿到不同的 React 副本，hooks 直接失效。
     */
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    /**
     * 白板这条重依赖链**显式纳入预打包**。
     *
     * 否则它们会在运行时才被「发现」（白板是 React.lazy，插件走 Blob URL 动态导入，
     * 静态扫描扫不到），触发 Vite 的**增量预打包** —— 那次增量会把 react CJS
     * 再打包一份到新 chunk 里，同样造成同页两份 React。
     */
    include: ['react', 'react-dom', 'react-dom/client', 'react-konva', 'react-konva-utils', 'konva'],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '0.0.0.0',
    port: targetPort,
    proxy: {
      '/api': { target: `http://127.0.0.1:${targetPort}`, changeOrigin: true },
      '/plugins': { target: `http://127.0.0.1:${targetPort}`, changeOrigin: true },
      '/uploads': { target: `http://127.0.0.1:${targetPort}`, changeOrigin: true },
      '/scratch': { target: `http://127.0.0.1:${targetPort}`, changeOrigin: true },
      '/_tools': {
        target: `http://127.0.0.1:${targetPort}`,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/_tools/, ''),
      },
    },
    hmr: process.env.DISABLE_HMR !== 'true' && process.env.PLAYWRIGHT_TEST !== '1',
    watch:
      process.env.DISABLE_HMR === 'true' || process.env.PLAYWRIGHT_TEST === '1'
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
              '**/artifacts/**',
              '**/test-results/**',
            ],
          },
  },
  build: {
    target: 'es2022',
    modulePreload: {
      polyfill: false,
      resolveDependencies(_filename, deps) {
        return deps.filter((dep) => !/vendor-(pdf|charts|pptx|reveal|konva)/i.test(dep));
      },
    },
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
            if (id.includes('/pptx-react-viewer/') || id.includes('/ooxml-core/') || id.includes('/ooxml-ui/')) {
              return 'vendor-pptx';
            }
            // Utilities
            if (
              id.includes('/es-toolkit/') ||
              id.includes('/zustand/') ||
              id.includes('/clsx/') ||
              id.includes('/tailwind-merge/')
            ) {
              return 'vendor-utils';
            }
          }
        },
      },
    },
  },
});
