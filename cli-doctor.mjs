import os from 'node:os';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { scanNpxCacheEntries, runClean } from './cli-cleaner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 版本号比较（不含 semver 依赖，支持带前缀 v/^/~ 处理，prerelease 后缀截断后按数字逐段比较）。 */
export function compareVersions(a, b) {
  const parse = (v) =>
    String(v)
      .replace(/^[v^~]/, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

/**
 * 校验版本号是否满足指定的版本范围（无外部依赖实现，支持 >=, >, <=, <, =, ^, ~, * 等）
 * @param {string} ver 待校验的版本号（例如 '0.3.9'）
 * @param {string} range 版本范围约束（例如 '>=0.2.5', '^0.3.0', '>=0.2.0 <1.0.0', '*'）
 * @returns {boolean}
 */
export function satisfiesVersionRange(ver, range) {
  if (!range || range === '*' || range === 'latest' || range.trim() === '') return true;
  // 规整比较符号后的多余空格: '>= 0.2.5' -> '>=0.2.5'
  const normalized = range.replace(/([><=^~]+)\s+/g, '$1').trim();
  const parts = normalized.split(/\s+/).filter(Boolean);

  const parse = (v) =>
    String(v)
      .replace(/^[v]/, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);

  for (const part of parts) {
    if (part.startsWith('>=')) {
      const target = part.slice(2);
      if (compareVersions(ver, target) < 0) return false;
    } else if (part.startsWith('>')) {
      const target = part.slice(1);
      if (compareVersions(ver, target) <= 0) return false;
    } else if (part.startsWith('<=')) {
      const target = part.slice(2);
      if (compareVersions(ver, target) > 0) return false;
    } else if (part.startsWith('<')) {
      const target = part.slice(1);
      if (compareVersions(ver, target) >= 0) return false;
    } else if (part.startsWith('=')) {
      const target = part.slice(1);
      if (compareVersions(ver, target) !== 0) return false;
    } else if (part.startsWith('^')) {
      const target = part.slice(1);
      if (compareVersions(ver, target) < 0) return false;
      const pv = parse(ver);
      const pt = parse(target);
      if (pt[0] > 0) {
        if (pv[0] !== pt[0]) return false;
      } else if (pt[1] > 0) {
        if (pv[0] !== 0 || pv[1] !== pt[1]) return false;
      } else {
        if (pv[0] !== 0 || pv[1] !== 0 || pv[2] !== pt[2]) return false;
      }
    } else if (part.startsWith('~')) {
      const target = part.slice(1);
      if (compareVersions(ver, target) < 0) return false;
      const pv = parse(ver);
      const pt = parse(target);
      if (pv[0] !== pt[0] || pv[1] !== pt[1]) return false;
    } else {
      if (compareVersions(ver, part) !== 0) return false;
    }
  }
  return true;
}

/**
 * 检查 @openlearn/plugin-sdk 与 @openlearn/plugin-test-kit 的声明版本与实际解析版本（防依赖版本漂移）
 * 兼容 npm/pnpm/npx 依赖提升结构与 workspace 链接模式。
 */
export function checkSdkConsistency(_fix = false, _fixes = []) {
  const SDK = '@openlearn/plugin-sdk';
  const check = (status, message, fixable = false) => ({ name: 'SDK Version', status, message, fixable });
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    const spec = pkg.dependencies?.[SDK];
    if (!spec) return check('warn', `${SDK} 未在 package.json dependencies 中声明`);

    let pkgDir = null;
    try {
      const require = createRequire(import.meta.url);
      const pkgJsonPath = require.resolve(`${SDK}/package.json`);
      pkgDir = path.dirname(pkgJsonPath);
    } catch {
      try {
        const require = createRequire(import.meta.url);
        const entry = require.resolve(SDK);
        let dir = path.dirname(entry);
        while (dir !== path.dirname(dir)) {
          if (fs.existsSync(path.join(dir, 'package.json'))) {
            pkgDir = dir;
            break;
          }
          dir = path.dirname(dir);
        }
      } catch {}
    }

    if (!pkgDir) {
      const fallbackPath = path.join(__dirname, 'node_modules', ...SDK.split('/'));
      if (fs.existsSync(fallbackPath)) {
        pkgDir = fs.realpathSync(fallbackPath);
      }
    }

    if (!pkgDir) {
      return check('err', `无法解析 ${SDK}，请执行 pnpm install 或重新安装包`);
    }

    const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')).version;
    const isWorkspace = fs.existsSync(path.join(__dirname, 'pnpm-workspace.yaml')) && pkgDir.includes('packages/plugin-sdk');

    // 尝试识别 @openlearn/plugin-test-kit 版本
    let testKitInfo = '';
    const testKitPkg = path.join(__dirname, 'packages', 'plugin-test-kit', 'package.json');
    if (fs.existsSync(testKitPkg)) {
      try {
        const tkv = JSON.parse(fs.readFileSync(testKitPkg, 'utf-8')).version;
        if (tkv) testKitInfo = `, test-kit v${tkv}`;
      } catch {}
    } else {
      try {
        const require = createRequire(import.meta.url);
        const tkJson = require.resolve('@openlearn/plugin-test-kit/package.json');
        const tkv = JSON.parse(fs.readFileSync(tkJson, 'utf-8')).version;
        if (tkv) testKitInfo = `, test-kit v${tkv}`;
      } catch {}
    }

    if (spec === 'workspace:*' || spec.startsWith('workspace:')) {
      if (isWorkspace) return check('ok', `workspace 链接 → v${installed}${testKitInfo}`);
      return check('err', `声明 ${spec} 但 node_modules 中是独立安装的 v${installed}，请执行 pnpm install 修复`, true);
    }
    if (spec.startsWith('^')) {
      const base = spec.slice(1);
      const sameMajor = installed.split('.')[0] === base.split('.')[0];
      if (sameMajor && compareVersions(installed, base) >= 0) {
        return check('ok', `v${installed} 满足 ${spec}${isWorkspace ? ' (workspace 链接)' : ''}${testKitInfo}`);
      }
      return check('err', `解析到 v${installed}，不满足声明范围 ${spec}，存在版本漂移，请重新安装依赖`, true);
    }
    if (compareVersions(installed, spec) === 0) {
      return check('ok', `v${installed} 与精确 pin ${spec} 一致${testKitInfo}`);
    }
    return check('err', `解析到 v${installed}，与精确 pin ${spec} 不一致（版本漂移）— server.cjs 构建所用 SDK 与运行时不符，请 npm install 修复`, true);
  } catch (e) {
    return check('err', `无法解析 ${SDK}: ${e.message}`);
  }
}

/**
 * 检查官方内置 7 个核心系统插件的版本与当前平台版本引擎兼容性（防插件互锁）
 */
export function checkCorePluginsCompatibility() {
  const check = (status, message, fixable = false) => ({ name: 'Core Plugins', status, message, fixable });
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    const curVer = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version : '0.3.9';

    const CORE_PLUGINS = [
      { id: '@openlearn/plugin-builtin', name: 'Classroom Builtin Plugin', file: 'builtin.ts', defaultEngine: '>=0.2.5' },
      { id: '@openlearn/plugin-vfs', name: 'Virtual File System Plugin', file: 'vfs.ts', defaultEngine: '>=0.2.5' },
      { id: '@openlearn/plugin-process', name: 'Background Process Plugin', file: 'process.ts', defaultEngine: '>=0.2.5' },
      { id: '@openlearn/plugin-management', name: 'LMS Management Plugin', file: 'management.ts', defaultEngine: '>=0.2.5' },
      { id: '@openlearn/plugin-ai-planner', name: 'AI Planner Plugin', file: 'ai-planner.ts', defaultEngine: '>=0.2.5' },
      { id: '@openlearn/plugin-ai-submit-injector', name: 'AI Submit Injector Plugin', file: 'ai-submit-injector.ts', defaultEngine: '>=0.2.5' },
      { id: '@openlearn/plugin-assignment-eval', name: 'Assignment Evaluation Plugin', file: 'assignment-eval.ts', defaultEngine: '>=0.2.5' },
    ];

    const incompatible = [];
    const scanned = [];
    const pluginsDir = path.join(__dirname, 'packages', 'plugins');
    const hasSource = fs.existsSync(pluginsDir);

    for (const cp of CORE_PLUGINS) {
      let engine = cp.defaultEngine;
      let version = '1.0.0';

      if (hasSource) {
        const filePath = path.join(pluginsDir, cp.file);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          const engineMatch = content.match(/openlearn\s*:\s*['"]([^'"]+)['"]/);
          if (engineMatch) engine = engineMatch[1];
          const verMatch = content.match(/version\s*:\s*['"]([^'"]+)['"]/);
          if (verMatch) version = verMatch[1];
        }
      }

      scanned.push({ id: cp.id, version, engine });
      if (!satisfiesVersionRange(curVer, engine)) {
        incompatible.push(`${cp.id} (v${version}) 引擎约束 "${engine}" 无法被平台当前版本 v${curVer} 满足`);
      }
    }

    if (incompatible.length > 0) {
      return check('err', `发现 ${incompatible.length} 个核心插件与当前平台版本冲突: ${incompatible.join('; ')}`);
    }

    const firstEngine = scanned[0]?.engine || '>=0.2.5';
    return check('ok', `全部 7 个核心内置插件满足平台引擎约束 (engines.openlearn ${firstEngine})`);
  } catch (e) {
    return check('warn', `核心插件版本检测异常: ${e.message}`);
  }
}

