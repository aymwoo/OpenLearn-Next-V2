#!/usr/bin/env node
// @ts-nocheck
/**
 * 备份 SQLite 主库（VACUUM INTO，可在服务运行时做一致性快照）以及数据目录里的
 * storage / plugins / uploads。
 *
 *   node scripts/site-backup.mjs
 *   node scripts/site-backup.mjs --dir /backups
 *
 * 容器内：
 *   docker compose exec app node scripts/site-backup.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

export function resolveDataDir(env = process.env) {
  if (env.OPENLEARN_DATA_DIR?.trim()) return path.resolve(env.OPENLEARN_DATA_DIR.trim());
  if (env.OPENLEARN_DB_PATH?.trim()) return path.dirname(path.resolve(env.OPENLEARN_DB_PATH.trim()));
  return process.cwd();
}

export function resolveDbPath(env = process.env) {
  if (env.OPENLEARN_DB_PATH?.trim()) return path.resolve(env.OPENLEARN_DB_PATH.trim());
  return path.join(resolveDataDir(env), 'educational_os.db');
}

export function resolveBackupDir(env = process.env) {
  if (env.BACKUP_DIR?.trim()) return path.resolve(env.BACKUP_DIR.trim());
  return path.join(resolveDataDir(env), 'backups');
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, backupDir?: string, now?: Date }} [options]
 */
export function backupSite(options = {}) {
  const env = options.env ?? process.env;
  const dataDir = resolveDataDir(env);
  const sourceDb = resolveDbPath(env);
  const destDir = options.backupDir ? path.resolve(options.backupDir) : resolveBackupDir(env);
  if (!fs.existsSync(sourceDb)) {
    throw new Error(`数据库不存在：${sourceDb}`);
  }
  fs.mkdirSync(destDir, { recursive: true });

  const id = stamp(options.now ?? new Date());
  const dbFile = path.join(destDir, `openlearn_${id}.db`);
  const filesArchive = path.join(destDir, `openlearn_files_${id}.tar.gz`);
  const manifestFile = path.join(destDir, `openlearn_${id}.manifest.json`);

  const db = new Database(sourceDb);
  try {
    db.pragma('busy_timeout = 5000');
    db.exec(`VACUUM INTO ${sqlString(dbFile)}`);
  } finally {
    db.close();
  }

  const parts = ['storage', 'plugins', 'uploads'].filter((name) => fs.existsSync(path.join(dataDir, name)));
  // 密钥文件与数据库密文分开保管。打进同一个包等于把钥匙和锁放在一起。
  const tarArgs = ['czf', filesArchive, '-C', dataDir, '--exclude', 'storage/encryption-key'];
  if (parts.length > 0) {
    const tar = spawnSync('tar', [...tarArgs, ...parts], { encoding: 'utf8' });
    if (tar.status !== 0) {
      throw new Error(`打包数据目录失败：${tar.stderr || tar.stdout || tar.error?.message || tar.status}`);
    }
  } else {
    const tar = spawnSync('tar', ['czf', filesArchive, '-T', '/dev/null'], { encoding: 'utf8' });
    if (tar.status !== 0) {
      throw new Error(`创建空文件包失败：${tar.stderr || tar.error?.message || tar.status}`);
    }
  }

  const encryptionKeyReminder =
    '密钥不在此备份中。请单独离线备份环境变量 ENCRYPTION_KEY，或数据目录里的 storage/encryption-key（与 bootstrap-credentials.txt 同目录，权限 600）。没有这把密钥就无法解密备份库中的 AI Provider API Key 和班级临时口令。';
  const manifest = {
    id,
    createdAt: (options.now ?? new Date()).toISOString(),
    dataDir,
    sourceDb,
    dbFile,
    filesArchive,
    included: parts,
    encryptionKeyExcluded: 'storage/encryption-key',
    encryptionKeyReminder,
  };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function readFlag(argv, name) {
  const idx = argv.indexOf(name);
  if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
}

function isCli() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return entry === fileURLToPath(import.meta.url);
}

if (isCli()) {
  try {
    const customDir = readFlag(process.argv.slice(2), '--dir');
    const result = backupSite(customDir ? { backupDir: customDir } : {});
    const sizeMb = (fs.statSync(result.dbFile).size / 1024 / 1024).toFixed(2);
    console.log('═'.repeat(64));
    console.log('✓ 站点备份完成（数据库 + storage/plugins/uploads）');
    console.log('═'.repeat(64));
    console.log(`  数据库 : ${result.dbFile} (${sizeMb} MB)`);
    console.log(`  文件包 : ${result.filesArchive}`);
    console.log(`  清单   : ${path.join(path.dirname(result.dbFile), `openlearn_${result.id}.manifest.json`)}`);
    console.log('─'.repeat(64));
    console.log(`! ${result.encryptionKeyReminder}`);
  } catch (err) {
    console.error(`✗ 站点备份失败：${err?.message ?? err}`);
    process.exit(1);
  }
}
