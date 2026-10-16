import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { AcademicYearComparisonService } from '../academic-comparison-service.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE class_students (
      class_id TEXT,
      student_id TEXT,
      PRIMARY KEY (class_id, student_id)
    );
    CREATE TABLE classes (
      id TEXT PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE lessons (
      id TEXT PRIMARY KEY,
      title TEXT
    );
    CREATE TABLE schedules (
      id TEXT PRIMARY KEY,
      class_id TEXT,
      lesson_id TEXT,
      academic_year TEXT
    );
    CREATE TABLE assignments (
      id TEXT PRIMARY KEY,
      class_id TEXT,
      lesson_id TEXT,
      title TEXT,
      academic_year TEXT
    );
    CREATE TABLE assignment_submissions (
      assignment_id TEXT,
      student_id TEXT,
      status TEXT,
      score REAL,
      submitted_at TEXT,
      academic_year TEXT,
      PRIMARY KEY (assignment_id, student_id)
    );
    CREATE TABLE student_lesson_progress (
      lesson_id TEXT,
      student_id TEXT,
      progress_percent REAL,
      completed INTEGER,
      academic_year TEXT,
      PRIMARY KEY (lesson_id, student_id)
    );

  `);
  return db;
}

describe('AcademicYearComparisonService 跨学年指标计算与对比', () => {
  it('应准确计算各学年作业提交率、均分与课程数', async () => {
    const db = createTestDb();
    const service = new AcademicYearComparisonService(db);

    // 学生加入班级
    db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run('c1', 's1');
    db.prepare('INSERT INTO lessons (id, title) VALUES (?, ?)').run('les_math', '高等数学');
    db.prepare('INSERT INTO lessons (id, title) VALUES (?, ?)').run('les_cs', '计算机程序设计');

    // 2024-2025 学年布置 2 次作业，提交 2 次，均分 85
    db.prepare('INSERT INTO assignments (id, class_id, lesson_id, title, academic_year) VALUES (?, ?, ?, ?, ?)').run(
      'a1',
      'c1',
      'les_math',
      '微积分作业1',
      '2024-2025',
    );
    db.prepare('INSERT INTO assignments (id, class_id, lesson_id, title, academic_year) VALUES (?, ?, ?, ?, ?)').run(
      'a2',
      'c1',
      'les_math',
      '微积分作业2',
      '2024-2025',
    );
    db.prepare(
      'INSERT INTO assignment_submissions (assignment_id, student_id, status, score, submitted_at, academic_year) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('a1', 's1', 'graded', 80, '2024-10-10', '2024-2025');
    db.prepare(
      'INSERT INTO assignment_submissions (assignment_id, student_id, status, score, submitted_at, academic_year) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('a2', 's1', 'graded', 90, '2024-10-20', '2024-2025');

    // 2025-2026 学年布置 2 次作业，提交 1 次，均分 95
    db.prepare('INSERT INTO assignments (id, class_id, lesson_id, title, academic_year) VALUES (?, ?, ?, ?, ?)').run(
      'a3',
      'c1',
      'les_cs',
      'Python编程1',
      '2025-2026',
    );
    db.prepare('INSERT INTO assignments (id, class_id, lesson_id, title, academic_year) VALUES (?, ?, ?, ?, ?)').run(
      'a4',
      'c1',
      'les_cs',
      'Python编程2',
      '2025-2026',
    );
    db.prepare(
      'INSERT INTO assignment_submissions (assignment_id, student_id, status, score, submitted_at, academic_year) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('a3', 's1', 'graded', 95, '2025-10-10', '2025-2026');

    // 课程进度
    db.prepare(
      'INSERT INTO student_lesson_progress (lesson_id, student_id, progress_percent, completed, academic_year) VALUES (?, ?, ?, ?, ?)',
    ).run('les_math', 's1', 100, 1, '2024-2025');
    db.prepare(
      'INSERT INTO student_lesson_progress (lesson_id, student_id, progress_percent, completed, academic_year) VALUES (?, ?, ?, ?, ?)',
    ).run('les_cs', 's1', 50, 0, '2025-2026');


    const result = await service.getAcademicYearComparison('s1', ['2024-2025', '2025-2026']);

    expect(result.metricsByYear).toHaveLength(2);

    const m2024 = result.metricsByYear[0];
    expect(m2024.academicYear).toBe('2024-2025');
    expect(m2024.hasData).toBe(true);
    expect(m2024.totalAssignments).toBe(2);
    expect(m2024.submittedAssignments).toBe(2);
    expect(m2024.submissionRate).toBe(100);
    expect(m2024.averageScore).toBe(85);
    expect(m2024.enrolledCoursesCount).toBe(1);
    expect(m2024.completedCoursesCount).toBe(1);

    const m2025 = result.metricsByYear[1];
    expect(m2025.academicYear).toBe('2025-2026');
    expect(m2025.hasData).toBe(true);
    expect(m2025.totalAssignments).toBe(2);
    expect(m2025.submittedAssignments).toBe(1);
    expect(m2025.submissionRate).toBe(50);
    expect(m2025.averageScore).toBe(95);
    expect(m2025.completedCoursesCount).toBe(0);

    // 验证 Delta
    expect(result.deltas).toHaveLength(1);
    const d = result.deltas[0];
    expect(d.fromYear).toBe('2024-2025');
    expect(d.toYear).toBe('2025-2026');
    // 提交率从 100% 降到 50%
    expect(d.submissionRateDelta.diff).toBe(-50);
    expect(d.submissionRateDelta.direction).toBe('down');
    // 平均分从 85 上升到 95
    expect(d.averageScoreDelta.diff).toBe(10);
    expect(d.averageScoreDelta.direction).toBe('up');
  });

  it('针对没有历史数据的学年给出明确 hasData: false 标记与零值指标', async () => {
    const db = createTestDb();
    const service = new AcademicYearComparisonService(db);

    const m = await service.getMetricsForYear('s_empty', '2023-2024');
    expect(m.hasData).toBe(false);
    expect(m.totalAssignments).toBe(0);
    expect(m.submittedAssignments).toBe(0);
    expect(m.submissionRate).toBe(0);
    expect(m.averageScore).toBe(0);
    expect(m.enrolledCoursesCount).toBe(0);
  });

  it('支持第三方插件扩展自定义对比指标', async () => {
    const db = createTestDb();
    const service = new AcademicYearComparisonService(db);

    const unregister = service.registerCustomMetricProvider((ctx) => {
      return {
        learningEngagementScore: ctx.academicYear === '2024-2025' ? 92 : 88,
      };
    });

    const m = await service.getMetricsForYear('s1', '2024-2025');
    expect(m.customMetrics).toEqual({ learningEngagementScore: 92 });

    // 测试注销
    unregister();
    const mAfter = await service.getMetricsForYear('s1', '2024-2025');
    expect(mAfter.customMetrics).toBeUndefined();
  });
});
