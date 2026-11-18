/**
 * 验证 migration 062_xuean_lesson_pkg_and_courses：
 * - 5 张新表存在且结构正确
 * - lessons 新增可空 course_id
 * - 基于 000–061 的既有数据库零迁移（lessons.course_id 全 NULL；含 classroom-flow 057–061）
 * - activity_progress / lesson_activities / lesson_activity_blocks 的字段与 issue IKVO15 建议模型对齐
 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { loadMigrationsFromDirectory, runMigrations } from '../migrator.js';

const migrationsDir = path.resolve(process.cwd(), 'migrations');

function migrationNumber(name: string): number {
  const match = /^(\d+)_/.exec(name);
  if (!match) throw new Error(`unexpected migration name ${name}`);
  return Number.parseInt(match[1], 10);
}

function tableColumns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

describe('migration 062 — 学案式课时包 & 课程层（P0 数据模型）', () => {
  const dbs: Database.Database[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (dbs.length > 0) dbs.pop()?.close();
  });

  it('全量 migration 跑完后 5 张新表 + lessons.course_id 存在', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const db = new Database(':memory:');
    dbs.push(db);
    runMigrations(db, all);

    // 5 张新表
    expect(tableExists(db, 'courses')).toBe(true);
    expect(tableExists(db, 'course_enrollments')).toBe(true);
    expect(tableExists(db, 'lesson_activities')).toBe(true);
    expect(tableExists(db, 'lesson_activity_blocks')).toBe(true);
    expect(tableExists(db, 'activity_progress')).toBe(true);

    // lessons 加了 course_id
    expect(tableColumns(db, 'lessons')).toContain('course_id');
  });

  it('既有 lessons 数据升级后 course_id 全 NULL（零迁移）', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const legacy = all.filter((m) => migrationNumber(m.name) <= 56);
    const db = new Database(':memory:');
    dbs.push(db);
    runMigrations(db, legacy);

    // 先插入既有 lesson，模拟生产数据
    db.prepare(
      'INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('l1', '旧课时', 'content', 'u1', 1000, 1000);

    runMigrations(db, all);

    const row = db.prepare('SELECT course_id FROM lessons WHERE id = ?').get('l1') as {
      course_id: string | null;
    };
    expect(row.course_id).toBeNull();
  });

  it('lesson_activities 字段对齐 issue IKVO15 建议模型', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const db = new Database(':memory:');
    dbs.push(db);
    runMigrations(db, all);

    const cols = tableColumns(db, 'lesson_activities');
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'lesson_id',
        'order_index',
        'type',
        'title',
        'config_json',
        'required',
        'visible',
        'peer_review',
        'group_mode',
        'submission_type',
        'rubric_json',
        'release_at',
        'due_at',
        'created_at',
        'updated_at',
      ]),
    );
  });

  it('activity_progress 主键 + status + verified 正确', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const db = new Database(':memory:');
    dbs.push(db);
    runMigrations(db, all);

    const cols = tableColumns(db, 'activity_progress');
    expect(cols).toEqual(
      expect.arrayContaining([
        'activity_id',
        'student_id',
        'status',
        'progress_percent',
        'verified',
        'score',
        'graded_at',
        'last_activity_at',
      ]),
    );

    // 验证复合主键生效
    db.prepare(
      'INSERT INTO lesson_activities (id, lesson_id, order_index, type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('a1', 'l1', 0, 'reading', '读课文', 1000, 1000);

    db.prepare(
      'INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, verified) VALUES (?, ?, ?, ?, ?)',
    ).run('a1', 's1', 'not_started', 0, 0);

    expect(() =>
      db
        .prepare(
          'INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, verified) VALUES (?, ?, ?, ?, ?)',
        )
        .run('a1', 's1', 'in_progress', 50, 0),
    ).toThrow(); // UNIQUE 冲突
  });

  it('courses + course_enrollments 字段正确', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const db = new Database(':memory:');
    dbs.push(db);
    runMigrations(db, all);

    expect(tableColumns(db, 'courses')).toEqual(
      expect.arrayContaining([
        'id',
        'title',
        'description',
        'owner_user_id',
        'term',
        'visibility',
        'thumbnail',
        'created_at',
        'updated_at',
      ]),
    );

    expect(tableColumns(db, 'course_enrollments')).toEqual(
      expect.arrayContaining(['course_id', 'student_id', 'class_id', 'enrolled_at']),
    );
  });

  it('学案首页 blocks 支持 block_type + 半结构化 content_json', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const db = new Database(':memory:');
    dbs.push(db);
    runMigrations(db, all);

    db.prepare(
      'INSERT INTO lesson_activity_blocks (id, lesson_id, block_type, order_index, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('b1', 'l1', 'learning_goals', 0, '{"goals": ["目标1", "目标2"]}', 1000, 1000);

    const row = db.prepare('SELECT * FROM lesson_activity_blocks WHERE id = ?').get('b1') as {
      block_type: string;
      content_json: string;
    };
    expect(row.block_type).toBe('learning_goals');
    expect(JSON.parse(row.content_json)).toEqual({ goals: ['目标1', '目标2'] });
  });
});
