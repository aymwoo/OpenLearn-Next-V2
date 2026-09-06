#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { runClean } from './cli-cleaner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

// ── Check Version & Help ───────────────────────────────────────────────────
if (args.includes('-v') || args.includes('--version')) {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
    console.log(`openlearn-next v${pkg.version}`);
  } catch {
    console.log('openlearn-next (version unknown)');
  }
  process.exit(0);
}

if (args.includes('-h') || args.includes('--help')) {
  console.log(`Usage: npx openlearn-next [command] [options]

Commands:
  clean, clean-cache       清理 NPX 包缓存与本地临时运行数据
                           选项:
                             --npx     仅清理 ~/.npm/_npx 中的 openlearn-next 历史包缓存
                             --db      重置本地 SQLite 数据库 (下次启动全新自动初始化)
                             --all     清理全部（NPX 历史包 + 运行临时日志 + 重置数据库）

Options:
  -p, --port <port>        监听端口 (默认: 9000)
  -v, --version            显示版本号
  -h, --help               显示此帮助信息
  --clean, --clean-cache   快捷清理缓存并退出

Environment:
  OPENLEARN_DB_PATH        SQLite database path (默认: ~/openlearn-next/data.db)
  GEMINI_API_KEY           Optional fallback AI key; configured via admin dashboard
`);
  process.exit(0);
}

// ── Handle Clean Command ───────────────────────────────────────────────────
const firstArg = args[0];
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

let port = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-p' || args[i] === '--port') {
    port = args[++i];
  }
}

if (port) process.env.PORT = port;

if (!process.env.OPENLEARN_DB_PATH) {
  const dataDir = join(os.homedir(), 'openlearn-next');
  mkdirSync(dataDir, { recursive: true });
  process.env.OPENLEARN_DB_PATH = join(dataDir, 'data.db');
}

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

console.log(`[openlearn-next] PORT=${process.env.PORT || '9000'}`);
console.log(`[openlearn-next] DB=${process.env.OPENLEARN_DB_PATH}`);

const serverPath = join(__dirname, 'dist', 'server.cjs');
const child = spawn('node', [serverPath], {
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
