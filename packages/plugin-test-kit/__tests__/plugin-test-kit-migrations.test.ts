import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runTestPluginMigrations, createMockContext } from '../index.js';

describe('@openlearn/plugin-test-kit runTestPluginMigrations (Issue #142)', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-testkit-mig-'));
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runTestPluginMigrations 能够成功执行目录下的迁移文件并记录', () => {
    fs.writeFileSync(
      path.join(tmpDir, '001_initial.sql'),
      `-- UP
      CREATE TABLE {{prefix}}scores (id TEXT PRIMARY KEY, score REAL);
      -- DOWN
      DROP TABLE {{prefix}}scores;`,
    );
    fs.writeFileSync(
      path.join(tmpDir, '002_add_level.sql'),
      `-- UP
      ALTER TABLE {{prefix}}scores ADD COLUMN level TEXT DEFAULT 'C';`,
    );

    const result = runTestPluginMigrations(db, 'ext-grade', tmpDir);

    expect(result.appliedCount).toBe(2);
    expect(result.appliedNames).toEqual(['001_initial', '002_add_level']);

    // 验证表和字段
    db.prepare('INSERT INTO plugin_ext_grade_scores (id, score, level) VALUES (?, ?, ?)').run('s-1', 95, 'A');
    const row = db.prepare('SELECT * FROM plugin_ext_grade_scores WHERE id = ?').get('s-1') as any;
    expect(row.score).toBe(95);
    expect(row.level).toBe('A');

    // 再次调用幂等
    const res2 = runTestPluginMigrations(db, 'ext-grade', tmpDir);
    expect(res2.appliedCount).toBe(0);
  });

  it('createMockContext 提供的 db.migrate 支持事务原子性', async () => {
    const ctx = createMockContext({ pluginId: 'ext-atomic-test' });

    // 成功迁移
    await ctx.db.migrate(1, async (sqliteDb: any) => {
      sqliteDb.exec('CREATE TABLE dummy_items (id INT);');
    });

    const check: any = (ctx as any).resolve
      ? await ctx.resolve({ name: '@openlearn/core:IDatabase' } as any)
      : null;
    expect(check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dummy_items'").get()).toBeDefined();

    // 失败迁移应抛错且不提升版本
    await expect(
      ctx.db.migrate(2, async (sqliteDb: any) => {
        sqliteDb.exec('CREATE TABLE dummy_fail (id INT);');
        throw new Error('Forced failure in upgradeFn');
      }),
    ).rejects.toThrow('Forced failure in upgradeFn');

    const migRow = check.prepare('SELECT version FROM plugin_migrations WHERE plugin_id = ?').get('ext-atomic-test') as any;
    expect(migRow.version).toBe(1);
  });
});
