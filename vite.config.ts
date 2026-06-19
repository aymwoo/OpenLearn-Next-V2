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
        remotes: {},
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
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      target: 'esnext',
      modulePreload: false,
    },
  };
});