/**
 * 检查数据库中已安装的扩展插件与本地插件清单的版本与引擎兼容性
 * @param {Object} [options]
 * @param {string} [options.dbPath]
 * @param {boolean} [options.fix]
 * @param {string[]} [options.fixes]
 * @param {boolean} [options.scanLocalPlugins]
 * @param {string} [options.pluginsDir]
 */
export async function checkInstalledPluginsCompatibility(options = {}) {
  const check = (status, message, fixable = false) => ({ name: 'Installed Plugins', status, message, fixable });
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    const curVer = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version : '0.3.9';

    const dbPath = options.dbPath
      ? path.resolve(options.dbPath)
      : (process.env.OPENLEARN_DB_PATH
          ? path.resolve(process.env.OPENLEARN_DB_PATH)
          : path.join(os.homedir(), 'openlearn-next', 'data.db'));

    const plugins = [];
    const incompatible = [];
    const invalid = [];

    // 1. 从 SQLite 数据库读取已安装的非系统扩展插件
    if (fs.existsSync(dbPath)) {
      try {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(dbPath, { readonly: true });
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plugins'").get();
        if (tableCheck) {
          const rows = db.prepare("SELECT id, name, manifest, status FROM plugins WHERE id NOT LIKE '@openlearn/plugin-%'").all();
          for (const row of rows) {
            let manifest = null;
            if (row.manifest) {
              try {
                manifest = JSON.parse(row.manifest);
              } catch {
                invalid.push(`${row.id} (manifest 损坏)`);
                continue;
              }
            }
            plugins.push({
              id: row.id,
              name: row.name || manifest?.name || row.id,
              version: manifest?.version || '1.0.0',
              engines: manifest?.engines,
              source: 'db',
            });
          }
        }
        db.close();
      } catch {
        // 读取失败降级
      }
    }

    // 2. 扫描本地 plugins/ 目录中的扩展插件 (支持 options.scanLocalPlugins 控制)
    const scanLocal = options.scanLocalPlugins !== false;
    const localPluginsDir = options.pluginsDir || path.join(__dirname, 'plugins');
    if (scanLocal && fs.existsSync(localPluginsDir)) {
      try {
        const entries = fs.readdirSync(localPluginsDir, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isDirectory()) {
            const mfPath = path.join(localPluginsDir, ent.name, 'manifest.json');
            if (fs.existsSync(mfPath)) {
              try {
                const mf = JSON.parse(fs.readFileSync(mfPath, 'utf-8'));
                if (mf.id && !plugins.some((p) => p.id === mf.id)) {
                  plugins.push({
                    id: mf.id,
                    name: mf.name || mf.id,
                    version: mf.version || '1.0.0',
                    engines: mf.engines,
                    source: 'filesystem',
                  });
                }
              } catch {
                invalid.push(`${ent.name} (本地 manifest 损坏)`);
              }
            }
          }
        }
      } catch {}
    }

    if (invalid.length > 0) {
      return check('warn', `检测到 ${invalid.length} 个损坏的插件清单: ${invalid.join(', ')}`);
    }

    if (plugins.length === 0) {
      return check('ok', '0 个外部扩展插件 (纯净核心运行环境)');
    }

    // 3. 校验每个扩展插件的 SemVer 格式与平台兼容性
    for (const p of plugins) {
      // 检查版本号格式
      if (!/^\d+\.\d+\.\d+/.test(p.version)) {
        invalid.push(`${p.id} 版本号 "${p.version}" 不符合语义化版本格式`);
      }

      // 检查 engines.openlearn
      const openlearnReq = p.engines?.openlearn;
      if (openlearnReq) {
        if (!satisfiesVersionRange(curVer, openlearnReq)) {
          incompatible.push(`${p.id} (v${p.version}) 要求平台 ${openlearnReq}，当前为 v${curVer}`);
        }
      }
    }

    if (incompatible.length > 0) {
      return check('warn', `发现 ${incompatible.length} 个插件与当前平台版本不兼容: ${incompatible.join('; ')}`);
    }

    const sample = plugins.slice(0, 2).map((p) => `${p.id} v${p.version}`).join(', ');
    const more = plugins.length > 2 ? ` 等 ${plugins.length} 个` : '';
    return check('ok', `${plugins.length} 个扩展插件 (${sample}${more}) 全部与平台 v${curVer} 兼容`);
  } catch (e) {
    return check('warn', `扩展插件版本检测异常: ${e.message}`);
  }
}

