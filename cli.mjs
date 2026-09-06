#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';

import { runClean } from './cli-cleaner.mjs';
import { runDoctor } from './cli-doctor.mjs';
import { runBackup, runRestore, runResetAdmin, runPluginsList } from './cli-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    'backup',
    'restore',
    'reset-admin',
    'plugins',
    'clean',
    'clean-cache',
  ]);

  const ALIAS_COMMAND_MAP = {
    '--doctor': 'doctor',
    '--backup': 'backup',
    '--restore': 'restore',
    '--reset-admin': 'reset-admin',
    '--plugins': 'plugins',
    '--clean': 'clean',
    '--clean-cache': 'clean',
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
    npx: false,
    db: false,
    port: null,
    host: null,
    dbPath: null,
    cors: null,
    password: null,
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

  // 校验未知位置参数（防手误误启服务）
  if (!command && positionalArgs.length > 0) {
    const potentialCmd = positionalArgs[0];
    throw new Error(`未知命令: "${potentialCmd}"。请运行 npx openlearn-next --help 查看可用命令。`);
  }

  // 兼容 plugins list 子参数
  const subcommandArgs = command === 'plugins' && positionalArgs[0] === 'list'
    ? positionalArgs.slice(1)
    : positionalArgs;

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
                           选项: --fix (一键自动修复版本漂移与目录权限)
  backup [file]            一键数据库快照在线备份 (默认输出至当前目录 openlearn_backup_*.db)
  restore <file>           从备份快照文件安全还原数据 (自动生成现有数据库回滚副本)
  reset-admin [options]    重置系统管理员 (admin) 密码 (默认重置为 admin)
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
  GEMINI_API_KEY           AI 助手兜底密钥 (推荐在管理员后台界面配置)
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
    process.env.OPENLEARN_DB_PATH = join(demoDir, 'data.db');
  } else if (flags.dbPath) {
    process.env.OPENLEARN_DB_PATH = resolve(flags.dbPath);
  } else if (!process.env.OPENLEARN_DB_PATH) {
    const dataDir = join(os.homedir(), 'openlearn-next');
    mkdirSync(dataDir, { recursive: true });
    process.env.OPENLEARN_DB_PATH = join(dataDir, 'data.db');
  }

  // ── Command Dispatcher ────────────────────────────────────────────────────
  if (command === 'doctor') {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 9000;
    const res = await runDoctor({
      port,
      dbPath: process.env.OPENLEARN_DB_PATH,
      fix: flags.fix,
    });
    process.exit(res.ok ? 0 : 1);
  }

  if (command === 'backup') {
    const targetFile = subcommandArgs[0];
    const res = await runBackup(targetFile, { dbPath: process.env.OPENLEARN_DB_PATH });
    process.exit(res.ok ? 0 : 1);
  }

  if (command === 'restore') {
    const sourceFile = subcommandArgs[0];
    const res = await runRestore(sourceFile, { dbPath: process.env.OPENLEARN_DB_PATH });
    process.exit(res.ok ? 0 : 1);
  }

  if (command === 'reset-admin') {
    const newPassword = flags.password || subcommandArgs[0] || 'admin';
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

