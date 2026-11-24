/**
 * P0-1：同一成绩被多条 assignment 重复计分的去重。
 *
 * 覆盖成绩项键解析、学期作业分去重（学案重复壳 / 同课节同课件重复壳 /
 * 跨课节同课件不去重 / 普通作业各自独立）与缺失成绩按 0 计入。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { GradingService } from '../services/grading-service.js';
import { resolveGradeItemKey } from '../services/grade-item-key.js';

function rid(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

describe('resolveGradeItemKey', () => {
  it('学案活动按 activityId 合并，忽略重复壳的 assignment id', () => {
    const a = resolveGradeItemKey({
      id: 'xuean-activity:act1',
      classId: 'c1',
      lessonId: 'l1',
      content: JSON.stringify({ adapter: 'xuean-adapter', activityId: 'act1' }),
    });
    const b = resolveGradeItemKey({
      id: 'legacy-dup-shell',
      classId: 'c1',
      lessonId: 'l1',
      content: JSON.stringify({ adapter: 'xuean-adapter', activityId: 'act1' }),
    });
    expect(a).toBe(b);
  });

  it('同一课节的同一课件合并，跨课节不合并', () => {
    const content = JSON.stringify({ type: 'interactive_courseware', coursewareUuid: 'cw-1' });
    const sameLesson = resolveGradeItemKey({ id: 'a', classId: 'c1', lessonId: 'l1', content });
    const dupSameLesson = resolveGradeItemKey({ id: 'b', classId: 'c1', lessonId: 'l1', content });
    const otherLesson = resolveGradeItemKey({ id: 'c', classId: 'c1', lessonId: 'l2', content });
    expect(sameLesson).toBe(dupSameLesson);
    expect(otherLesson).not.toBe(sameLesson);
  });

  it('普通作业无稳定标识时按 assignment id 各自独立', () => {
    const a = resolveGradeItemKey({ id: 'ast-1', classId: 'c1', lessonId: 'l1', content: null });
    const b = resolveGradeItemKey({ id: 'ast-2', classId: 'c1', lessonId: 'l1', content: '题目正文' });
    expect(a).not.toBe(b);
    expect(a).toBe('assignment:ast-1');
  });
});

describe('学期作业分按成绩项去重 (P0-1)', () => {
  const db = kernelContainer.db;
  const classId = rid('cls');
  const studentId = rid('stu');
  const lessonA = rid('les');
  const lessonB = rid('les');
  const academicYear = '2025-2026';
  const semester = '2025 秋';

  beforeAll(() => {
    const now = Date.now();
    db.prepare('INSERT OR REPLACE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
      classId,
      '去重测试班',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)').run(
      studentId,
      `NO_${studentId.slice(-6)}`,
      '去重测试学生',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      studentId,
      now,
    );

    const insertAssignment = db.prepare(
      `INSERT INTO assignments (id, class_id, lesson_id, title, content, created_at, academic_year)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertSubmission = db.prepare(
      `INSERT INTO assignment_submissions
         (assignment_id, student_id, score, submitted_at, graded_at, status, source, academic_year)
       VALUES (?, ?, ?, ?, ?, 'graded', 'manual', ?)`,
    );

    const add = (id: string, lessonId: string, content: string, submission?: { score: number; gradedAt: number }) => {
      insertAssignment.run(id, classId, lessonId, id, content, now, academicYear);
      if (submission) {
        insertSubmission.run(id, studentId, submission.score, submission.gradedAt, submission.gradedAt, academicYear);
      }
    };

    // 学案活动 act1：两次补壳，旧壳 80、新壳 90 → 只算最新 90。
    add('xuean-activity:act1', lessonA, JSON.stringify({ adapter: 'xuean-adapter', activityId: 'act1' }), {
      score: 80,
      gradedAt: now - 1000,
    });
    add('legacy-dup-shell', lessonA, JSON.stringify({ adapter: 'xuean-adapter', activityId: 'act1' }), {
      score: 90,
      gradedAt: now,
    });

    // 同一课节的同一课件：60 / 70 → 只算最新 70。
    const cwContent = JSON.stringify({ type: 'interactive_courseware', coursewareUuid: 'cw-1' });
    add('ast-cw-1', lessonA, cwContent, { score: 60, gradedAt: now - 1000 });
    add('ast-cw-2', lessonA, cwContent, { score: 70, gradedAt: now });

    // 同一课件换到另一个课节：是独立课堂作业，50 照常计入。
    add('ast-cw-other-lesson', lessonB, cwContent, { score: 50, gradedAt: now });

    // 普通作业：各自独立；其中一条未出分，按 0 计入分母。
    add('ast-plain-1', lessonA, '', { score: 100, gradedAt: now });
    add('ast-plain-2', lessonA, '');
  });

  afterAll(() => {
    db.prepare(
      `DELETE FROM assignment_submissions WHERE assignment_id IN (
         SELECT id FROM assignments WHERE class_id = ?
       )`,
    ).run(classId);
    db.prepare('DELETE FROM assignments WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
  });

  it('同一成绩项的多条 assignment 只计一次，分母也按去重后的项数', () => {
    const result = new GradingService(db).computeSemesterGrades(classId, semester, academicYear);
    const row = result.students.find((s) => s.studentId === studentId);
    expect(row).toBeDefined();

    // 去重后共 5 个成绩项：act1(90)、课节A课件(70)、课节B课件(50)、普通作业1(100)、普通作业2(0)。
    // (90 + 70 + 50 + 100 + 0) / 5 = 62
    expect(row!.assignmentScore).toBe(62);
  });

  it('学年过滤后去重结果保持一致', () => {
    const result = new GradingService(db).computeSemesterGrades(classId, semester, '2030-2031');
    const row = result.students.find((s) => s.studentId === studentId);
    // 该学年没有任何作业 → 作业分按无作业处理 100，不串入 2025-2026 的成绩。
    expect(row!.assignmentScore).toBe(100);
  });
});