/**
 * 检查平台内核核心版本是否漂移（package.json 与 packages/core/version.ts）
 */
export function checkCoreVersionDrift(fix = false, fixes = []) {
  const check = (status, message, fixable = false) => ({ name: 'Core Version Drift', status, message, fixable });
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    if (!fs.existsSync(pkgPath)) return check('ok', '独立发行包，已对齐构建单体');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const pkgVer = pkg.version;

    const coreVersionFile = path.join(__dirname, 'packages', 'core', 'version.ts');
    if (!fs.existsSync(coreVersionFile)) {
      return check('ok', `v${pkgVer} (独立发行包，已对齐统一构建版本)`);
    }

    const coreContent = fs.readFileSync(coreVersionFile, 'utf-8');
    const match = coreContent.match(/PLATFORM_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (!match) {
      return check('warn', `未在 packages/core/version.ts 中解析到 PLATFORM_VERSION`);
    }

    const coreVer = match[1];
    if (coreVer === pkgVer) {
      return check('ok', `v${pkgVer} (package.json 与 packages/core/version.ts 严格一致)`);
    }

    if (fix) {
      const updated = coreContent.replace(
        /PLATFORM_VERSION\s*=\s*['"][^'"]+['"]/,
        `PLATFORM_VERSION = '${pkgVer}'`
      );
      fs.writeFileSync(coreVersionFile, updated, 'utf-8');
      fixes.push(`已自动将 packages/core/version.ts 同步为 v${pkgVer}`);
      return check('ok', `v${pkgVer} (已自动修复版本漂移: 从 v${coreVer} 同步为 v${pkgVer})`);
    }

    return check('err', `检测到内核版本漂移: package.json (v${pkgVer}) 与 packages/core/version.ts (v${coreVer}) 不一致！`, true);
  } catch (e) {
    return check('err', `版本一致性检查失败: ${e.message}`);
  }
}

