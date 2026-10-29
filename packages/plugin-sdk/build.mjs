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

/**
 * 产物不得含 `node:` 静态导入（3.7.2 回归守卫）。
 *
 * `packages: 'external'` 只外置 **npm 包名**，node 内置模块（`node:fs` 等）会被
 * esbuild 原样留在 ESM 产物里。对宿主没问题，但对**第三方插件是致命的**：
 * 插件构建普遍用 `external: []` 把 SDK 内联进 worker bundle，随后做
 * 「产物不得残留 import」自检 —— 一见到 `import fs from "node:fs"` 就判失败。
 * class_manager 就是这样在 CI 作业 `Third-party plugin compatibility` 上连红的。
 *
 * 触发路径：`index.ts` 只要值导出一个宿主内部类，整条 `packages/core` 实现链
 * （含 `core/version.ts` 的 `import fs from 'node:fs'`）就会被内联进产物。
 * 13 KB → 75 KB 的膨胀就是这个信号的伴生现象。
 */
const bundleOutput = fs.readFileSync(path.join(distDir, 'index.js'), 'utf8');
const NODE_BUILTIN_RE = /^\s*import\s[^;]*?from\s*["']node:[^"']+["']/m;
if (NODE_BUILTIN_RE.test(bundleOutput)) {
  const offenders = bundleOutput
    .split('\n')
    .filter((l) => NODE_BUILTIN_RE.test(l))
    .slice(0, 10);
  console.error('[plugin-sdk] ✗ dist/index.js 含 node: 静态导入，第三方插件内联打包会失败：');
  for (const l of offenders) console.error(`  ${l.trim()}`);
  console.error(
    '[plugin-sdk] 常见成因：index.ts 值导出了宿主内部类（PluginRuntimeAdapter 等）。' +
      '宿主侧请从 packages/core/plugin-host/*.js 直接导入；对外只给类型。',
  );
  process.exit(1);
}

/**
 * 产物中所有的外部裸模块导入必须在 package.json 的 dependencies 或 peerDependencies 中声明（3.7.5 依赖完整性守卫）。
 *
 * 历史：3.6.0 起值导出 BaseActivityProvider，其实现链引入了 `import { v7 as uuidv7 } from 'uuid'`。
 * 由于 esbuild 设置了 `packages: 'external'`，裸导入说明符保留在 dist/index.js 中。
 * 但 package.json 漏声明了 uuid 依赖，导致第三方消费按 npm 包直接 import SDK 时
 * 抛出 ERR_MODULE_NOT_FOUND: Cannot find package 'uuid'（Issue #349）。
 */
const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const declaredDeps = new Set([
  ...Object.keys(pkgJson.dependencies || {}),
  ...Object.keys(pkgJson.peerDependencies || {}),
]);

const IMPORT_SPECIFIER_RE = /(?:import\s+(?:[^;]+?\s+from\s+)?|export\s+[^;]+?\s+from\s+)["']([^"']+)["']/g;
const undeclaredDeps = new Map();

for (const match of bundleOutput.matchAll(IMPORT_SPECIFIER_RE)) {
  const specifier = match[1];
  if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
  if (specifier.startsWith('node:')) continue;

  const pkgName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

  if (!declaredDeps.has(pkgName)) {
    if (!undeclaredDeps.has(pkgName)) undeclaredDeps.set(pkgName, []);
    undeclaredDeps.get(pkgName).push(specifier);
  }
}

if (undeclaredDeps.size > 0) {
  console.error('[plugin-sdk] ✗ dist/index.js 含未在 package.json 声明的外部依赖导入：');
  for (const [pkgName, specs] of undeclaredDeps.entries()) {
    console.error(`  • 包名: "${pkgName}"（导入说明符: ${specs.map((s) => `"${s}"`).join(', ')}）`);
  }
  console.error(
    '[plugin-sdk] 请在 packages/plugin-sdk/package.json 的 dependencies 或 peerDependencies 中补齐声明。' +
      '否则第三方按 npm 包消费时将抛出 ERR_MODULE_NOT_FOUND。',
  );
  process.exit(1);
}

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
