/**
 * `getDefaultMigrationsDir()` 的解析顺序（P0 回归）。
 *
 * ## 背景：发布包曾完全无法启动
 *
 * 解析器原先写死 `path.resolve(__dirname, '../../../migrations')` —— 只在源码布局里成立
 * （`packages/core/db/` 上溯三级 = 仓库根）。打包成 `dist/server.cjs` 后同一个 `__dirname`
 * 是 `<pkg>/dist`，上溯三级跑到包外；而 `migrations/` 又不在 `files` 清单里。
 * 两者叠加 ⇒ `npx openlearn-next` 在用户目录启动时直接 `[DB SSOT] FATAL` 拒绝服务。
 *
 * 更隐蔽的是 `server.ts` 还有**第二份**解析（`path.join(process.cwd(), 'migrations')`）：
 * 它只修内核那侧不够，实测仍会把启动拦下来。所以本文件同时钉住「server.ts 不得再自己拼 cwd」。
 *
 * 这些用例全部在**真实文件系统**上跑（临时目录），不 mock fs —— 解析器的问题恰恰是
 * 「在真实目录结构里找错了地方」，mock 掉 fs 就测不到。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultMigrationsDir } from '../migrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

let tempDirs: string[] = [];
let originalCwd: string;
let originalEnv: string | undefined;

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** 造一个「有 sql 的迁移目录」。 */
function migrationsDirWith(base: string, file = '001_x.sql'): string {
  const dir = path.join(base, 'migrations');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), '-- UP\nSELECT 1;\n-- DOWN\nSELECT 1;');
  return dir;
}

beforeEach(() => {
  originalCwd = process.cwd();
  originalEnv = process.env.OPENLEARN_MIGRATIONS_DIR;
  delete process.env.OPENLEARN_MIGRATIONS_DIR;
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalEnv === undefined) delete process.env.OPENLEARN_MIGRATIONS_DIR;
  else process.env.OPENLEARN_MIGRATIONS_DIR = originalEnv;
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe('getDefaultMigrationsDir', () => {
  it('在仓库里解析到含 .sql 的 migrations 目录（源码布局的基线）', () => {
    const dir = getDefaultMigrationsDir();
    expect(dir).toBe(path.join(REPO_ROOT, 'migrations'));
  });

  it('OPENLEARN_MIGRATIONS_DIR 优先（只读挂载迁移目录的部署方式）', () => {
    const override = migrationsDirWith(makeTemp('ol-mig-override-'));
    process.env.OPENLEARN_MIGRATIONS_DIR = override;
    expect(getDefaultMigrationsDir()).toBe(path.resolve(override));
  });

  it('覆盖目录里没有 .sql 时忽略覆盖，继续按既有顺序解析', () => {
    // 关键：一个写错的覆盖值不应该让服务「找不到迁移」——那会把配置笔误放大成启动失败
    const empty = makeTemp('ol-mig-empty-');
    process.env.OPENLEARN_MIGRATIONS_DIR = empty;
    expect(getDefaultMigrationsDir()).toBe(path.join(REPO_ROOT, 'migrations'));
  });

  it('发布包布局：从 <pkg>/dist 上溯到包根，找到随包发布的 migrations/', () => {
    // 这就是曾经 P0 的确切形状：打包后 __dirname 是 <pkg>/dist，
    // 旧的 `../../../migrations` 已经跑到包外，而 migrations/ 又不在 files 里。
    const pkg = makeTemp('ol-mig-pkg-');
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'openlearn-next', version: '0.0.0' }));
    const expected = migrationsDirWith(pkg);
    const distDir = path.join(pkg, 'dist');
    mkdirSync(distDir, { recursive: true });

    const userCwd = makeTemp('ol-mig-usercwd-'); // 用户目录里没有 migrations
    expect(getDefaultMigrationsDir({ startDirs: [distDir], cwd: userCwd, env: {} })).toBe(path.resolve(expected));
  });

  it('monorepo 里不会被 packages/core/package.json 截停', () => {
    // 上溯只认 name === 'openlearn-next'；packages/core 的包名是 @openlearn/core
    const repo = makeTemp('ol-mig-mono-');
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'openlearn-next' }));
    const expected = migrationsDirWith(repo);
    const coreDir = path.join(repo, 'packages', 'core');
    mkdirSync(coreDir, { recursive: true });
    writeFileSync(path.join(coreDir, 'package.json'), JSON.stringify({ name: '@openlearn/core' }));

    expect(getDefaultMigrationsDir({ startDirs: [coreDir], cwd: makeTemp('ol-mig-c2-'), env: {} })).toBe(
      path.resolve(expected),
    );
  });

  it('包根有 package.json 但没有 migrations/ 时继续上溯，最后落到 cwd 兜底', () => {
    // 少打包了 migrations/ 的畸形包：不应该把「找不到」变成「找到了空目录」
    const pkg = makeTemp('ol-mig-nomig-');
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'openlearn-next' }));
    const distDir = path.join(pkg, 'dist');
    mkdirSync(distDir, { recursive: true });

    const userCwd = makeTemp('ol-mig-docker-');
    const expected = migrationsDirWith(userCwd); // Docker：WORKDIR=/app + COPY migrations
    expect(getDefaultMigrationsDir({ startDirs: [distDir], cwd: userCwd, env: {} })).toBe(path.resolve(expected));
  });

  it('cwd 下也没有 migrations 时仍返回该路径，由调用方给出可读的 FATAL', () => {
    // 解析器不负责报错：内核与 server.ts 都会检查「目录里没有 .sql」并给出各自的提示
    const bare = makeTemp('ol-mig-bare-');
    expect(getDefaultMigrationsDir({ startDirs: [bare], cwd: bare, env: {} })).toBe(
      path.resolve(path.join(bare, 'migrations')),
    );
  });
});

describe('解析器不得再分叉（回归护栏）', () => {
  it('server.ts 复用同一解析器，而不是自己拼 process.cwd()', () => {
    // 实测教训：只修内核那侧时，server.ts 的 cwd 版仍会 FATAL 拦住启动。
    const src = readFileSync(path.join(REPO_ROOT, 'server.ts'), 'utf-8');
    expect(src).not.toMatch(/path\.join\(\s*process\.cwd\(\)\s*,\s*['"]migrations['"]\s*\)/);
    expect(src).toContain('getDefaultMigrationsDir()');
  });

  it('migrator.ts 里不再出现写死的三级上溯', () => {
    // `../../../migrations` 只在源码布局成立，打包后就指到包外
    const src = readFileSync(path.join(REPO_ROOT, 'packages/core/db/migrator.ts'), 'utf-8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain("'../../../migrations'");
  });

  it('migrations/ 与 CLI 迁移器产物都在发布包清单里', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.files).toContain('migrations/');
    expect(pkg.files).toContain('dist/cli-migrator.cjs');
    expect(pkg.scripts.build).toContain('dist/cli-migrator.cjs');
  });
});
