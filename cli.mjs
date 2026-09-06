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

const args = process.argv.slice(2);
const firstArg = args[0] || '';

// ── Check Version ────────────────────────────────────────────────────────────
if (args.includes('-v') || args.includes('--version')) {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
    console.log(`openlearn-next v${pkg.version}`);
  } catch {
    console.log('openlearn-next (version unknown)');
  }
  process.exit(0);
}

// ── Help Documentation ───────────────────────────────────────────────────────
if (args.includes('-h') || args.includes('--help')) {
  console.log(`Usage: npx openlearn-next [command] [options]

Commands:
  doctor                   运行环境自检与健康诊断 (Node.js/硬件内存/存储权限/端口/网络)
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
  -p, --port <port>        服务监听端口 (默认: 9000 或 process.env.PORT)
  -H, --host <host>        绑定网络接口 IP (默认: 0.0.0.0 局域网全网监听)
  -o, --open               服务就绪后自动唤起系统默认浏览器访问
  --demo, --temp           临时演示沙盒模式：在系统临时目录创建一次性数据库，退出即自动销毁
  --cors <origins>         允许跨域访问来源白名单 (多个以逗号分隔，如: "http://example.com,*")
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

// ── Extract Options Helper ──────────────────────────────────────────────────
let customPort = null;
let customHost = null;
let customDbPath = null;
let customCors = null;
const isDemo = args.includes('--demo') || args.includes('--temp');
const isOpen = args.includes('-o') || args.includes('--open');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-p' || args[i] === '--port') {
    customPort = args[++i];
  } else if (args[i] === '-H' || args[i] === '--host') {
    customHost = args[++i];
  } else if (args[i] === '--db-path') {
    customDbPath = args[++i];
  } else if (args[i] === '--cors') {
    customCors = args[++i];
  }
}

if (customPort) process.env.PORT = customPort;
if (customHost) process.env.HOST = customHost;
if (customCors) process.env.ALLOWED_ORIGINS = customCors;
if (customDbPath) process.env.OPENLEARN_DB_PATH = resolve(customDbPath);
if (isOpen) process.env.OPEN_BROWSER = 'true';

// ── Command: clean / clean-cache ─────────────────────────────────────────────
const isCleanCommand =
  firstArg === 'clean' ||
  firstArg === 'clean-cache' ||
  args.includes('--clean') ||
  args.includes('--clean-cache');

if (isCleanCommand) {
  const cleanOptions = {
    all: args.includes('--all'),
    npx: args.includes('--npx'),
    db: args.includes('--db'),
  };
  runClean(cleanOptions);
  process.exit(0);
}

// ── Command: doctor ──────────────────────────────────────────────────────────
if (firstArg === 'doctor' || args.includes('--doctor')) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 9000;
  const res = await runDoctor({ port, dbPath: process.env.OPENLEARN_DB_PATH });
  process.exit(res.ok ? 0 : 1);
}

// ── Command: backup ──────────────────────────────────────────────────────────
if (firstArg === 'backup' || args.includes('--backup')) {
  const backupIdx = args.findIndex((a) => a === 'backup' || a === '--backup');
  let targetFile = undefined;
  if (backupIdx !== -1 && args[backupIdx + 1] && !args[backupIdx + 1].startsWith('-')) {
    targetFile = args[backupIdx + 1];
  }
  const res = await runBackup(targetFile, { dbPath: process.env.OPENLEARN_DB_PATH });
  process.exit(res.ok ? 0 : 1);
}

// ── Command: restore ─────────────────────────────────────────────────────────
if (firstArg === 'restore' || args.includes('--restore')) {
  const restoreIdx = args.findIndex((a) => a === 'restore' || a === '--restore');
  let sourceFile = undefined;
  if (restoreIdx !== -1 && args[restoreIdx + 1] && !args[restoreIdx + 1].startsWith('-')) {
    sourceFile = args[restoreIdx + 1];
  }
  const res = await runRestore(sourceFile, { dbPath: process.env.OPENLEARN_DB_PATH });
  process.exit(res.ok ? 0 : 1);
}

// ── Command: reset-admin ─────────────────────────────────────────────────────
if (firstArg === 'reset-admin' || args.includes('--reset-admin')) {
  let newPassword = 'admin';
  const pwdIdx = args.findIndex((a) => a === '--password' || a === '-P');
  if (pwdIdx !== -1 && args[pwdIdx + 1] && !args[pwdIdx + 1].startsWith('-')) {
    newPassword = args[pwdIdx + 1];
  } else if (args[1] && !args[1].startsWith('-')) {
    newPassword = args[1];
  }
  const res = await runResetAdmin(newPassword, { dbPath: process.env.OPENLEARN_DB_PATH });
  process.exit(res.ok ? 0 : 1);
}

// ── Command: plugins / plugins list ──────────────────────────────────────────
if (firstArg === 'plugins' || args.includes('--plugins')) {
  const res = await runPluginsList({ dbPath: process.env.OPENLEARN_DB_PATH });
  process.exit(res.ok ? 0 : 1);
}

// ── Normal Server Startup ────────────────────────────────────────────────────
let demoDir = null;

if (isDemo) {
  demoDir = join(os.tmpdir(), `openlearn-demo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
  mkdirSync(demoDir, { recursive: true });
  process.env.OPENLEARN_DB_PATH = join(demoDir, 'data.db');
  console.log(`[openlearn-next] 临时沙盒模式已激活: ${demoDir}`);
  console.log(`[openlearn-next] 提示: 退出程序时将自动销毁沙盒数据，不保留任何历史记录。`);
} else if (!process.env.OPENLEARN_DB_PATH) {
  const dataDir = join(os.homedir(), 'openlearn-next');
  mkdirSync(dataDir, { recursive: true });
  process.env.OPENLEARN_DB_PATH = join(dataDir, 'data.db');
}

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

console.log(`[openlearn-next] PORT=${process.env.PORT || '9000'}`);
console.log(`[openlearn-next] HOST=${process.env.HOST || '0.0.0.0'}`);
console.log(`[openlearn-next] DB=${process.env.OPENLEARN_DB_PATH}`);
if (process.env.ALLOWED_ORIGINS) {
  console.log(`[openlearn-next] CORS_ALLOWED=${process.env.ALLOWED_ORIGINS}`);
}

const serverPath = join(__dirname, 'dist', 'server.cjs');
const child = spawn('node', [serverPath], {
  stdio: 'inherit',
  env: { ...process.env },
});

let cleanedUp = false;
const cleanup = () => {
  if (cleanedUp) return;
  cleanedUp = true;
  if (isDemo && demoDir && existsSync(demoDir)) {
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
    // 3秒后强制保底退出
    setTimeout(() => {
      cleanup();
      process.exit(0);
    }, 3000).unref();
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