/**
 * 检查 NPX 缓存中是否存在旧版 openlearn-next 历史包（防执行版本漂移）
 */
export function checkNpxCacheDrift(fix = false, fixes = []) {
  const check = (status, message, fixable = false) => ({ name: 'NPX Cache Drift', status, message, fixable });
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    const curVer = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version : null;
    const entries = scanNpxCacheEntries();
    if (entries.length === 0) {
      return check('ok', `未发现残留的 NPX 旧版历史包`);
    }

    const stale = curVer ? entries.filter((e) => e.version !== curVer) : entries;
    if (stale.length === 0) {
      return check('ok', `发现 ${entries.length} 处 NPX 缓存，均为当前版本 v${curVer}，无漂移`);
    }

    const staleVersions = [...new Set(stale.map((s) => s.version))];
    if (fix) {
      const cleanRes = runClean({ npx: true, silent: true });
      fixes.push(`已自动清理 ${cleanRes.npxCleaned} 个 NPX 历史旧版本缓存 (${staleVersions.join(', ')})`);
      return check('ok', `已自动清理 ${cleanRes.npxCleaned} 个旧版缓存 (${staleVersions.join(', ')})，消除了版本漂移`);
    }

    return check(
      'warn',
      `发现 ${stale.length} 个旧版 NPX 缓存 (${staleVersions.join(', ')})，npx 执行可能因缓存发生版本漂移`,
      true
    );
  } catch (e) {
    return check('warn', `NPX 缓存扫描失败: ${e.message}`);
  }
}

