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
 * 检查 @openlearn/plugin-sdk 的声明版本与实际解析版本是否一致（防依赖版本漂移）
 * 兼容 npm/pnpm/npx 依赖提升结构与 workspace 链接模式。
 */
export function checkSdkConsistency(fix = false, fixes = []) {
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

    if (spec === 'workspace:*' || spec.startsWith('workspace:')) {
      if (isWorkspace) return check('ok', `workspace 链接 → v${installed}`);
      return check('err', `声明 ${spec} 但 node_modules 中是独立安装的 v${installed}，请执行 pnpm install 修复`, true);
    }
    if (spec.startsWith('^')) {
      const base = spec.slice(1);
      const sameMajor = installed.split('.')[0] === base.split('.')[0];
      if (sameMajor && compareVersions(installed, base) >= 0) {
        return check('ok', `v${installed} 满足 ${spec}${isWorkspace ? ' (workspace 链接)' : ''}`);
      }
      return check('err', `解析到 v${installed}，不满足声明范围 ${spec}，存在版本漂移，请重新安装依赖`, true);
    }
    if (compareVersions(installed, spec) === 0) {
      return check('ok', `v${installed} 与精确 pin ${spec} 一致`);
    }
    return check('err', `解析到 v${installed}，与精确 pin ${spec} 不一致（版本漂移）— server.cjs 构建所用 SDK 与运行时不符，请 npm install 修复`, true);
  } catch (e) {
    return check('err', `无法解析 ${SDK}: ${e.message}`);
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

  // 6. 版本防漂移体系综合自检与修正
  // 6.1 SDK 依赖版本一致性（防版本漂移）
  checks.push(checkSdkConsistency(fix, fixes));

  // 6.2 平台内核核心版本漂移检查与修正
  checks.push(checkCoreVersionDrift(fix, fixes));

  // 6.3 NPX 缓存旧包版本漂移检查与修正
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

