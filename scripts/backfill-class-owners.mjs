#!/usr/bin/env node
// @ts-nocheck
/**
 * 把 owner_user_id 为空的历史班级回填给指定教师。
 *
 *   node scripts/backfill-class-owners.mjs --list
 *   node scripts/backfill-class-owners.mjs --assign teacher
 *   node scripts/backfill-class-owners.mjs --class cls_xxx --assign teacher
 *
 * --assign 的值是 users.username（例如 teacher），写入的是 users.id。
 * 不加 --class 时只更新 owner_user_id 为空的班级，不会改已经有归属的班。
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveDbPath } from './site-backup.mjs';

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

function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  const cols = db.prepare('PRAGMA table_info(classes)').all();
  if (!cols.some((col) => col.name === 'owner_user_id')) {
    db.close();
    throw new Error('classes 表还没有 owner_user_id。请先把服务升级到包含迁移 021 的版本并成功启动一次。');
  }
  return db;
}

export function listClasses(db) {
  return db
    .prepare(
      `SELECT c.id, c.name, c.owner_user_id, u.username AS owner_username
         FROM classes c
         LEFT JOIN users u ON u.id = c.owner_user_id
        ORDER BY c.created_at`,
    )
    .all();
}

export function assignClassOwners(db, username, classId) {
  const user = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(username);
  if (!user) throw new Error(`找不到用户名为 ${username} 的账号`);
  if (user.role !== 'teacher' && user.role !== 'administrator') {
    throw new Error(`${username} 的角色是 ${user.role}，不能作为班级归属`);
  }
  if (classId) {
    const row = db.prepare('SELECT id, name, owner_user_id FROM classes WHERE id = ?').get(classId);
    if (!row) throw new Error(`找不到班级 ${classId}`);
    const info = db.prepare('UPDATE classes SET owner_user_id = ? WHERE id = ?').run(user.id, classId);
    return { userId: user.id, username: user.username, updated: info.changes, classIds: [classId] };
  }
  const pending = db.prepare('SELECT id FROM classes WHERE owner_user_id IS NULL OR owner_user_id = ?').all('');
  const info = db
    .prepare(`UPDATE classes SET owner_user_id = ? WHERE owner_user_id IS NULL OR owner_user_id = ''`)
    .run(user.id);
  return {
    userId: user.id,
    username: user.username,
    updated: info.changes,
    classIds: pending.map((row) => row.id),
  };
}

function printClasses(rows) {
  if (!rows.length) {
    console.log('（没有班级）');
    return;
  }
  for (const row of rows) {
    const owner = row.owner_user_id
      ? `${row.owner_username || '?'} (${row.owner_user_id})`
      : '（无归属，仅管理员可见）';
    console.log(`  ${row.id}  ${row.name}  归属=${owner}`);
  }
}

function isCli() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return entry === fileURLToPath(import.meta.url);
}

if (isCli()) {
  const argv = process.argv.slice(2);
  const dbPath = readFlag(argv, '--db') || resolveDbPath();
  let db;
  try {
    db = openDb(dbPath);
    if (has(argv, '--list') || !readFlag(argv, '--assign')) {
      console.log(`班级归属（${dbPath}）：`);
      printClasses(listClasses(db));
      if (!readFlag(argv, '--assign')) {
        console.log('');
        console.log('回填示例：node scripts/backfill-class-owners.mjs --assign teacher');
      }
    }
    const username = readFlag(argv, '--assign');
    if (username) {
      const result = assignClassOwners(db, username, readFlag(argv, '--class'));
      console.log(`✓ 已把 ${result.updated} 个班级的 owner_user_id 设为 ${result.username} (${result.userId})`);
      if (result.classIds.length) console.log(`  ${result.classIds.join(', ')}`);
    }
  } catch (err) {
    console.error(`✗ 回填失败：${err?.message ?? err}`);
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}
