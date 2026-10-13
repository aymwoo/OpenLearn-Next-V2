/**
 * 确认 @openlearn/plugin-sdk 能按 package.json 的发布入口被加载。
 *
 * 生产包 `dist/server.cjs` 以 CJS `require("@openlearn/plugin-sdk")` 加载它
 * （esbuild `--packages=external`）。这里用同一条解析路径，避免只验证
 * Vitest 把包别名到 index.ts 的那条开发路径。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'package.json'));

let pkgJsonPath;
try {
  pkgJsonPath = require.resolve('@openlearn/plugin-sdk/package.json');
} catch (err) {
  console.error('[plugin-sdk] package.json is not resolvable:', err);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
const mainRel = typeof pkg.main === 'string' ? pkg.main : './dist/index.js';
const entry = path.resolve(path.dirname(pkgJsonPath), mainRel);

if (!fs.existsSync(entry)) {
  console.error(`[plugin-sdk] entry missing: ${entry}`);
  console.error('Run `node scripts/build-plugin-sdk.mjs` (or `pnpm install` / `pnpm build`).');
  process.exit(1);
}

let loaded;
try {
  loaded = require('@openlearn/plugin-sdk');
} catch (err) {
  console.error(`[plugin-sdk] require("${entry}") failed:`, err);
  process.exit(1);
}

const token = loaded?.Token ?? loaded?.default?.Token;
if (typeof token !== 'function') {
  console.error('[plugin-sdk] resolved entry does not export Token');
  process.exit(1);
}

console.log(`[plugin-sdk] require ok → ${entry}`);
