#!/usr/bin/env tsx
/**
 * 迁移失败 → 快照恢复 → 启动正常 演练（Issue #150）。
 *
 * 真实场景：升级时某条迁移中途失败，平台按设计中止且数据库保持迁移前状态；
 * 运维用 `pre_migration_*.db` 快照在分钟级恢复。这个脚本把整条链路在临时目录里
 * 跑一遍，CI 失败即说明「恢复路径」已经不能用。
 *
 * 断言：
 * 1. 全量迁移后的库能生成一致性快照（`VACUUM INTO`）；
 * 2. 注入一条中途失败的迁移 → 抛错且**整条事务回滚**（表没建、迁移记录没变）；
 * 3. `runRestore(--snapshot)` 能恢复快照：完整性校验通过、迁移条数与业务数据一致；
 * 4. 用恢复后的库启动真实服务：`/health` 与 `/health/ready` 均 200，且不产生新迁移。
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadMigrationsFromDirectory, runMigrations } from '../../packages/core/db/migrator.js';
import { runRestore } from '../../cli-data.mjs';
import { REPO_ROOT, createTempDir, rmDir, startServer } from '../upgrade-regression/lib.js';

const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');
const DRILL_MARKER = 'restore-drill-v1';

function fail(message: string): never {
  console.error(`[restore-drill] ✗ ${message}`);
  process.exit(1);
}

function appliedNames(db: Database.Database): string[] {
  return (db.prepare('SELECT name FROM _migrations ORDER BY name').all() as { name: string }[]).map((row) => row.name);
}

async function main(): Promise<void> {
  const dataDir = createTempDir('ol-restore-drill-');
  const dbPath = path.join(dataDir, 'educational_os.db');
  const backupsDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  // 让迁移器自己的「迁移前快照」也落在临时目录，不污染工作树。
  process.env.BACKUP_DIR = backupsDir;

  console.log(`[restore-drill] dataDir=${dataDir}`);
  const migrations = loadMigrationsFromDirectory(MIGRATIONS_DIR);
  if (migrations.length === 0) fail('migrations/ 目录为空，无法演练');

  // ── 1. 建一个「刚升级完」的库并写入业务标记 ────────────────────────────
  let db = new Database(dbPath);
  try {
    runMigrations(db, migrations);
    db.exec('CREATE TABLE IF NOT EXISTS drill_marker (value TEXT NOT NULL);');
    db.prepare('INSERT INTO drill_marker (value) VALUES (?)').run(DRILL_MARKER);
  } finally {
    db.close();
  }
  const baseline = (() => {
    const check = new Database(dbPath, { readonly: true });
    try {
      return appliedNames(check);
    } finally {
      check.close();
    }
  })();
  console.log(`[restore-drill] ✓ 基线库就绪（${baseline.length} 条迁移）`);

  // ── 2. 生成迁移前快照（与 migrator 同款 VACUUM INTO）────────────────────
  const snapshot = path.join(backupsDir, 'pre_migration_drill.db');
  db = new Database(dbPath, { readonly: true });
  try {
    db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  if (!fs.existsSync(snapshot)) fail('未能生成 pre_migration 快照');
  console.log(`[restore-drill] ✓ 已生成迁移前快照 ${path.basename(snapshot)}`);

  // ── 3. 注入一条中途失败的迁移，必须整体回滚 ────────────────────────────
  const failing = {
    name: '999_drill_intentional_failure.sql',
    up: 'CREATE TABLE drill_tmp (id TEXT);\nCREATE TABLE drill_tmp (id TEXT);',
    down: '',
  };
  db = new Database(dbPath);
  try {
    let threw = false;
    try {
      runMigrations(db, [...migrations, failing]);
    } catch {
      threw = true;
    }
    if (!threw) fail('故意失败的迁移没有抛错 —— 迁移事务保护失效');
    const after = appliedNames(db);
    if (after.length !== baseline.length) fail(`迁移记录被写入了一半：${baseline.length} → ${after.length}`);
    const leftover = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drill_tmp'").get();
    if (leftover) fail('失败迁移的第一条语句没有回滚（drill_tmp 仍存在）');
  } finally {
    db.close();
  }
  console.log('[restore-drill] ✓ 迁移失败已整体回滚，库未留下半成品');

  // ── 4. 从快照恢复 ──────────────────────────────────────────────────────
  const restore = await runRestore(snapshot, { dbPath, migrationsDir: MIGRATIONS_DIR, backupsDir, silent: true });
  if (!restore.ok) fail(`restore 失败：${restore.error}`);
  db = new Database(dbPath, { readonly: true });
  try {
    const integrity = String(db.pragma('integrity_check', { simple: true }));
    if (integrity.toLowerCase() !== 'ok') fail(`恢复后完整性校验失败：${integrity}`);
    const restored = appliedNames(db);
    if (restored.length !== baseline.length) fail(`恢复后迁移条数不一致：${baseline.length} → ${restored.length}`);
    const marker = db.prepare('SELECT value FROM drill_marker').get() as { value: string } | undefined;
    if (marker?.value !== DRILL_MARKER) fail('恢复后业务数据丢失（drill_marker 不匹配）');
  } finally {
    db.close();
  }
  console.log('[restore-drill] ✓ 快照恢复成功，完整性与业务数据均一致');

  // ── 5. 用恢复后的库启动真实服务 ────────────────────────────────────────
  const server = await startServer({ dataDir, env: { LOG_LEVEL: 'error' } });
  try {
    const health = await fetch(`${server.url}/health`);
    if (!health.ok) fail(`恢复后 /health 非 200：${health.status}`);
    const ready = await fetch(`${server.url}/health/ready`);
    if (!ready.ok) fail(`恢复后 /health/ready 非 200：${ready.status}（可能仍有待应用迁移）`);
    console.log('[restore-drill] ✓ 恢复后服务启动正常（/health 与 /health/ready 均 200）');
  } finally {
    await server.stop();
  }

  const finalDb = new Database(dbPath, { readonly: true });
  try {
    const finalMigrations = appliedNames(finalDb);
    if (finalMigrations.length !== baseline.length) {
      fail(`启动后产生了新迁移：${baseline.length} → ${finalMigrations.length}`);
    }
  } finally {
    finalDb.close();
  }
  console.log('[restore-drill] ✓ 启动未产生新迁移（恢复点与代码版本一致）');

  rmDir(dataDir);
  console.log('[restore-drill] PASS');
}

main().catch((error) => {
  console.error('[restore-drill] 失败：', error);
  process.exit(1);
});
