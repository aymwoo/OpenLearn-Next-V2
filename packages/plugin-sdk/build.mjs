/**
 * Build script for @openlearn/plugin-sdk — produces a publishable package.
 *
 * Generates:
 *   dist/index.js   — bundled runtime exports (Token constants)
 *   dist/index.d.ts — standalone type declarations
 *
 * Usage: node packages/plugin-sdk/build.mjs
 */

import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');

// Ensure dist exists
fs.mkdirSync(distDir, { recursive: true });

// 1. Bundle runtime Token exports
//    Only the `export { ...Token }` lines in index.ts produce runtime code.
//    esbuild tree-shakes type-only exports automatically.
await esbuild.build({
  entryPoints: [path.join(__dirname, 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: path.join(distDir, 'index.js'),
  // Mark every bare/npm import (express, better-sqlite3, body-parser, zod,
  // ws, ...) as external. Only the monorepo source (../core, ../activity-ecosystem)
  // is inlined, so the ESM output never emits a broken `Dynamic require(...)`.
  packages: 'external',
  // Keep the Token class + constants, drop everything else unused
  treeShaking: true,
});

// 2. Copy standalone type declarations
fs.copyFileSync(
  path.join(__dirname, 'openlearn.d.ts'),
  path.join(distDir, 'index.d.ts'),
);

console.log('✅ @openlearn/plugin-sdk built to dist/');
console.log(`   dist/index.js   (${(fs.statSync(path.join(distDir, 'index.js')).size / 1024).toFixed(1)} KB)`);
console.log(`   dist/index.d.ts (${(fs.statSync(path.join(distDir, 'index.d.ts')).size / 1024).toFixed(1)} KB)`);
