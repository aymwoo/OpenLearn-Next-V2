#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';

import { runClean } from './cli-cleaner.mjs';
import { runDoctor, runCheckUpdate, runPluginCompatibilityReport } from './cli-doctor.mjs';
import {
  runBackup,
  runRestore,
  runResetAdmin,
  runPluginsList,
  runMigrateStatus,
  runMigrateRollback,
} from './cli-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 启动期环境校验的 CLI 前置检查（审计残余风险 R-05）。
 *
 * ## 为什么需要
 *
 * `assertStartupEnv()` 只在 `server.ts` 的 `startServer()` 最早期执行。CLI 子命令
 * （`backup` / `restore` / `migrate` / `reset-admin` / `clean`）**不经过 `server.ts`**，
 * 于是同一个拼错的环境变量在服务入口会 fail-fast，在 CLI 里却静默沿用更宽的策略 ——
 * 而这几条命令正是要对真实数据库做破坏性操作（还原、回滚迁移、改管理员口令）。
 *
 * ## 为什么不是复制一份规则
 *
 * 校验规则只有一处真相源（`server/security/env-validation.ts`）。构建时用 esbuild 把
 * 它单独打成 `dist/env-validation.cjs`，CLI 动态加载它。加载不到（源码检出、未构建）
 * 时**不阻断**命令，只提示「本次未做环境校验」—— CLI 的可用性不该被构建产物绑架。
 *
 * @param {Record<string, string|undefined>} env 待校验环境（测试注入用）
 * @returns {Promise<{available: boolean, errors: Array<{key: string, message: string}>, warnings: Array<{key: string, message: string}>}>}
 */
export async function loadEnvValidation(env = process.env) {
  try {
    // 必须用 createRequire + 运行时拼路径，而不是 `await import('./dist/env-validation.cjs')`：
    // 后者会被 Vite/Vitest 的 import-analysis 在**转换期**静态解析，源码检出里没有
    // dist/ 时直接抛 "Failed to resolve import"，try/catch 拦不住（实测 CI 红）。
    // require 是运行期行为，文件不存在时才走到我们自己的 catch。
    const requireFromHere = createRequire(import.meta.url);
    const artifactPath = join(__dirname, 'dist', 'env-validation.cjs');
    const mod = requireFromHere(artifactPath);
    const validate = mod.validateStartupEnv || mod.default?.validateStartupEnv;
    if (typeof validate !== 'function') return { available: false, errors: [], warnings: [] };
    const result = validate(env) || {};
    return {
      available: true,
      errors: Array.isArray(result.errors) ? result.errors : [],
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
    };
  } catch {
    // 生产安装包里一定有 dist/env-validation.cjs；源码检出没有 —— 不当作错误。
    return { available: false, errors: [], warnings: [] };
  }
}

/** 需要读写的命令：环境非法时应当拒绝执行，而不是带着错误配置去动真实数据。 */
const ENV_BLOCKING_COMMANDS = new Set(['backup', 'restore', 'migrate', 'reset-admin', 'clean']);

/**
 * 判定「环境校验结果」对该命令是阻断、告警还是忽略。
 *
 * 抽成纯函数是为了能单测：`startCli` 里再判断的话，只能靠 spawn 子进程去验。
 *
 * - `doctor` / `compat-report`：只读诊断，永不被环境错误挡住（诊断工具自己先挂了就没意义）；
 * - 写命令：errors 非空 → 阻断；
 * - 无命令（启动服务）：不预检，交给 `server.ts` 的 `assertStartupEnv()`（避免同一份规则报两次）。
 */
export function decideEnvPreflight(command, result) {
  if (!result?.available) return { action: 'skip', reason: 'validation-artifact-missing' };
  if (result.errors.length > 0 && ENV_BLOCKING_COMMANDS.has(command)) {
    return { action: 'block', reason: 'invalid-env' };
  }
  if (result.errors.length > 0) return { action: 'warn', reason: 'invalid-env-diagnostic-command' };
  if (result.warnings.length > 0) return { action: 'warn', reason: 'env-warnings' };
  return { action: 'pass' };
}

