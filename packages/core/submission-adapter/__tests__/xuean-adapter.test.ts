import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createXueanSubmissionAdapter, XUEAN_SUBMISSION_ADAPTER_ID } from '../xuean-adapter.js';

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
  `);
  db.prepare(`INSERT INTO lesson_activities (id, lesson_id, order_index, type, title) VALUES (?, ?, 0, ?, ?)`).run(
    'act-1',
    'les-1',
    'submission',
    '作品一',
  );
  db.prepare(
    `INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, score, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('act-1', 'stu-1', 'submitted', 100, 88, 1700000000);
  return db;
}

describe('createXueanSubmissionAdapter', () => {
  it('从 activity_progress 投影 NormalizedSubmission', () => {
    const db = seedDb();
    const adapter = createXueanSubmissionAdapter(db);
    expect(adapter.descriptor.id).toBe(XUEAN_SUBMISSION_ADAPTER_ID);
    expect(adapter.descriptor.modeIds).toEqual(['xuean']);
    const rows = adapter.listSubmissions({ lessonId: 'les-1' }) as Array<{
      id: string;
      studentId: string;
      score: number | null;
      status: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].studentId).toBe('stu-1');
    expect(rows[0].score).toBe(88);
    expect(rows[0].status).toBe('submitted');
    expect(rows[0].id).toContain('act-1:stu-1');
    db.close();
  });

  it('表缺失时返回空数组而不抛错', () => {
    const db = new Database(':memory:');
    const adapter = createXueanSubmissionAdapter(db);
    expect(adapter.listSubmissions({ lessonId: 'les-1' })).toEqual([]);
    db.close();
  });
});
