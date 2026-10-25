/**
 * 发布包必须携带 `plugin-net-preload.cjs`（P0 回归护栏）。
 *
 * ## 这个缺陷是怎么漏出去的
 *
 * 构建脚本会把 preload 脚本复制到 `dist/`（`package.json` 的 `build` 末尾那句
 * `cp packages/core/worker-runtime/plugin-net-preload.cjs dist/plugin-net-preload.cjs`），
 * 但 `files` 清单里**没有**这个文件 —— 于是 `npm pack` 出来的 tarball 不带它。
 *
 * 运行时 `resolveNetPreloadPath()` 的候选路径在发布包布局下全部落空：
 *
 * - `path.join(__dirname, 'plugin-net-preload.cjs')` → `<pkg>/dist/...` → 包内没这个文件；
 * - `process.cwd()/packages/core/worker-runtime/...` 与 `process.cwd()/dist/...`
 *   → 依赖用户当前目录，`npx openlearn-next` 在用户项目里跑时不存在；
 * - `import.meta.url` 派生那条 → **esbuild 把 CJS 产物里的 `import.meta` shim 成 `{}`**，
 *   `import.meta.url` 恒为 `undefined`，这条候选在发布形态下**永久失效**。
 *
 * 该函数是 fail-closed（找不到就抛 `[PluginNet] preload script not found`），
 * 所以后果不是「防护悄悄失效」，而是**插件进程直接起不来**：
 * 未受信任的第三方插件被策略强制降级到 `process` 模式，而 `process` 模式正是
 * 靠这个 preload 脚本封锁原始 socket / DNS（Issue #237）。
 *
 * ## 为什么 CI 抓不到
 *
 * CI 从**仓库源码布局**运行，服务 cwd = 仓库根 → `cwd/dist/plugin-net-preload.cjs`
 * 命中本地构建产物，问题被完全掩盖。缺陷只在「按 `files` 清单还原的发布包」里出现。
 * 这与已修的 `migrations/` 缺失（`npx` 起不来）是同一类打包缺陷。
 *
 * 因此这里不只断言「`files` 里有它」，还要**在真实文件系统上复现发布包布局**，
 * 断言解析器确实能指向 `<pkg>/dist/` 里的那份。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNetPreloadPath } from '../child-spawn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ROOT_PKG = path.join(REPO_ROOT, 'package.json');
const PRELOAD_NAME = 'plugin-net-preload.cjs';
/** preload 脚本的源码真身（构建时复制到 dist/ 的就是它）。 */
const PRELOAD_SOURCE = path.join(REPO_ROOT, 'packages/core/worker-runtime', PRELOAD_NAME);

let tempDirs: string[] = [];

beforeEach(() => {
  tempDirs = [];
});

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function readRootPkg(): { files?: string[]; scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(ROOT_PKG, 'utf-8'));
}

describe('发布包必须携带 network preload 脚本', () => {
  it('1. 根 package.json 的 files 清单必须包含 dist/plugin-net-preload.cjs', () => {
    const pkg = readRootPkg();
    expect(Array.isArray(pkg.files)).toBe(true);
    // 缺这一条 → tarball 不带 preload → npm 用户的第三方插件起不来。
    expect(pkg.files).toContain(`dist/${PRELOAD_NAME}`);
  });

  it('2. 构建脚本必须把 preload 脚本复制到 dist/（files 声明才不会指向空气）', () => {
    const pkg = readRootPkg();
    const build = pkg.scripts?.build ?? '';
    expect(build).toContain(PRELOAD_NAME);
    expect(build).toContain('dist/');
    // 源文件本身必须在
    expect(existsSync(PRELOAD_SOURCE)).toBe(true);
  });

  it('3. 发布包布局（<pkg>/dist）下必须能解析到 preload 脚本', () => {
    // 造一个「按 files 清单还原的发布包」：<pkg>/dist/server.cjs 与 preload 同目录。
    const pkgRoot = makeTemp('ol-preload-pkg-');
    const distDir = path.join(pkgRoot, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, 'server.cjs'), '// bundle');
    copyFileSync(PRELOAD_SOURCE, path.join(distDir, PRELOAD_NAME));

    // 用户目录里什么都没有 —— cwd 兜底候选必须不生效。
    const userCwd = makeTemp('ol-preload-usercwd-');

    const resolved = resolveNetPreloadPath({ startDirs: [distDir], cwd: userCwd });
    expect(resolved).toBe(path.join(distDir, PRELOAD_NAME));
    expect(existsSync(resolved)).toBe(true);
  });

  it('4. 反向对照：包内缺该文件时必须抛错（不得静默降级为无防护启动）', () => {
    const pkgRoot = makeTemp('ol-preload-missing-');
    const distDir = path.join(pkgRoot, 'dist');
    mkdirSync(distDir, { recursive: true });
    const userCwd = makeTemp('ol-preload-missing-cwd-');

    expect(() => resolveNetPreloadPath({ startDirs: [distDir], cwd: userCwd })).toThrow(
      /\[PluginNet\] preload script not found/,
    );
  });

  it('5. 打进包的那份必须是真的拦截脚本（socket / DNS 封锁），不是占位文件', () => {
    const pkgRoot = makeTemp('ol-preload-content-');
    const distDir = path.join(pkgRoot, 'dist');
    mkdirSync(distDir, { recursive: true });
    copyFileSync(PRELOAD_SOURCE, path.join(distDir, PRELOAD_NAME));

    const resolved = resolveNetPreloadPath({ startDirs: [distDir], cwd: pkgRoot });
    const code = readFileSync(resolved, 'utf-8');
    expect(code).toContain('net.Socket.prototype.connect');
    expect(code).toContain('dgram.createSocket');
    expect(code).toContain('blockDns');
    expect(code).toContain('ol-net-proxy');
  });
});