/** 把校验结果打印成人能读的一段（与 `formatEnvIssues` 的呈现保持一致）。 */
export function formatEnvPreflight(result) {
  const fmt = (list) =>
    list.map((i) => `  [${(i.severity || 'ERROR').toUpperCase()}] ${i.key}: ${i.message}`).join('\n');
  const parts = [];
  if (result.warnings.length > 0) parts.push(`[openlearn-next] 启动期环境变量告警:\n${fmt(result.warnings)}`);
  if (result.errors.length > 0) parts.push(`[openlearn-next] 启动期环境变量非法:\n${fmt(result.errors)}`);
  return parts.join('\n');
}

/**
 * 健壮的 CLI 参数解析器 (Zero External Dependencies)
 * 支持 --flag=value 展开、任意位置放置子命令与选项、参数缺失校验
 */
export function parseCliArgs(rawArgs) {
  const normalized = [];
  for (const arg of rawArgs) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const eqIdx = arg.indexOf('=');
      normalized.push(arg.slice(0, eqIdx), arg.slice(eqIdx + 1));
    } else {
      normalized.push(arg);
    }
  }

  const KNOWN_COMMANDS = new Set([
    'doctor',
    'compat-report',
    'backup',
    'restore',
    'reset-admin',
    'plugins',
    'clean',
    'clean-cache',
    'migrate',
    'check-update',
  ]);

  const ALIAS_COMMAND_MAP = {
    '--doctor': 'doctor',
    '--compat-report': 'compat-report',
    '--backup': 'backup',
    '--restore': 'restore',
    '--reset-admin': 'reset-admin',
    '--plugins': 'plugins',
    '--clean': 'clean',
    '--clean-cache': 'clean',
    '--migrate': 'migrate',
    '--check-update': 'check-update',
  };

  let command = null;
  const positionalArgs = [];
  const flags = {
    version: false,
    help: false,
    open: false,
    demo: false,
    fix: false,
    all: false,
    full: false,
    npx: false,
    db: false,
    compatReport: false,
    targetVersion: null,
    port: null,
    host: null,
    dbPath: null,
    cors: null,
    password: null,
    snapshot: null,
    force: false,
  };

  for (let i = 0; i < normalized.length; i++) {
    const token = normalized[i];

    if (token === '-v' || token === '--version') {
      flags.version = true;
    } else if (token === '-h' || token === '--help') {
      flags.help = true;
    } else if (token === '-o' || token === '--open') {
      flags.open = true;
    } else if (token === '--demo' || token === '--temp') {
      flags.demo = true;
    } else if (token === '--fix') {
      flags.fix = true;
    } else if (token === '--all') {
      flags.all = true;
    } else if (token === '--full') {
      flags.full = true;
    } else if (token === '--npx') {
      flags.npx = true;
    } else if (token === '--db') {
      flags.db = true;
    } else if (token === '-p' || token === '--port') {
      const val = normalized[++i];
      if (!val || val.startsWith('-')) {
        throw new Error('选项 -p/--port 必须指定有效的端口数值');
      }
      flags.port = val;
    } else if (token === '-H' || token === '--host') {
      const val = normalized[++i];
      if (!val || val.startsWith('-')) {
        throw new Error('选项 -H/--host 必须指定有效的主机地址');
      }
      flags.host = val;
    } else if (token === '--db-path') {
      const val = normalized[++i];
      if (!val || val.startsWith('-')) {
        throw new Error('选项 --db-path 必须指定数据库文件路径');
      }
      flags.dbPath = val;
    } else if (token === '--cors') {
      const val = normalized[++i];
      if (!val || val.startsWith('-')) {
        throw new Error('选项 --cors 必须指定跨域白名单');
      }
      flags.cors = val;
    } else if (token === '-P' || token === '--password') {
      const val = normalized[++i];
      if (!val || val.startsWith('-')) {
        throw new Error('选项 -P/--password 必须指定密码内容');
      }
      flags.password = val;
    } else if (token === '--compat-report') {
      flags.compatReport = true;
      if (!command) {
        command = 'compat-report';
      }
    } else if (token === '--snapshot') {
      const val = normalized[++i];
      if (!val || val.startsWith('-')) {
        throw new Error('选项 --snapshot 必须指定迁移前快照文件路径 (pre_migration_*.db)');
      }
      flags.snapshot = val;
    } else if (token === '--force') {
      flags.force = true;
    } else if (token === '--target-version') {
      const val = normalized[++i];
      if (!val || val.startsWith('-')) {
        throw new Error('选项 --target-version 必须指定有效的目标版本号 (例如: 0.7.0 或 1.0.0)');
      }
      flags.targetVersion = val;
    } else if (ALIAS_COMMAND_MAP[token]) {
      if (!command) {
        command = ALIAS_COMMAND_MAP[token];
      }
    } else if (KNOWN_COMMANDS.has(token)) {
      if (!command) {
        command = token === 'clean-cache' ? 'clean' : token;
      }
    } else if (token.startsWith('-')) {
      throw new Error(`未知选项: "${token}"。请运行 npx openlearn-next --help 查看支持的选项。`);
    } else {
      positionalArgs.push(token);
    }
  }

  if (command === 'compat-report') {
    flags.compatReport = true;
  }

  // 校验未知位置参数（防手误误启服务）
  if (!command && positionalArgs.length > 0) {
    const potentialCmd = positionalArgs[0];
    throw new Error(`未知命令: "${potentialCmd}"。请运行 npx openlearn-next --help 查看可用命令。`);
  }

  // 兼容 plugins list 子参数
  const subcommandArgs =
    command === 'plugins' && positionalArgs[0] === 'list' ? positionalArgs.slice(1) : positionalArgs;

  return { command, subcommandArgs, flags };
}

