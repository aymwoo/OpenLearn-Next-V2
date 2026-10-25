#!/usr/bin/env node
/**
 * 发布包插件激活验证（P0 回归工具）。
 *
 * ## 它验证什么
 *
 * `plugin-net-preload.cjs` 是 `process` 隔离模式下封锁插件原始 socket / DNS 的
 * 入口脚本（Issue #237）。未受信任的第三方插件被策略强制降级到 `process` 模式
 * （`packages/core/plugin-host/execution-policy.ts`），因此这个文件**必须在发布包里**。
 *
 * 它曾经不在包里 —— `files` 清单漏了它，于是：
 *   - `resolveNetPreloadPath()` 在发布包布局下四个候选路径全部落空 → 抛
 *     `[PluginNet] preload script not found`；
 *   - 第三方插件**根本起不来**（fail-closed，不是「防护悄悄失效」）；
 *   - 而 CI 抓不到，因为 CI 跑在仓库源码布局下，`cwd/dist/...` 恰好命中本地构建产物。
 *
 * 本脚本按「npm 用户的真实形态」复现这个场景：
 *   1. 从**按 files 清单还原的发布包**启动服务，且 **cwd = 用户项目目录**（与包目录无关）；
 *   2. 装一个第三方插件，强制 `executionMode=process`；
 *   3. 激活 → 子进程需要 `--require <preload>` 才能起。
 *
 * ## 用法
 *
 * ```bash
 * # 1) 构建 + 打包 + 还原到临时目录
 * pnpm build && npm pack --pack-destination /tmp
 * rm -rf /tmp/pkgcheck && mkdir /tmp/pkgcheck && tar -xzf /tmp/openlearn-next-*.tgz -C /tmp/pkgcheck
 *
 * # 2) 跑验证（退出码 0 = 插件成功激活）
 * node scripts/verify-packaged-plugin-preload.mjs /tmp/pkgcheck/package
 *
 * # 3) 反向对照：删掉包内该文件后应失败
 * rm /tmp/pkgcheck/package/dist/plugin-net-preload.cjs
 * node scripts/verify-packaged-plugin-preload.mjs /tmp/pkgcheck/package   # 期望非 0
 * ```
 *
 * 注意：服务以 `NODE_ENV=development` + `PLAYWRIGHT_TEST=1` 启动（生产模式禁止
 * `PLAYWRIGHT_TEST`，它会关闭默认口令门禁）—— 仅为让种子账号 `admin/admin` 可用。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

const pkgDir = path.resolve(process.argv[2] || '');
const port = Number(process.argv[3] || 9131);
const base = `http://127.0.0.1:${port}`;

if (!pkgDir || !fs.existsSync(path.join(pkgDir, 'dist', 'server.cjs'))) {
  console.error(`用法：node scripts/verify-packaged-plugin-preload.mjs <发布包目录> [端口]`);
  console.error(`  找不到 ${path.join(pkgDir, 'dist', 'server.cjs')}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ── 1. 造一个最小第三方插件 ─────────────────────────────────────────── */
async function buildPluginZip() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-pkgprobe-plugin-'));
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      {
        id: 'ext-audit-probe',
        name: 'Audit Probe',
        version: '1.0.0',
        main: 'index.js',
        description: '验证发布包能否激活 process 模式的第三方插件',
        author: 'audit',
        engines: { openlearn: '>=0.7.0' },
        capabilitiesProposed: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    [
      'export default {',
      "  manifest: { id: 'ext-audit-probe', name: 'Audit Probe', version: '1.0.0' },",
      '  async activate(ctx) {',
      "    ctx.log.info('[audit-probe] activated successfully');",
      '  },',
      '  async deactivate() {},',
      '};',
      '',
    ].join('\n'),
  );
  const zip = new JSZip();
  zip.file('manifest.json', fs.readFileSync(path.join(dir, 'manifest.json')));
  zip.file('index.js', fs.readFileSync(path.join(dir, 'index.js')));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.rmSync(dir, { recursive: true, force: true });
  return buf;
}

/** ── 2. 从「用户目录」启动发布包 ─────────────────────────────────────── */
const userCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-pkgprobe-user-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-pkgprobe-data-'));
const logPath = path.join(userCwd, 'server.log');
const logFd = fs.openSync(logPath, 'w');
const server = spawn(process.execPath, [path.join(pkgDir, 'dist/server.cjs')], {
  cwd: userCwd, // ← 用户项目目录：cwd 兜底候选必然落空
  env: {
    ...process.env,
    NODE_ENV: 'development', // 生产模式禁止 PLAYWRIGHT_TEST
    PLAYWRIGHT_TEST: '1',
    PORT: String(port),
    OPENLEARN_DATA_DIR: dataDir,
    OPENLEARN_DB_PATH: path.join(dataDir, 'educational_os.db'),
    ENCRYPTION_KEY: 'a'.repeat(64),
  },
  stdio: ['ignore', logFd, logFd],
});

const readLog = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '');

async function waitReady(timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if ((await fetch(`${base}/health`)).ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(500);
  }
  return false;
}

let exitCode = 1;
try {
  const zipBuf = await buildPluginZip();

  if (!(await waitReady())) throw new Error(`服务未在超时内就绪。日志尾部：\n${readLog().slice(-1500)}`);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entrance: 'teacher', username: 'admin', password: 'admin' }),
  });
  if (!login.ok) throw new Error(`登录失败：${login.status} ${await login.text()}`);
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

  const upload = await fetch(`${base}/api/plugins/upload-zip-raw`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      cookie,
      'x-filename': 'ext-audit-probe.zip',
      'x-execution-mode': 'process',
      'x-acknowledge-risk': 'true',
      'x-allow-unsigned': 'true',
    },
    body: zipBuf,
  });
  const uploadText = await upload.text();
  if (!upload.ok) throw new Error(`安装失败：${upload.status} ${uploadText}`);
  const pluginId = JSON.parse(uploadText).pluginId;

  const toggle = await fetch(`${base}/api/plugins/${pluginId}/toggle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ enabled: true }),
  });
  const toggleText = await toggle.text();

  await sleep(2500);
  const log = readLog();
  const preloadError = /\[PluginNet\] preload script not found/.test(log);
  const activated = /\[audit-probe\] activated successfully/.test(log);

  console.log('── 安装 ──');
  console.log(`  pluginId=${pluginId}`);
  console.log('── 激活 ──');
  console.log(`  ${toggle.status} ${toggleText.slice(0, 200)}`);
  console.log('── 判定 ──');
  console.log(`  preload 解析失败：${preloadError ? '是（❌ 插件起不来）' : '否'}`);
  console.log(`  插件激活成功：${activated ? '是（✅）' : '否（❌）'}`);
  if (preloadError) {
    const line = log.split('\n').find((l) => l.includes('[PluginNet]')) || '';
    console.log(`  线索：${line.trim().slice(0, 300)}`);
  }

  exitCode = activated && !preloadError && toggle.ok ? 0 : 1;
  console.log(
    exitCode === 0 ? '\n✅ 发布包可激活 process 模式第三方插件' : '\n❌ 发布包无法激活 process 模式第三方插件',
  );
} catch (e) {
  console.error('验证失败：', e.message);
  console.error('── 服务端日志尾部 ──\n' + readLog().slice(-1200));
  // exitCode 保持 1
} finally {
  server.kill('SIGTERM');
  await sleep(500);
  server.kill('SIGKILL');
  fs.closeSync(logFd);
  fs.rmSync(userCwd, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(exitCode);
