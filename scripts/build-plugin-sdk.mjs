/**
 * 构建 @openlearn/plugin-sdk 的 dist/。
 *
 * 根目录 `prepare` 与 `pnpm build` 都走这里，这样干净克隆在
 * `pnpm install` 之后就能 `pnpm lint`（tsc 解析的是 dist，不是源码）。
 *
 * Docker 的依赖层只复制了 package.json、还没有 SDK 源码。此时跳过，
 * 等 `COPY . .` 之后的 `pnpm build` 再真正编译。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'packages/plugin-sdk/index.ts');
const buildScript = path.join(root, 'packages/plugin-sdk/build.mjs');

if (!fs.existsSync(entry) || !fs.existsSync(buildScript)) {
  console.log('[plugin-sdk] source not present yet, skipping build');
  process.exit(0);
}

const result = spawnSync(process.execPath, [buildScript], {
  cwd: root,
  stdio: 'inherit',
});

if (result.error) {
  console.error('[plugin-sdk] failed to start build:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
