import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';

/**
 * 迁移 075：学案活动接入 LearningSurface。
 *
 * 先跑到 074（与线上库一致），插入历史活动，再执行剩余迁移，验证：
 *   - `lesson_activities.surface_id` 列存在且历史行为 NULL；
 *   - `surface_id` 上的部分唯一索引存在；
 *   - 未绑定时不产生任何 Surface 行（迁移不建空 Surface）。
 */
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

describe('迁移 075：lesson_activities.surface_id', () => {
  it('加列与部分唯一索引，历史活动保持未绑定', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learningsurface-075-'));
    const db = new Database(path.join(dir, 'migrate.db'));
    try {
      const migrations = loadMigrationsFromDirectory(MIGRATIONS_DIR);
      const before = migrations.filter((m) => !m.name.startsWith('075_'));
      runMigrations(db, before);

      const now = 1_700_000_000_000;
      db.prepare(
        'INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('lesson-075', '迁移测试课时', 'content', 'teacher-075', now, now);
      db.prepare(
        `INSERT INTO lesson_activities
           (id, lesson_id, order_index, type, title, required, visible, group_mode, created_at, updated_at)
         VALUES ('act-075', 'lesson-075', 0, 'reading', '历史活动', 1, 1, 'none', ?, ?)`,
      ).run(now, now);

      runMigrations(db, migrations);

      const columns = db.prepare('PRAGMA table_info(lesson_activities)').all() as { name: string }[];
      expect(columns.some((column) => column.name === 'surface_id')).toBe(true);

      const row = db.prepare("SELECT surface_id FROM lesson_activities WHERE id = 'act-075'").get() as
        { surface_id: string | null } | undefined;
      expect(row?.surface_id).toBeNull();

      const indexes = db.prepare('PRAGMA index_list(lesson_activities)').all() as { name: string }[];
      expect(indexes.some((index) => index.name === 'idx_lesson_activities_surface')).toBe(true);

      const surfaceCount = (
        db.prepare("SELECT COUNT(*) AS c FROM learning_surfaces WHERE kind = 'lesson_activity'").get() as { c: number }
      ).c;
      expect(surfaceCount).toBe(0);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
