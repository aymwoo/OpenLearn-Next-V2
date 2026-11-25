/**
 * 平台核心单一版本来源 (Single Source of Truth)
 * 供 PluginHost, Bootstrap, 服务治理及各 Manager/Registry 统一引用。
 *
 * 版本号在运行时从平台自身的 package.json 读取，避免发布新版本后此处字面量
 * 忘记同步、启动横幅继续显示旧版本号。
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 兜底版本：仅在无法定位平台 package.json 时使用 */
const FALLBACK_VERSION = '0.8.0';

interface LocatedPlatformPackage {
  version: string;
  gitHead: string | null;
  dir: string;
}

function locatePlatformPackage(): LocatedPlatformPackage | null {
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
        if (pkg.name === 'openlearn-next' && typeof pkg.version === 'string') {
          return {
            version: pkg.version,
            gitHead: typeof pkg.gitHead === 'string' ? pkg.gitHead : null,
            dir,
          };
        }
      } catch {
        /* 继续向上查找 */
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const locatedPackage = locatePlatformPackage();

/** 平台版本号：优先取定位到的 package.json.version，否则回退 FALLBACK_VERSION。 */
function readPlatformVersion(): string {
  return locatedPackage?.version ?? FALLBACK_VERSION;
}

/** 统一裁成 7 位短哈希；非法值返回空串。 */
function normalizeCommit(raw: string | null | undefined): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return /^[0-9a-f]{7,40}$/i.test(trimmed) ? trimmed.slice(0, 7).toLowerCase() : '';
}

/**
 * 当前运行代码的 commit 短哈希（7 位）。依次尝试：
 * 1. 部署环境注入的 `OPENLEARN_COMMIT` / `GIT_COMMIT`；
 * 2. 仓库目录下的 `git rev-parse`（开发与源码部署）；
 * 3. package.json 的 `gitHead`（npm 发布时自动写入）。
 * 都取不到时返回空串，调用方应省略 commit 展示。
 */
function readPlatformCommit(): string {
  const fromEnv = normalizeCommit(process.env.OPENLEARN_COMMIT || process.env.GIT_COMMIT);
  if (fromEnv) return fromEnv;

  if (locatedPackage) {
    try {
      const fromGit = execSync('git rev-parse --short=7 HEAD', {
        cwd: locatedPackage.dir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const normalized = normalizeCommit(fromGit);
      if (normalized) return normalized;
    } catch {
      /* 非 Git 环境（如 npm 全局安装）继续回退 */
    }
  }

  return normalizeCommit(locatedPackage?.gitHead);
}

export const PLATFORM_VERSION = readPlatformVersion();
export const PLATFORM_COMMIT = readPlatformCommit();
export const OPENLEARN_VERSION = PLATFORM_VERSION;
