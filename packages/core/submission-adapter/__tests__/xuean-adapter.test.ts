import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createXueanSubmissionAdapter, XUEAN_SUBMISSION_ADAPTER_ID } from '../xuean-adapter.js';
import type { NormalizedSubmission } from '../types.js';

function seedDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE lesson_activities (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      config_json TEXT,
      required INTEGER NOT NULL DEFAULT 1,
      visible INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE activity_progress (
      activity_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      status TEXT NOT NULL,
      progress_percent INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      score REAL,
      last_activity_at INTEGER,
      submission_json TEXT,
      PRIMARY KEY (activity_id, student_id)
    );
    CREATE TABLE classroom_sessions (
      lesson_id TEXT NOT NULL,
      class_id TEXT,
      stage TEXT
    );
    CREATE TABLE schedules (
      lesson_id TEXT NOT NULL,
      class_id TEXT
    );
    CREATE TABLE assignments (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      lesson_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      content TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  db.prepare(`INSERT INTO lesson_activities (id, lesson_id, order_index, type, title) VALUES (?, ?, 0, ?, ?)`).run(
    'act-1',
    'les-1',
    'submission',
    '作品一',
  );
  db.prepare(`INSERT INTO classroom_sessions (lesson_id, class_id, stage) VALUES (?, ?, ?)`).run(
    'les-1',
    'cls-1',
    'IN_CLASS_TEACHING',
  );
  db.prepare(
    `INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, score, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('act-1', 'stu-1', 'submitted', 100, 88, 1700000000);
  db.prepare(
    `INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, score, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('act-1', 'stu-2', 'submitted', 60, null, 1700000001);
  return db;
}

describe('createXueanSubmissionAdapter', () => {
  it('从 activity_progress 投影 NormalizedSubmission', () => {
    const db = seedDb();
    const adapter = createXueanSubmissionAdapter(db);
    expect(adapter.descriptor.id).toBe(XUEAN_SUBMISSION_ADAPTER_ID);
    expect(adapter.descriptor.modeIds).toEqual(['xuean']);
    const rows = adapter.listSubmissions({ lessonId: 'les-1', studentId: 'stu-1' }) as Array<{
      id: string;
      classId: string;
      studentId: string;
      score: number | null;
      status: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].studentId).toBe('stu-1');
    expect(rows[0].classId).toBe('cls-1');
    expect(rows[0].score).toBe(88);
    expect(rows[0].status).toBe('submitted');
    expect(rows[0].id).toContain('act-1:stu-1');
    db.close();
  });

  it('按班级查询时从课节反查班级，并能按 classId 过滤', () => {
    const db = seedDb();
    const adapter = createXueanSubmissionAdapter(db);
    const byClass = adapter.listSubmissions({ classId: 'cls-1' }) as Array<{ classId: string }>;
    expect(byClass).toHaveLength(2);
    expect(byClass.every((row) => row.classId === 'cls-1')).toBe(true);
    // 用 A 班授权查 B 班：即使带了课节 id 也必须为空
    expect(adapter.listSubmissions({ lessonId: 'les-1', classId: 'cls-2' })).toEqual([]);
    db.close();
  });

  it('未出分的提交也能映射为成绩写入，并补建 assignment 壳行、回写进度', () => {
    const db = seedDb();
    const adapter = createXueanSubmissionAdapter(db);
    const subs = adapter.listSubmissions({ lessonId: 'les-1', studentId: 'stu-2' }) as NormalizedSubmission[];
    const sub = subs[0]!;
    expect(sub.score).toBeNull();
    const mapped = adapter.toGradeInput!(sub);
    expect(mapped).toMatchObject({ assignmentId: 'xuean-activity:act-1', studentId: 'stu-2' });
    expect(db.prepare('SELECT id FROM assignments WHERE id = ?').get('xuean-activity:act-1')).toBeTruthy();

    adapter.afterGrade!(sub, { score: 92, status: 'graded' });
    const row = db
      .prepare('SELECT score, status FROM activity_progress WHERE activity_id = ? AND student_id = ?')
      .get('act-1', 'stu-2') as { score: number | null; status: string };
    expect(row.score).toBe(92);
    expect(row.status).toBe('graded');
    db.close();
  });

  it('表缺失时返回空数组而不抛错', () => {
    const db = new Database(':memory:');
    const adapter = createXueanSubmissionAdapter(db);
    expect(adapter.listSubmissions({ lessonId: 'les-1' })).toEqual([]);
    db.close();
  });
});
