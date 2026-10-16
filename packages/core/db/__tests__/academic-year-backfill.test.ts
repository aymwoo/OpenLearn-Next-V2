import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { backfillAcademicYearData } from '../class-passcode-crypto.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schedules (
      id TEXT PRIMARY KEY,
      scheduled_date TEXT,
      created_at TEXT,
      academic_year TEXT
    );
    CREATE TABLE assignments (
      id TEXT PRIMARY KEY,
      created_at TEXT,
      academic_year TEXT
    );
    CREATE TABLE assignment_submissions (
      assignment_id TEXT,
      student_id TEXT,
      submitted_at TEXT,
      academic_year TEXT,
      PRIMARY KEY (assignment_id, student_id)
    );
    CREATE TABLE attendance (
      schedule_id TEXT,
      student_id TEXT,
      recorded_at TEXT,
      academic_year TEXT,
      PRIMARY KEY (schedule_id, student_id)
    );
    CREATE TABLE exams (
      id TEXT PRIMARY KEY,
      created_at TEXT,
      academic_year TEXT
    );
    CREATE TABLE exam_scores (
      exam_id TEXT,
      student_id TEXT,
      academic_year TEXT,
      PRIMARY KEY (exam_id, student_id)
    );
  `);
  return db;
}

describe('backfillAcademicYearData 学年历史数据平滑回填', () => {
  it('应根据日期正确将 NULL 学年的排课与作业回填至对应学年', () => {
    const db = createTestDb();

    // 2024-09 属于 2024-2025 学年
    db.prepare('INSERT INTO schedules (id, scheduled_date, academic_year) VALUES (?, ?, ?)').run(
      'sch_1',
      '2024-09-10',
      null,
    );
    // 2025-03 属于 2024-2025 学年 (次年春)
    db.prepare('INSERT INTO schedules (id, scheduled_date, academic_year) VALUES (?, ?, ?)').run(
      'sch_2',
      '2025-03-15',
      null,
    );
    // 2025-10 属于 2025-2026 学年
    db.prepare('INSERT INTO assignments (id, created_at, academic_year) VALUES (?, ?, ?)').run(
      'ast_1',
      '2025-10-01 10:00:00',
      null,
    );

    // 提交记录与考勤记录
    db.prepare(
      'INSERT INTO assignment_submissions (assignment_id, student_id, submitted_at, academic_year) VALUES (?, ?, ?, ?)',
    ).run('ast_1', 'stu_1', '2025-10-02', null);
    db.prepare(
      'INSERT INTO attendance (schedule_id, student_id, recorded_at, academic_year) VALUES (?, ?, ?, ?)',
    ).run('sch_1', 'stu_1', '2024-09-10', null);

    const result = backfillAcademicYearData(db);
    expect(result.updated).toBeGreaterThanOrEqual(4);

    const s1 = db.prepare('SELECT academic_year FROM schedules WHERE id = ?').get('sch_1') as { academic_year: string };
    expect(s1.academic_year).toBe('2024-2025');

    const s2 = db.prepare('SELECT academic_year FROM schedules WHERE id = ?').get('sch_2') as { academic_year: string };
    expect(s2.academic_year).toBe('2024-2025');

    const a1 = db.prepare('SELECT academic_year FROM assignments WHERE id = ?').get('ast_1') as { academic_year: string };
    expect(a1.academic_year).toBe('2025-2026');

    const sub = db
      .prepare('SELECT academic_year FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get('ast_1', 'stu_1') as { academic_year: string };
    expect(sub.academic_year).toBe('2025-2026');

    const att = db
      .prepare('SELECT academic_year FROM attendance WHERE schedule_id = ? AND student_id = ?')
      .get('sch_1', 'stu_1') as { academic_year: string };
    expect(att.academic_year).toBe('2024-2025');
  });

  it('已包含 academic_year 的记录不应被重复覆盖，二次执行幂等', () => {
    const db = createTestDb();
    db.prepare('INSERT INTO schedules (id, scheduled_date, academic_year) VALUES (?, ?, ?)').run(
      'sch_custom',
      '2024-09-10',
      '2030-2031',
    );

    const first = backfillAcademicYearData(db);
    expect(first.updated).toBe(0);

    const row = db.prepare('SELECT academic_year FROM schedules WHERE id = ?').get('sch_custom') as { academic_year: string };
    expect(row.academic_year).toBe('2030-2031');
  });

  it('空库或表不存在时不应抛错', () => {
    const emptyDb = new Database(':memory:');
    const result = backfillAcademicYearData(emptyDb);
    expect(result.updated).toBe(0);
  });
});