// ── CLI Main Runner ─────────────────────────────────────────────────────────
export async function runCli(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    console.error(`[openlearn-next] 错误: ${err.message}`);
    process.exit(1);
  }

  const { command, subcommandArgs, flags } = parsed;

  // ── Check Version ──────────────────────────────────────────────────────────
  if (flags.version) {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
      console.log(`openlearn-next v${pkg.version}`);
    } catch {
      console.log('openlearn-next (version unknown)');
    }
    process.exit(0);
  }

  // ── Help Documentation ─────────────────────────────────────────────────────
  if (flags.help) {
    console.log(`Usage: npx openlearn-next [command] [options]

Commands:
  doctor [options]         运行环境自检、防版本漂移体检与自动修复
                           选项:
                             --fix            一键自动修复版本漂移与目录权限
                             --compat-report  运行已安装插件升级前兼容性预检报告
                             --target-version <ver> 指定拟升级的目标版本 (默认当前版本)
  compat-report [options]  运行已安装插件升级前兼容性预检报告 (等同于 doctor --compat-report)
                           选项: --target-version <ver>
  check-update             检查 npm 官方源是否存在平台更新与版本升级指引
  migrate [status|rollback] 查看数据库迁移状态或安全回滚最近一次迁移
                           子命令: status (默认速查), rollback (执行回滚)
  backup [file] [options]  一键数据冷备 (支持 --full 打包数据库与富媒体课件文件)
                           选项: --full (打包 database + uploads + storage 为 zip 归档)
  restore <file>           从备份快照文件安全还原数据 (支持 .db 镜像与 .zip 全量还原)
  restore --snapshot <db>  从迁移失败前的 pre_migration_*.db 快照恢复 (可加 --force 回滚到更旧库)
  reset-admin [options]    重置管理员 admin 的口令（未指定时随机生成，不再默认 admin）
                           选项: --password, -P <pwd>
  plugins [list]           查看当前已安装的平台插件清单与加载状态
  clean, clean-cache       清理 NPX 包缓存与本地临时运行数据
                           选项:
                             --npx     仅清理 ~/.npm/_npx 中的 openlearn-next 历史包缓存
                             --db      重置本地 SQLite 数据库 (下次启动全新自动初始化)
                             --all     清理全部（NPX 历史包 + 运行临时日志 + 重置数据库）

Server Options:
  -p, --port <port>        服务监听端口 (支持 --port=9000, 默认: 9000 或 process.env.PORT)
  -H, --host <host>        绑定网络接口 IP (支持 --host=0.0.0.0, 默认: 0.0.0.0)
  -o, --open               服务就绪后自动唤起系统默认浏览器访问
  --demo, --temp           临时演示沙盒模式：在系统临时目录创建一次性数据库，退出即自动销毁
  --cors <origins>         允许跨域访问来源白名单 (支持通配符，如: "http://example.com,*")
  --db-path <path>         自定义 SQLite 数据库文件绝对路径
  -v, --version            显示版本号
  -h, --help               显示此帮助信息

Environment Variables:
  PORT                     HTTP 服务端口 (默认: 9000)
  HOST                     监听主机地址 (默认: 0.0.0.0)
  OPENLEARN_DB_PATH        SQLite 数据库绝对路径 (默认: ~/openlearn-next/data.db)
  ALLOWED_ORIGINS          CORS 白名单来源 (默认放行同源与开发环境)
`);
    process.exit(0);
  }

  // ── Environment Setup ─────────────────────────────────────────────────────
  if (flags.port) process.env.PORT = flags.port;
  if (flags.host) process.env.HOST = flags.host;
  if (flags.cors) process.env.ALLOWED_ORIGINS = flags.cors;
  if (flags.open) process.env.OPEN_BROWSER = 'true';

  let demoDir = null;
  if (flags.demo) {
    demoDir = join(os.tmpdir(), `openlearn-demo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    mkdirSync(demoDir, { recursive: true });
    process.env.OPENLEARN_DATA_DIR = demoDir;
    process.env.OPENLEARN_DB_PATH = join(demoDir, 'data.db');
  } else if (flags.dbPath) {
    process.env.OPENLEARN_DB_PATH = resolve(flags.dbPath);
    if (!process.env.OPENLEARN_DATA_DIR) {
      process.env.OPENLEARN_DATA_DIR = dirname(process.env.OPENLEARN_DB_PATH);
    }
  } else if (!process.env.OPENLEARN_DB_PATH) {
    const dataDir = process.env.OPENLEARN_DATA_DIR
      ? resolve(process.env.OPENLEARN_DATA_DIR)
      : join(os.homedir(), 'openlearn-next');
    mkdirSync(dataDir, { recursive: true });
    process.env.OPENLEARN_DATA_DIR = dataDir;
    process.env.OPENLEARN_DB_PATH = join(dataDir, 'data.db');
  } else if (!process.env.OPENLEARN_DATA_DIR) {
    process.env.OPENLEARN_DATA_DIR = dirname(resolve(process.env.OPENLEARN_DB_PATH));
  }

  // ── 启动期环境预检（R-05）──────────────────────────────────────────────────
  //
  // 放在命令分发之前、help/version 之后：写命令必须先过这一关，否则
  // 「服务入口 fail-fast、CLI 静默放行」的口径分叉会一直存在。
  if (command && command !== 'check-update') {
    const envResult = await loadEnvValidation();
    const decision = decideEnvPreflight(command, envResult);
    if (decision.action === 'warn') {
      const text = formatEnvPreflight(envResult);
      if (text) console.warn(text);
      if (decision.reason === 'invalid-env-diagnostic-command') {
        console.warn(
          '[openlearn-next] 以上问题会让 `openlearn-next`（启动服务）直接拒绝启动；诊断命令继续执行以便排查。',
        );
      }
    } else if (decision.action === 'block') {
      console.error(formatEnvPreflight(envResult));
      console.error(
        `[openlearn-next] 环境变量非法，已拒绝执行 \`${command}\`。这几条命令会改动真实数据，` +
          '带着错误配置执行比直接停下更危险。请修正后重试；确需跳过请先修正环境变量，而不是绕过校验。',
      );
      process.exit(1);
    }
  }

  // ── Command Dispatcher ────────────────────────────────────────────────────
  if (command === 'compat-report' || (command === 'doctor' && flags.compatReport) || flags.compatReport) {
    const report = await runPluginCompatibilityReport({
      dbPath: process.env.OPENLEARN_DB_PATH,
      targetVersion: flags.targetVersion,
    });
    process.exit(report.summary.incompatibleCount > 0 ? 1 : 0);
  }

  if (command === 'doctor') {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 9000;
    const res = await runDoctor({
      port,
      dbPath: process.env.OPENLEARN_DB_PATH,
      fix: flags.fix,
    });
    process.exit(res.ok ? 0 : 1);
  }

  if (command === 'check-update') {
    const res = await runCheckUpdate();
    process.exit(res.ok ? 0 : 1);
  }

  if (command === 'migrate') {
    const sub = subcommandArgs[0] || 'status';
    if (sub === 'rollback') {
      const res = await runMigrateRollback({ dbPath: process.env.OPENLEARN_DB_PATH });
      process.exit(res.ok ? 0 : 1);
    } else {
      const res = await runMigrateStatus({ dbPath: process.env.OPENLEARN_DB_PATH });
      process.exit(res.ok ? 0 : 1);
    }
  }

  if (command === 'backup') {
    const targetFile = subcommandArgs[0];
    const res = await runBackup(targetFile, {
      dbPath: process.env.OPENLEARN_DB_PATH,
      full: flags.full || flags.all,
    });
    process.exit(res.ok ? 0 : 1);
  }

  if (command === 'restore') {
    // Issue #150：迁移失败后的 pre_migration_*.db 快照可直接恢复。
    const sourceFile = flags.snapshot || subcommandArgs[0];
    const res = await runRestore(sourceFile, {
      dbPath: process.env.OPENLEARN_DB_PATH,
      full: flags.full || flags.all,
      force: flags.force,
    });
    process.exit(res.ok ? 0 : 1);
  }

  if (command === 'reset-admin') {
    const newPassword = flags.password || subcommandArgs[0];
    const res = await runResetAdmin(newPassword, { dbPath: process.env.OPENLEARN_DB_PATH });
    process.exit(res.ok ? 0 : 1);
  }

  if (command === 'plugins') {
    const res = await runPluginsList({ dbPath: process.env.OPENLEARN_DB_PATH });
    process.exit(res.ok ? 0 : 1);
  }

  if (command === 'clean') {
    const cleanOptions = {
      all: flags.all,
      npx: flags.npx,
      db: flags.db,
    };
    runClean(cleanOptions);
    process.exit(0);
  }

  // ── Normal Server Startup ──────────────────────────────────────────────────
  if (flags.demo) {
    console.log(`[openlearn-next] 临时沙盒模式已激活: ${demoDir}`);
    console.log(`[openlearn-next] 提示: 退出程序时将自动销毁沙盒数据，不保留任何历史记录。`);
  }

  process.env.NODE_ENV = process.env.NODE_ENV || 'production';

  console.log(`[openlearn-next] PORT=${process.env.PORT || '9000'}`);
  console.log(`[openlearn-next] HOST=${process.env.HOST || '0.0.0.0'}`);
  console.log(`[openlearn-next] DB=${process.env.OPENLEARN_DB_PATH}`);
  if (process.env.ALLOWED_ORIGINS) {
    console.log(`[openlearn-next] CORS_ALLOWED=${process.env.ALLOWED_ORIGINS}`);
  }

  const serverPath = join(__dirname, 'dist', 'server.cjs');
  if (!existsSync(serverPath)) {
    console.error(`[openlearn-next] 错误: 服务执行产物未找到: ${serverPath}`);
    console.error(`[openlearn-next] 请先执行 'pnpm build' 构建产物，或通过 npm/npx 重新安装。`);
    process.exit(1);
  }

  const child = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: { ...process.env },
  });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (flags.demo && demoDir && existsSync(demoDir)) {
      try {
        rmSync(demoDir, { recursive: true, force: true });
        console.log('\n[openlearn-next] 临时沙盒环境清理完毕。');
      } catch {}
    }
  };

  let isShuttingDown = false;
  const handleSignal = (sig) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (child && !child.killed) {
      child.kill(sig);
      // 保底 35 秒强制退出（留足 server 端 30 秒优雅关机缓冲时间）
      setTimeout(() => {
        cleanup();
        process.exit(0);
      }, 35000).unref();
    } else {
      cleanup();
      process.exit(0);
    }
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('exit', cleanup);

  child.on('exit', (code) => {
    cleanup();
    process.exit(code || 0);
  });
}

// 仅在作为主入口脚本执行时唤起
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('cli.mjs') ||
    process.argv[1].endsWith('openlearn-next') ||
    (existsSync(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)));

if (isMain) {
  runCli();
}
