#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let port = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-p' || args[i] === '--port') {
    port = args[++i];
  } else if (args[i] === '-h' || args[i] === '--help') {
    console.log(`Usage: npx openlearn-next [options]

Options:
  -p, --port <port>  Port to listen on (default: 9000)
  -h, --help         Show this help

Environment:
  OPENLEARN_DB_PATH  SQLite database path (default: ~/openlearn-next/data.db)
  GEMINI_API_KEY     Google Gemini API key for AI features
`);
    process.exit(0);
  }
}

if (port) process.env.PORT = port;

if (!process.env.OPENLEARN_DB_PATH) {
  const dataDir = join(os.homedir(), 'openlearn-next');
  mkdirSync(dataDir, { recursive: true });
  process.env.OPENLEARN_DB_PATH = join(dataDir, 'data.db');
}

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
