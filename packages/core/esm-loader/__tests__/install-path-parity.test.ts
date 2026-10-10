/**
 * C-6 回归测试：两条安装路径的静态防线强度必须一致。
 *
 * 背景：`plugin.install`（传 sourceCode）此前把源码**裸写盘**，完全不经过
 * `bundlePlugin()` 与 `openlearn-token-enforcer`；而 `plugin.install_zip` 却有一整套。
 * 于是管理员经审批后用源码路径安装的插件可直接 `import fs from 'node:fs'` ——
 * 不是「绕过」防线，而是该防线在这条路径上从未存在。
 *
 * 本测试对**同一个恶意样本**分别走两条安装路径，断言两者都被拒绝。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import { PluginHost } from '../../plugin-host/index.js';
import { NodeEsmLoader } from '../node-loader.js';
import { ServiceRegistry } from '../../di/service-registry.js';
import { tmpZipPath } from './helpers/tmp-zip.js';

/** 内存库，schema 与 plugin-host 测试夹具保持一致 */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT,
      manifest TEXT,
      source_code TEXT,
      file_path TEXT,
      status TEXT,
      created_at INTEGER,
      loader_version TEXT,
      zip_package BLOB,
      version TEXT,
      execution_mode TEXT DEFAULT 'inline'
    );
    CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_id TEXT,
      key TEXT,
      value TEXT,
      updated_at INTEGER,
      PRIMARY KEY (plugin_id, key)
    );
  `);
  return db;
}

/** 恶意样本：计算式动态 import —— esbuild 的 onResolve 拦不住，运行时可拿到 child_process */
const MALICIOUS_SOURCE = `
export const manifest = {
  id: 'ext-malicious-computed-import',
  name: 'Malicious Computed Import',
  version: '1.0.0',
  main: 'index.js',
};
export async function activate() {
  const cp = await import('node:' + 'child_process');
  return cp;
}
`;

function validManifest(id: string, name: string) {
  return { id, name, version: '1.0.0', main: 'index.js' };
}

describe('安装路径静态防线一致性（C-6 / A-2）', () => {
  let db: Database.Database;
  let pluginsDir: string;
  let host: PluginHost;

  beforeEach(() => {
    db = createTestDb();
    pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-parity-'));
    host = new PluginHost(new ServiceRegistry(), new NodeEsmLoader(), db, pluginsDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(pluginsDir, { recursive: true, force: true });
  });

  async function buildZip(id: string, name: string, source: string): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(validManifest(id, name)));
    zip.file('index.js', source);
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  it('路径一（plugin.install / 源码）拒绝计算式 import', async () => {
    await expect(host.installPlugin(MALICIOUS_SOURCE)).rejects.toThrow();
  });

  it('路径二（plugin.install_zip / ZIP）同样拒绝计算式 import', async () => {
    const zipBuffer = await buildZip('ext-malicious-zip-computed', 'Malicious Zip Computed', MALICIOUS_SOURCE);
    await expect(host.installPluginFromZip(tmpZipPath(zipBuffer))).rejects.toThrow();
  });

  it('两条路径的拒绝理由一致（不是「一边通过、一边拒绝」）', async () => {
    const zipBuffer = await buildZip('ext-malicious-parity', 'Malicious Parity', MALICIOUS_SOURCE);

    const inlineErr = await host.installPlugin(MALICIOUS_SOURCE).then(
      () => null,
      (e: Error) => e,
    );
    const zipErr = await host.installPluginFromZip(tmpZipPath(zipBuffer)).then(
      () => null,
      (e: Error) => e,
    );

    expect(inlineErr).not.toBeNull();
    expect(zipErr).not.toBeNull();

    // 源码路径：词法静态门拦下（PluginSecurity 错误，含可读原因）
    expect(inlineErr!.message).toMatch(/PluginSecurity/);
    expect(inlineErr!.message).toMatch(/计算式 import/);

    // ZIP 路径：拒绝原因同样指向该 specifier（可能来自 esbuild enforcer，
    // 也可能来自 bundlePlugin 出口处的 assertPluginCodeSafe —— 两者都算通过）
    expect(zipErr!.message).toMatch(/openlearn-token-enforcer|PluginSecurity/i);
    expect(zipErr!.message).toContain('node:child_process');
  });

  it('源码路径拒绝绝对路径 import（曾可把宿主文件内联进产物）', async () => {
    const leaky = `
      export const manifest = ${JSON.stringify(validManifest('ext-malicious-abs', 'Malicious Abs'))};
      import fs from '/etc/passwd';
      export async function activate() { return fs; }
    `;
    await expect(host.installPlugin(leaky)).rejects.toThrow();
  });

  it('源码路径拒绝 eval', async () => {
    const evil = `
      export const manifest = ${JSON.stringify(validManifest('ext-malicious-eval', 'Malicious Eval'))};
      export async function activate() { return eval("1+1"); }
    `;
    await expect(host.installPlugin(evil)).rejects.toThrow();
  });

  it('合法源码仍可安装 —— 静态门不误伤', async () => {
    // 注意：不带 @openlearn 导入。installPlugin 走 extractManifest → NodeEsmLoader.load()，
    // 后者用 data: URL import() 执行，data: URL 无法解析裸模块名，会抛
    // ERR_UNSUPPORTED_RESOLVE_REQUEST。这是 inline 安装路径的**既有**限制，
    // 与本次静态门改动无关，故此用例只验证「合法代码不会被静态门误拒」。
    const good = `
      export const manifest = ${JSON.stringify(validManifest('ext-good-inline', 'Good Inline'))};
      export async function activate(ctx) { return true; }
    `;
    // 静态门（词法 + esbuild enforcer）都不应拦截这段合法代码
    const { assertPluginCodeSafe } = await import('../install-utils.js');
    expect(() => assertPluginCodeSafe(good)).not.toThrow();

    const manifest = await host.installPlugin(good);
    expect(manifest.id).toBe('ext-good-inline');

    // 落盘内容必须是**原始源码**（bundle 只做校验不改产物），否则 activatePlugin
    // 用 mock loader 以源码为键查表时会失配
    const row = db.prepare('SELECT id, file_path FROM plugins WHERE manifest LIKE ?').get('%ext-good-inline%') as
      { id: string; file_path: string } | undefined;
    expect(row).toBeDefined();
    expect(fs.readFileSync(row!.file_path, 'utf-8')).toBe(good);
    // 状态应为 INSTALLED（安装成功，非拒绝）
    expect(host.getPluginState(row!.id)).toBe('installed');
  });

  it('@openlearn 静态导入不被静态门误伤（放行到后续 loader 处理）', async () => {
    const withSdk = `
      import { IDatabaseToken } from '@openlearn/plugin-sdk';
      export const manifest = ${JSON.stringify(validManifest('ext-good-sdk', 'Good Sdk'))};
      export async function activate(ctx) { return true; }
    `;
    // 静态门本身放行；失败点若出现必须是 loader 的模块解析，而非 PluginSecurity
    const err = await host.installPlugin(withSdk).then(
      () => null,
      (e: Error) => e,
    );
    if (err) {
      expect(err.message).not.toMatch(/PluginSecurity/);
    }
  });
});
