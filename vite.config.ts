import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {federation} from '@module-federation/vite';
import {readFileSync} from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'));

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      federation({
        name: 'host_shell',
        // 禁用 DTS 插件，避免 fork 的 TypeScript worker 进程崩溃导致 EPIPE 错误
        dts: false,
        remotes: {},
        dev: {
          disableDynamicRemoteTypeHints: true,
        },
        shared: {
          react: {
            singleton: true,
            requiredVersion: pkg.dependencies['react'],
            strictVersion: false,
          },
          'react-dom': {
            singleton: true,
            requiredVersion: pkg.dependencies['react-dom'],
            strictVersion: false,
          },
          zustand: {
            singleton: true,
            requiredVersion: pkg.dependencies['zustand'],
            strictVersion: false,
          },
          konva: {
            singleton: true,
            requiredVersion: pkg.dependencies['konva'],
            strictVersion: false,
          },
          'react-konva': {
            singleton: true,
            requiredVersion: pkg.dependencies['react-konva'],
            strictVersion: false,
          },
          'react-konva-utils': {
            singleton: true,
            requiredVersion: pkg.dependencies['react-konva-utils'],
            strictVersion: false,
          },
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '**/*.db',
          '**/*.db-journal',
          '**/*.db-wal',
          '**/*.db-shm',
          '**/packages/core/db/**',
          '**/*.d.ts',
          '**/.federation/**',
          '**/.mf/**',
          '**/.__mf__temp/**',
        ]
      },
    },
    // optimizeDeps.exclude 会与 @module-federation/vite 的 optimizeDeps.include
    // 虚拟模块冲突（esbuild 报 entry point cannot be marked as external）。
    // React/React-DOM 通过 MF shared scope 共享，由 MF runtime 在浏览器端处理。
    // 注意：如出现 dispatcher.getOwner is not a function 错误，
    // 检查是否有多个 React 实例（Vite 预打包 + MF 共享作用域冲突），
    // 可通过 resolve.dedupe 或 MF shared.eager 配置解决。
    build: {
      target: 'esnext',
      modulePreload: false,
    },
  };
});
