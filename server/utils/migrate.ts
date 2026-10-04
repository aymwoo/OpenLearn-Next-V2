/**
 * 数据库迁移运行器
 *
 * Phase 20 - DB-MIG-01
 * 替代 try/catch ALTER TABLE 模式，提供版本化迁移管理。
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export interface Migration {
  name: string;
  up: string;
  down: string;
}

/**
 * 分割 SQL 脚本为多条可执行语句
 */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => {
      // 过滤空串或仅含注释的片段
      const content = s.replace(/--.*$/gm, '').trim();
      return content.length > 0;
    });
}

/**
 * 解析带有 -- UP 和 -- DOWN 标记的 SQL 内容
 */
export function parseMigrationSql(name: string, content: string): Migration {
  const upMatch = content.match(/--\s*UP([\s\S]*?)(?=--\s*DOWN|$)/i);
  const downMatch = content.match(/--\s*DOWN([\s\S]*)$/i);

  const up = upMatch ? upMatch[1].trim() : content.trim();
  const down = downMatch ? downMatch[1].trim() : '';

  return { name, up, down };
}

/**
 * 从指定目录加载并按文件名升序解析所有 .sql 迁移文件
 */
export function loadMigrationsFromDirectory(dirPath: string): Migration[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  return files.map((file) => {
    const fullPath = path.join(dirPath, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const name = path.basename(file, '.sql');
    return parseMigrationSql(name, content);
  });
}

/**
 * 执行单段 SQL 脚本，容错处理 duplicate column
 */
export function executeSqlStatements(db: Database.Database, sql: string): void {
  const statements = splitSqlStatements(sql);
  for (const stmt of statements) {
    try {
      db.exec(stmt);
    } catch (err: any) {
      if (err?.message && err.message.includes('duplicate column name')) {
        console.warn(`[Migration] Column already exists, safely continuing: ${stmt.slice(0, 60)}...`);
        continue;
      }
      throw err;
    }
  }
}

/**
 * 一致性检查结果，供调用方（与测试）消费。
 */
export interface ChecksumDrift {
  name: string;
  stored: string;
  actual: string;
}

export function runMigrations(db: Database.Database, migrations: Migration[]): ChecksumDrift[] {
  // 确保 _migrations 元表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      checksum TEXT NOT NULL
    );
  `);

  // 2026-10-04：此前只读取 `name`，写入的 checksum 从不回读校验 ——
  // 已执行的迁移被事后篡改完全无法察觉。现改为读出并比对。
  const appliedRows = db
    .prepare('SELECT name, checksum FROM _migrations')
    .all() as { name: string; checksum: string }[];
  const applied = new Map(appliedRows.map((r) => [r.name, r.checksum]));

  const byName = new Map(migrations.map((m) => [m.name, m]));

  // ── 校验已执行迁移的 checksum 是否被改动 ──────────────────────────
  const drift: ChecksumDrift[] = [];
  for (const [name, stored] of applied) {
    const migration = byName.get(name);
    // 迁移文件已从磁盘移除（如从 v2_plugins 仓库迁移过来）：无从校验，跳过。
    if (!migration) continue;
    const actual = simpleChecksum(migration.up);
    if (actual !== stored) {
      drift.push({ name, stored, actual });
    }
  }

  if (drift.length > 0) {
    const detail = drift.map((d) => `  - ${d.name}: 记录 ${d.stored} → 当前文件 ${d.actual}`).join('\n');
    const msg =
      `[Migration] 已执行迁移的 UP 脚本在应用后被修改过：\n${detail}\n` +
      '  这不会自动修复数据库 —— 已执行的部分无法回退。请确认是有意修改，' +
      '或补一条新的迁移来修正。';
    if (process.env.MIGRATION_CHECKSUM_STRICT === 'true') {
      throw new Error(msg);
    }
    console.error(msg);
  }

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    console.log(`[Migration] Applying: ${migration.name}`);

    // 2026-10-04：此前 UP 脚本逐条 exec 且不在事务内 ——
    // 中途失败会留下半应用状态，且 _migrations 行未写入，重启后会重跑
    // 已执行过的语句。现将「执行 + 登记」放进同一个事务。
    const applyOne = db.transaction(() => {
      executeSqlStatements(db, migration.up);
      db.prepare('INSERT INTO _migrations (name, applied_at, checksum) VALUES (?, ?, ?)').run(
        migration.name,
        Date.now(),
        simpleChecksum(migration.up),
      );
    });

    try {
      applyOne();
      console.log(`[Migration] Applied: ${migration.name}`);
    } catch (err) {
      console.error(`[Migration] FAILED: ${migration.name}`, err);
      throw err;
    }
  }

  return drift;
}

/**
 * 回滚指定的单项迁移
 */
export function rollbackMigration(db: Database.Database, migration: Migration): void {
  if (!migration.down || migration.down.trim() === '') {
    throw new Error(`Migration ${migration.name} does not provide a DOWN rollback script.`);
  }

  console.log(`[Migration] Rolling back: ${migration.name}`);
  executeSqlStatements(db, migration.down);
  db.prepare('DELETE FROM _migrations WHERE name = ?').run(migration.name);
  console.log(`[Migration] Rolled back: ${migration.name}`);
}

export function simpleChecksum(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(16);
}

/** 将字符串 SQL 转换为 Migration 对象 */
export function sqlMigration(name: string, up: string, down = ''): Migration {
  return { name, up, down };
}
