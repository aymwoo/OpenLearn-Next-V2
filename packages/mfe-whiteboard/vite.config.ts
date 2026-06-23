import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import path from 'path';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    federation({
      name: 'mfe_whiteboard',
      filename: 'remoteEntry.js',
      dts: false,
      exposes: {
        './App': './src/App.tsx',
      },
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
  // 阻止 MFE remote 端独立预打包 React，确保所有 React 导入
  // 在运行时走 MF shared scope（host 提供的单例），避免
  // dispatcher.getOwner is not a function 多实例错误。
  optimizeDeps: {
    exclude: ['react', 'react-dom'],
  },
  server: {
    port: 5174,
    host: '127.0.0.1',
    hmr: process.env.DISABLE_HMR !== 'true',
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
  build: {
    target: 'esnext',
    modulePreload: false,
  },
  base: '/mfe/whiteboard/',
});
