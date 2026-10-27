/**
 * Issue #321：`build` 检测到 `migrations/` 时必须告警。
 *
 * 背景（两边都对，中间断了）：
 * - 宿主确实会在激活前执行 `<pluginDir>/migrations`（`lifecycle.ts` 的
 *   `runPluginDeclarativeMigrations`）；
 * - 官方 CLI 的 ZIP **只打包** `index.js` / `manifest.json` / `frontend.js`。
 *
 * 于是「按文档写了 migrations/ 的第三方插件」会经历：构建成功 → 安装成功 →
 * 激活成功 → 首次执行 SQL 时报 `no such table`。故障点被推迟到最难排查的时刻。
 *
 * 本测试锁住三件事：
 * 1. 有 `migrations/` 时 `build` 输出告警，并指路 `ctx.db.ensureTable` / `migrate`；
 * 2. 告警不改变产物契约 —— ZIP 仍然只有三件套，`migrations/` 不在里面（这是事实，不是 bug）；
 * 3. 没有 `migrations/` 时**不**告警（不许变成噪音）。
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';

const cliPath = path.resolve(__dirname, '../cli.mjs');

/** 造一个最小可构建的插件项目（package.json + src/index.ts [+ migrations/]）。 */
function makeProject(opts: { withMigrations: boolean }): { dir: string; zipName: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-sdk-mig-'));
  const pluginId = 'ext-mig-test';
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'openlearn-plugin-mig-test', version: '1.0.0', type: 'module' }, null, 2),
    'utf8',
  );
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'index.ts'),
    [
      'export default {',
      `  manifest: { id: '${pluginId}', name: 'Mig Test', version: '1.0.0', main: 'index.js' },`,
      '  async activate() {},',
      '};',
      '',
    ].join('\n'),
    'utf8',
  );
  if (opts.withMigrations) {
    fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'migrations', '001_initial_schema.sql'),
      'CREATE TABLE IF NOT EXISTS demo (id TEXT PRIMARY KEY);\n',
      'utf8',
    );
  }
  return { dir, zipName: 'openlearn-plugin-mig-test.zip' };
}

/** 跑 CLI build，同时拿到 stdout+stderr（告警走 stderr）。 */
function runBuild(dir: string): string {
  return execSync(`node ${cliPath} build 2>&1`, { cwd: dir, encoding: 'utf8' });
}

describe('Issue #321：build 期 migrations/ 告警', () => {
  it('存在 migrations/ 时告警，并说明 ZIP 不含该目录、改用 ensureTable/migrate', () => {
    const { dir, zipName } = makeProject({ withMigrations: true });
    try {
      const output = runBuild(dir);

      expect(output).toContain('migrations/');
      expect(output).toContain('ensureTable');
      expect(output).toContain('migrate');

      // 产物契约不变：ZIP 仍只有三件套
      const zipPath = path.join(dir, 'dist', zipName);
      expect(fs.existsSync(zipPath)).toBe(true);
      return JSZip.loadAsync(fs.readFileSync(zipPath)).then((zip) => {
        const entries = Object.keys(zip.files).sort();
        expect(entries).toEqual(['index.js', 'manifest.json']);
        expect(entries.some((e) => e.startsWith('migrations/'))).toBe(false);
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('没有 migrations/ 时不告警（避免噪音）', () => {
    const { dir } = makeProject({ withMigrations: false });
    try {
      const output = runBuild(dir);
      expect(output).not.toContain('migrations/');
      expect(output).toContain('Packaged');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
