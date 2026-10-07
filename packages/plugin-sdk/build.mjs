/**
 * Build script for @openlearn/plugin-sdk — produces a publishable package.
 *
 * Generates:
 *   dist/index.js   — bundled runtime exports (Token constants)
 *   dist/index.d.ts — standalone type declarations (hand-written + generated)
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

// 2. Assemble standalone type declarations.
//
//    `openlearn.d.ts` holds the hand-written host contract (Token, PluginContext,
//    PluginHttpRouter, frontend-only types — none of which have a source of truth
//    in packages/core). `generated.d.ts` holds everything derivable from source,
//    extracted by generate-dts.mjs. Concatenating them into one ambient script
//    keeps the published package self-contained.
//
//    Both files are ambient (no top-level import/export of values), so they share
//    one global scope; generate-dts.mjs skips any name openlearn.d.ts already
//    declares, which is what keeps the concatenation collision-free.
await import('./generate-dts.mjs');

const handDts = fs.readFileSync(path.join(__dirname, 'openlearn.d.ts'), 'utf8');
const generatedDts = fs.readFileSync(path.join(__dirname, 'generated.d.ts'), 'utf8');

/**
 * `ManifestV3` 的声明是 `z.infer<typeof manifestSchemaV3>`，会引用 zod。
 * openlearn.d.ts 本身刻意保持零 import（自包含），所以 import 只能注入到
 * **拼接产物**上；zod 是本包的 peerDependency，消费侧必然有。
 *
 * 只在真的用到 `z.` 时才注入 —— 无条件 import 会让不装 zod 的消费侧也报错。
 */
const prelude = /\bz\s*\./.test(generatedDts) ? "import { z } from 'zod';\n" : '';
if (prelude) console.log('   ↳ 注入 zod 类型 import（generated.d.ts 引用了 z.*）');

fs.writeFileSync(path.join(distDir, 'index.d.ts'), prelude + handDts + '\n' + generatedDts);

console.log('✅ @openlearn/plugin-sdk built to dist/');
console.log(`   dist/index.js   (${(fs.statSync(path.join(distDir, 'index.js')).size / 1024).toFixed(1)} KB)`);
console.log(`   dist/index.d.ts (${(fs.statSync(path.join(distDir, 'index.d.ts')).size / 1024).toFixed(1)} KB)`);
