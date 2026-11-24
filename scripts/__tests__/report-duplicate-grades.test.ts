import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDuplicateGradeReport } from '../report-duplicate-grades.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assignments (
      id TEXT PRIMARY KEY, class_id TEXT, lesson_id TEXT, title TEXT,
      content TEXT, created_at INTEGER, academic_year TEXT
    );
    CREATE TABLE assignment_submissions (
      assignment_id TEXT NOT NULL, student_id TEXT NOT NULL, score REAL,
      graded_at INTEGER, submitted_at INTEGER,
      PRIMARY KEY (assignment_id, student_id)
    );
  `);
  const insertAsg = db.prepare(
    'INSERT INTO assignments (id, class_id, lesson_id, title, content, created_at, academic_year) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  // 同班同课节同课件的重复壳
  insertAsg.run('asg-a1', 'cls-a', 'les-1', '互动课件: 甲', '{"coursewareUuid":"cw-x"}', 1, '2025-2026');
  insertAsg.run('asg-a2', 'cls-a', 'les-1', '互动课件: 甲（新）', '{"coursewareUuid":"cw-x"}', 2, '2025-2026');
  // 外班同课件：成绩项键带班级，不能被合并
  insertAsg.run('asg-b1', 'cls-b', 'les-1', '互动课件: 甲', '{"coursewareUuid":"cw-x"}', 1, '2025-2026');
  // 学案活动重复补壳
  insertAsg.run(
    'asg-x1',
    'cls-a',
    'les-1',
    '活动一',
    '{"adapter":"xuean-adapter","activityId":"act-1"}',
    1,
    '2025-2026',
  );
  insertAsg.run(
    'asg-x2',
    'cls-a',
    'les-1',
    '活动一（重复）',
    '{"adapter":"xuean-adapter","activityId":"act-1"}',
    2,
    '2025-2026',
  );
  // 无稳定标识的普通作业：不参与合并
  insertAsg.run('asg-single', 'cls-a', 'les-1', '普通作业', '{}', 1, '2025-2026');

  const insertSub = db.prepare(
    'INSERT INTO assignment_submissions (assignment_id, student_id, score, graded_at, submitted_at) VALUES (?, ?, ?, ?, ?)',
  );
  insertSub.run('asg-a1', 'stu-1', 70, 100, 100);
  insertSub.run('asg-a2', 'stu-1', 90, 200, 200);
  insertSub.run('asg-a2', 'stu-2', 80, 200, 200);
  insertSub.run('asg-single', 'stu-1', 60, 100, 100);
  return db;
}

describe('report-duplicate-grades', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => db.close());

  it('按「班级 + 成绩项键」分组重复作业壳并列出会被忽略的提交', () => {
    const report = buildDuplicateGradeReport(db);

    expect(report.totals).toEqual({
      groups: 2,
      redundantAssignments: 2,
      affectedStudents: 1,
      redundantSubmissions: 1,
      scoreConflicts: 1,
    });

    const courseware = report.groups.find((g) => g.kind === 'courseware');
    expect(courseware?.key).toBe('courseware:cls-a:les-1:cw-x');
    expect(courseware?.assignments.map((a) => a.id)).toEqual(['asg-a1', 'asg-a2']);
    // 只有 stu-1 在重复壳下各有一条提交；stu-2 只有一条提交，不算受影响
    expect(courseware?.students).toHaveLength(1);
    expect(courseware?.students[0]).toEqual({
      studentId: 'stu-1',
      kept: { assignmentId: 'asg-a2', score: 90, at: 200 },
      ignored: [{ assignmentId: 'asg-a1', score: 70, at: 100, sameScore: false }],
    });

    // 学案重复补壳：仅作业壳重复，没有重复提交
    const xuean = report.groups.find((g) => g.kind === 'xuean');
    expect(xuean?.key).toBe('xuean:cls-a:act-1');
    expect(xuean?.students).toEqual([]);

    // 外班同课件与普通作业都不会被当成重复组
    expect(report.groups.some((g) => g.key === 'courseware:cls-b:les-1:cw-x')).toBe(false);
    expect(report.groups.some((g) => g.key === 'assignment:asg-single')).toBe(false);
  });

  it('没有重复壳时返回空报告', () => {
    db.prepare("DELETE FROM assignments WHERE id IN ('asg-a2','asg-x2','asg-b1')").run();
    const report = buildDuplicateGradeReport(db);
    expect(report.groups).toEqual([]);
    expect(report.totals.groups).toBe(0);
  });
});
