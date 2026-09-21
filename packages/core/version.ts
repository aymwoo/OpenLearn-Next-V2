/**
 * 平台核心单一版本来源 (Single Source of Truth)
 * 供 PluginHost, Bootstrap, 服务治理及各 Manager/Registry 统一引用。
 *
 * 版本号在运行时从平台自身的 package.json 读取，避免发布新版本后此处字面量
 * 忘记同步、启动横幅继续显示旧版本号。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 兜底版本：仅在无法定位平台 package.json 时使用 */
const FALLBACK_VERSION = '0.3.21';

function readPlatformVersion(): string {
  const bases: string[] = [];
  // CJS 产物（dist/server.cjs）：__dirname 指向 dist/
  if (typeof __dirname !== 'undefined') bases.push(__dirname);
  try {
    // ESM / tsx 直接运行 TS 源码
    bases.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* CJS 产物中 import.meta 不可用 */
  }
  for (const base of bases) {
    let dir = base;
    for (;;) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        if (pkg.name === 'openlearn-next' && typeof pkg.version === 'string') return pkg.version;
      } catch {
        /* 继续向上查找 */
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return FALLBACK_VERSION;
}

export const PLATFORM_VERSION = readPlatformVersion();
export const OPENLEARN_VERSION = PLATFORM_VERSION;
