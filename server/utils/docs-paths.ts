import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 插件开发指南的文件名（DOCS_INDEX.md 约定不可改名）。 */
export const PLUGIN_GUIDE_FILENAME = 'docs_plugin_guide.md';

/**
 * 解析当前模块可能所在的目录。
 *
 * - 源码运行（tsx / ESM）：import.meta.url 指向 server/utils/；
 * - 生产构建（dist/server.cjs）：import.meta 会被 esbuild shim 掉，改用 __dirname（<pkg>/dist）。
 */
function defaultStartDirs(): string[] {
  const dirs: string[] = [];
  try {
    const url = import.meta.url;
    if (typeof url === 'string' && url.startsWith('file:')) {
      dirs.push(path.dirname(fileURLToPath(url)));
    }
  } catch {
    // CJS 产物中 import.meta.url 不可用，回退到 __dirname。
  }
  if (typeof __dirname !== 'undefined') dirs.push(__dirname);
  return dirs;
}

/**
 * 在源码布局与 npm 发布布局中定位 docs_plugin_guide.md。
 *
 * 查找顺序：
 * 1. <moduleDir>/../docs_plugin_guide.md   —— dist/server.cjs → <pkg>/docs_plugin_guide.md
 * 2. <moduleDir>/../../docs_plugin_guide.md —— server/utils → <repo>/docs_plugin_guide.md
 * 3. <cwd>/docs_plugin_guide.md             —— 旧部署方式兜底
 *
 * 返回 null 表示三处都不存在，调用方应返回 404 而不是抛异常。
 */
export function resolvePluginGuidePath(
  startDirs: string[] = defaultStartDirs(),
  cwd: string = process.cwd(),
): string | null {
  const candidates: string[] = [];
  for (const dir of startDirs) {
    candidates.push(path.resolve(dir, '..', PLUGIN_GUIDE_FILENAME));
    candidates.push(path.resolve(dir, '..', '..', PLUGIN_GUIDE_FILENAME));
  }
  candidates.push(path.resolve(cwd, PLUGIN_GUIDE_FILENAME));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
