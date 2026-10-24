/**
 * 审计 H-5：SDK 的发布入口是 dist/，安装、构建、CI 和镜像都必须生成它。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();

describe('@openlearn/plugin-sdk 构建产物', () => {
  it('根脚本、CI 和 Dockerfile 都会构建并带上 SDK', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.prepare).toContain('scripts/build-plugin-sdk.mjs');
    expect(pkg.scripts.build.startsWith('node scripts/build-plugin-sdk.mjs')).toBe(true);

    const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('node scripts/build-plugin-sdk.mjs');

    const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('packages/plugin-sdk/dist');
    expect(dockerfile).toContain('verify-plugin-sdk-entry.mjs');

    const sdkPkg = JSON.parse(fs.readFileSync(path.join(root, 'packages/plugin-sdk/package.json'), 'utf8')) as {
      main: string;
      types: string;
    };
    expect(sdkPkg.main).toBe('./dist/index.js');
    expect(sdkPkg.types).toBe('./dist/index.d.ts');
  });

  it('缺少 dist 入口时加载失败，写出文件后才能加载', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-entry-'));
    const entry = path.join(dir, 'dist', 'index.js');
    const load = (file: string) =>
      spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const mod = await import(${JSON.stringify(pathToFileURL(file).href)}); if (mod.Token() !== 'ok') process.exit(2);`,
        ],
        { encoding: 'utf8' },
      );

    // 用独立 node 进程加载，避免 Vitest 把临时文件的失败结果缓存进模块图。
    expect(load(entry).status).not.toBe(0);

    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, 'export function Token() { return "ok"; }\n');
    const ok = load(entry);
    expect(ok.status, ok.stderr).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('构建后的包可以被 require，和 server.cjs 的加载方式一致', () => {
    execFileSync(process.execPath, [path.join(root, 'scripts/build-plugin-sdk.mjs')], {
      cwd: root,
      stdio: 'inherit',
    });
    const output = execFileSync(process.execPath, [path.join(root, 'scripts/verify-plugin-sdk-entry.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(output).toContain('require ok');
    expect(output).toContain('packages/plugin-sdk/dist/index.js');
  });

  it('发布入口不静态加载 express（否则隔离插件进程会被 -disallow-code-generation-from-strings 打死）', () => {
    // SDK 曾经通过 `../core/plugin-host/index.js` 再导出类，顺带把 base.js 的
    // `import express` 带进产物。插件进程 import SDK → express → body-parser →
    // depd 的 `new Function` 被权限模型直接拦截（EvalError，Issue #147）。
    execFileSync(process.execPath, [path.join(root, 'scripts/build-plugin-sdk.mjs')], {
      cwd: root,
      stdio: 'inherit',
    });
    const dist = fs.readFileSync(path.join(root, 'packages/plugin-sdk/dist/index.js'), 'utf8');
    expect(dist, 'SDK 产物不应再 import express —— 插件运行时不需要宿主 HTTP 栈').not.toMatch(/from\s+["']express["']/);
  });
});
