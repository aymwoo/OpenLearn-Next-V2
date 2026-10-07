/**
 * 测试用 `pluginsDir` 的创建与清理（H-1）。
 *
 * ## 为什么需要这个 helper
 *
 * `PluginHost` 的第 4 个构造参数 `pluginsDir` 可选，缺省回退到
 * `path.resolve(process.cwd(), 'plugins')`（plugin-host/index.ts:268）。
 * 漏传它不会报错 —— 测试照常通过，只是把插件产物**堆进仓库工作树**。
 *
 * 实测后果：仓库 `plugins/` 下积累了 **1705 个孤儿目录 / 24MB**，且每次 `pnpm test`
 * 继续增长。该目录被 `.gitignore` 忽略，所以 `git status` 完全看不见这些污染。
 *
 * `vitest.setup.ts` 里已加全局守卫把这类写入变成硬失败，但守卫只负责**暴露**问题；
 * 修法仍需逐个测试文件落实。这个 helper 把「建临时目录」和「清理」两件事收在一处，
 * 避免 10 个文件各写一遍略有差异的 `mkdtemp` + `rmSync`（其中一处漏清理就又攒下垃圾）。
 *
 * ## 用法
 *
 * ```ts
 * let pluginsDir: string;
 * beforeEach(() => { pluginsDir = createPluginsDir('vfs'); });
 * afterEach(() => { cleanupPluginsDir(pluginsDir); db.close(); });
 *
 * host = new PluginHost(sr, loader, db, pluginsDir);
 * ```
 *
 * ## 为什么不用 os.tmpdir 之外的位置
 *
 * 用系统临时目录而非仓库内路径，是为了让 `vitest.setup.ts` 的守卫**天然不会误伤**
 * 合法的测试写入 —— 守卫只拦 `<cwd>/plugins`。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 建一个本次测试专用的插件目录。
 *
 * @param tag 用途标签，仅用于目录名可读性（如 'vfs'、'hot-reload'）
 * @returns 目录绝对路径，可直接传给 `new PluginHost(..., pluginsDir)`
 */
export function createPluginsDir(tag: string): string {
  // 标签清洗：防止调用方传入含分隔符的字符串，把目录建到意外位置
  const safeTag = tag.replace(/[^a-zA-Z0-9_-]/g, '-');
  return fs.mkdtempSync(path.join(os.tmpdir(), `openlearn-plugins-${safeTag}-`));
}

/**
 * 清理 `createPluginsDir()` 建出的目录。
 *
 * 幂等：目录不存在时静默返回 —— `afterEach` 里调用时，测试体自己可能已经删过。
 *
 * @param pluginsDir - 待清理的目录；传空值则直接返回（避免 `afterEach` 变量未初始化时炸掉）
 */
export function cleanupPluginsDir(pluginsDir: string | undefined): void {
  if (!pluginsDir) return;
  fs.rmSync(pluginsDir, { recursive: true, force: true });
}