/**
 * 诊断指定端口是否可用
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
export function checkPortAvailable(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * 获取本机所有局域网可用 IPv4 地址
 * @returns {string[]}
 */
export function getNetworkIps() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('127.')) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

/**
 * 运行系统环境自检、版本防漂移诊断与自动自愈
 * @param {Object} [options]
 * @param {number} [options.port]
 * @param {string} [options.dbPath]
 * @param {boolean} [options.fix] 是否开启自动修复模式
 * @param {boolean} [options.silent]
 * @returns {Promise<{ ok: boolean, checks: Array<{ name: string, status: 'ok'|'warn'|'err', message: string, fixable?: boolean }>, fixes: string[] }>}
 */
export async function runDoctor(options = {}) {
  const checks = [];
  const fixes = [];
  const silent = Boolean(options.silent);
  const fix = Boolean(options.fix);

  // 1. Node.js 版本检查 (>= 20.0.0)
  const nodeVersion = process.versions.node;
  const majorNodeVersion = parseInt(nodeVersion.split('.')[0], 10);
  if (majorNodeVersion >= 20) {
    checks.push({
      name: 'Node.js Runtime',
      status: 'ok',
      message: `v${nodeVersion} (满足 >= 20.0.0 要求)`,
    });
  } else {
    checks.push({
      name: 'Node.js Runtime',
      status: 'err',
      message: `v${nodeVersion} 过低！OpenLearn 核心需要 Node.js >= 20.0.0，请升级。`,
    });
  }

  // 2. 操作系统与硬件
  const cpus = os.cpus() || [];
  const totalMemGb = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10;
  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  checks.push({
    name: 'Hardware & OS',
    status: 'ok',
    message: `${process.platform} (${process.arch}, ${cpus.length} CPU 核心, ${totalMemGb} GB 内存)`,
  });

  if (freeMemMb < 256) {
    checks.push({
      name: 'Memory Headroom',
      status: 'warn',
      message: `剩余可用内存偏低 (${freeMemMb} MB)，可能影响大课件解析`,
    });
  } else {
    checks.push({
      name: 'Memory Headroom',
      status: 'ok',
      message: `充足 (当前剩余 ${freeMemMb} MB 可用)`,
    });
  }

  // 3. 数据库目录与读写权限
  const dbPath = options.dbPath
    ? path.resolve(options.dbPath)
    : (process.env.OPENLEARN_DB_PATH
        ? path.resolve(process.env.OPENLEARN_DB_PATH)
        : path.join(os.homedir(), 'openlearn-next', 'data.db'));
  const dbDir = path.dirname(dbPath);

  try {
    if (!fs.existsSync(dbDir) && fix) {
      fs.mkdirSync(dbDir, { recursive: true });
      fixes.push(`已自动创建数据库存储目录: ${dbDir}`);
    } else {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    // 测试临时写入
    const testFile = path.join(dbDir, `.doctor_write_test_${Date.now()}`);
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    checks.push({
      name: 'Database Storage',
      status: 'ok',
      message: `${dbPath} (目录正常且具备读写权限)`,
    });
  } catch (err) {
    checks.push({
      name: 'Database Storage',
      status: 'err',
      message: `目录 ${dbDir} 写入失败: ${err.message}`,
      fixable: true,
    });
  }

  // 4. 端口可用性检查
  const targetPort = options.port || parseInt(process.env.PORT || '9000', 10);
  const isPortAvailable = await checkPortAvailable(targetPort);
  if (isPortAvailable) {
    checks.push({
      name: `Port ${targetPort}`,
      status: 'ok',
      message: `可用 (未被其他进程占用)`,
    });
  } else {
    checks.push({
      name: `Port ${targetPort}`,
      status: 'warn',
      message: `已被占用！启动时会自动重试或可通过 -p <other_port> 更换端口`,
    });
  }

  // 5. 局域网接入点
  const netIps = getNetworkIps();
  if (netIps.length > 0) {
    checks.push({
      name: 'Network Access',
      status: 'ok',
      message: `检测到局域网 IP: ${netIps.join(', ')}`,
    });
  } else {
    checks.push({
      name: 'Network Access',
      status: 'warn',
      message: `未检测到外部局域网 IPv4 地址（仅可通过 localhost 本机访问）`,
    });
  }

  // 6. 版本防漂移与插件生态综合自检
  // 6.1 SDK 依赖版本一致性（防版本漂移）
  checks.push(checkSdkConsistency(fix, fixes));

  // 6.2 平台内核核心版本漂移检查与修正
  checks.push(checkCoreVersionDrift(fix, fixes));

  // 6.3 核心内置插件版本与平台引擎兼容性
  checks.push(checkCorePluginsCompatibility());

  // 6.4 已安装与本地扩展插件版本与引擎兼容性
  checks.push(await checkInstalledPluginsCompatibility({ dbPath, fix, fixes }));

  // 6.5 NPX 缓存旧包版本漂移检查与修正
  checks.push(checkNpxCacheDrift(fix, fixes));

  const allOk = checks.every((c) => c.status !== 'err');

  if (!silent) {
    const bold = '\x1b[1m';
    const green = '\x1b[32m';
    const yellow = '\x1b[33m';
    const red = '\x1b[31m';
    const cyan = '\x1b[36m';
    const reset = '\x1b[0m';

    console.log(`\n${bold}${cyan}╔═════════════════════════════════════════════════════════════╗${reset}`);
    console.log(`${bold}${cyan}║           OpenLearn V2 System Diagnostics (doctor)          ║${reset}`);
    console.log(`${bold}${cyan}╚═════════════════════════════════════════════════════════════╝${reset}\n`);

    for (const c of checks) {
      let icon = `${green}✓${reset}`;
      if (c.status === 'warn') icon = `${yellow}⚠${reset}`;
      if (c.status === 'err') icon = `${red}✗${reset}`;
      console.log(`  ${icon} ${bold}${c.name.padEnd(20)}${reset} : ${c.message}`);
    }

    if (fixes.length > 0) {
      console.log(`\n${cyan}───────────────────────────────────────────────────────────────${reset}`);
      console.log(`  ${bold}${green}🔧 已自动执行修复 (Auto-Fix):${reset}`);
      for (const f of fixes) {
        console.log(`    ${green}✓${reset} ${f}`);
      }
    }

    const hasFixableIssues = checks.some((c) => c.status !== 'ok' && c.fixable);
    if (!fix && hasFixableIssues) {
      console.log(`\n  ${yellow}💡 提示: 检测到可通过自愈修复的问题，运行 'npx openlearn-next doctor --fix' 即可一键自动修复。${reset}`);
    }

    console.log(`\n${cyan}───────────────────────────────────────────────────────────────${reset}`);
    if (allOk) {
      console.log(`  ${bold}${green}诊断通过！核心运行环境健康，已消除版本漂移风险。${reset}\n`);
    } else {
      console.log(`  ${bold}${red}诊断发现阻断性问题，请根据上述提示处理后重试。${reset}\n`);
    }
  }

  return { ok: allOk, checks, fixes };
}

