/**
 * 数据库迁移运行器
 *
 * Phase 20 - DB-MIG-01
 * 替代 try/catch ALTER TABLE 模式，提供版本化迁移管理。
 */
import Database from 'better-sqlite3';

interface Migration {
  name: string;
  up: string;
  down: string;
}

export function runMigrations(db: Database.Database, migrations: Migration[]): void {
  // 确保 _migrations 元表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      checksum TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map(r => r.name),
  );

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    console.log(`[Migration] Applying: ${migration.name}`);

    try {
      db.exec(migration.up);
      const checksum = simpleChecksum(migration.up);
      db.prepare('INSERT INTO _migrations (name, applied_at, checksum) VALUES (?, ?, ?)')
        .run(migration.name, Date.now(), checksum);
      console.log(`[Migration] Applied: ${migration.name}`);
    } catch (err) {
      console.error(`[Migration] FAILED: ${migration.name}`, err);
      throw err;
    }
  }
}

function simpleChecksum(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

/** 将字符串 SQL 转换为 Migration 对象 */
export function sqlMigration(name: string, up: string, down: string): Migration {
  return { name, up, down };
}
