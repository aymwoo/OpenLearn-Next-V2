#!/usr/bin/env node
// @ts-nocheck
/**
 * 从 site-backup.mjs 的产物恢复数据库和文件目录。必须先停服。
 *
 *   node scripts/site-restore.mjs --list
 *   node scripts/site-restore.mjs --i-understand-downtime openlearn_YYYYmmdd_HHMMSS.db
 *   node scripts/site-restore.mjs --i-understand-downtime --manifest openlearn_YYYYmmdd_HHMMSS.manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveBackupDir, resolveDataDir, resolveDbPath } from './site-backup.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function has(argv, flag) {
  return argv.includes(flag);
}

function readFlag(argv, name) {
  const idx = argv.indexOf(name);
  if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
}

export function listSiteBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith('openlearn_') && name.endsWith('.manifest.json'))
    .sort()
    .reverse()
    .map((name) => {
      const full = path.join(backupDir, name);
      try {
        return JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch {
        return { id: name, manifestFile: full, invalid: true };
      }
    });
}

function integrity(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma('integrity_check', { simple: true });
    return result === 'ok';
  } finally {
    db.close();
  }
}

/**
 * @param {{ dbFile: string, filesArchive?: string, env?: NodeJS.ProcessEnv, force?: boolean }} options
 */
export function restoreSite(options) {
  const env = options.env ?? process.env;
  const targetDb = resolveDbPath(env);
  const dataDir = resolveDataDir(env);
  const dbFile = path.resolve(options.dbFile);
  if (!fs.existsSync(dbFile)) throw new Error(`备份库不存在：${dbFile}`);
  if (!integrity(dbFile)) throw new Error(`备份库完整性校验未通过：${dbFile}`);

  fs.mkdirSync(path.dirname(targetDb), { recursive: true });
  let safetyBackupPath;
  if (fs.existsSync(targetDb) && !options.force) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    safetyBackupPath = `${targetDb}.bak_${stamp}`;
    fs.copyFileSync(targetDb, safetyBackupPath);
  }

  const tmp = `${targetDb}.restore-tmp`;
  fs.copyFileSync(dbFile, tmp);
  if (!integrity(tmp)) {
    fs.rmSync(tmp, { force: true });
    throw new Error('复制备份后完整性校验失败，已中止，原库未覆盖');
  }
  fs.renameSync(tmp, targetDb);
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(targetDb + suffix, { force: true });
  }

  let extracted = false;
  if (options.filesArchive) {
    const archive = path.resolve(options.filesArchive);
    if (!fs.existsSync(archive)) throw new Error(`文件包不存在：${archive}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const tar = spawnSync('tar', ['xzf', archive, '-C', dataDir], { encoding: 'utf8' });
    if (tar.status !== 0) {
      throw new Error(`解压文件包失败：${tar.stderr || tar.error?.message || tar.status}`);
    }
    extracted = true;
  }

  if (!integrity(targetDb)) {
    throw new Error('恢复后的数据库完整性校验失败');
  }
  return { targetDb, dataDir, safetyBackupPath, extracted };
}

function holders(dbPath) {
  const probe = spawnSync('fuser', [dbPath], { encoding: 'utf8' });
  return (probe.stdout || '').trim();
}

function isCli() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return entry === fileURLToPath(import.meta.url);
}

if (isCli()) {
  const argv = process.argv.slice(2);
  const backupDir = resolveBackupDir();
  if (has(argv, '--list')) {
    const items = listSiteBackups(backupDir);
    if (!items.length) {
      console.log(`（${backupDir} 下没有站点备份清单）`);
    } else {
      console.log(`可用站点备份（${backupDir}）：`);
      for (const item of items) {
        console.log(`  ${item.id || '?'}  db=${item.dbFile || '?'}  files=${item.filesArchive || '(无)'}`);
      }
    }
    process.exit(0);
  }

  if (!has(argv, '--i-understand-downtime')) {
    console.error('✗ 拒绝执行：恢复会覆盖正在使用的数据库和文件目录，必须先停服，');
    console.error('  再传入 --i-understand-downtime。仅查看备份请用 --list。');
    process.exit(1);
  }

  const manifestPath = readFlag(argv, '--manifest');
  const positional = argv.filter((arg, index) => {
    if (arg.startsWith('--')) return false;
    const prev = argv[index - 1];
    return prev !== '--manifest';
  });

  let dbFile = positional[0];
  let filesArchive = positional[1];
  if (manifestPath) {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
    dbFile = dbFile || manifest.dbFile;
    filesArchive = filesArchive || manifest.filesArchive;
  }
  if (!dbFile) {
    const latest = listSiteBackups(backupDir)[0];
    if (!latest?.dbFile) {
      console.error('✗ 找不到备份。请传入数据库文件，或先运行 node scripts/site-backup.mjs。');
      process.exit(1);
    }
    dbFile = latest.dbFile;
    filesArchive = filesArchive || latest.filesArchive;
  }

  const target = resolveDbPath();
  const busy = holders(target);
  if (busy) {
    console.error(`✗ 检测到仍有进程持有数据库（fuser: ${busy}），请先停服再恢复。`);
    process.exit(1);
  }

  try {
    const result = restoreSite({
      dbFile,
      filesArchive,
      force: has(argv, '--force'),
    });
    console.log('═'.repeat(64));
    console.log('✓ 站点恢复完成');
    console.log('═'.repeat(64));
    console.log(`  数据库 : ${result.targetDb}`);
    if (result.safetyBackupPath) console.log(`  安全副本 : ${result.safetyBackupPath}`);
    console.log(`  文件目录 : ${result.extracted ? '已从备份包解压到 ' + result.dataDir : '未提供文件包，未改动'}`);
    console.log('  请确认 ENCRYPTION_KEY 与备份时一致，然后重新启动服务。');
    console.log('  密钥文件 storage/encryption-key 不在备份包内，请另行放回数据目录，或设置与备份时相同的 ENCRYPTION_KEY。');
  } catch (err) {
    console.error(`✗ 站点恢复失败：${err?.message ?? err}`);
    process.exit(1);
  }
}
