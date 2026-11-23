import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { GradingService } from '../services/grading-service.js';

/**
 * P0-2 回归：学期作业分必须以「本学年已发布作业数」为分母，未交/未出分按 0 计入；
 * 其他学年的作业不得参与本学年的分母。
 */
describe('学期作业分：学年分母与未交 0 分', () => {
  const classId = 'cls-denom-p02';
  const studentId = 'stu-denom-p02';
  const teacherId = 'usr-denom-p02';
  const academicYear = '2025-2026';
  const otherYear = '2024-2025';

  beforeAll(() => {
    const db = kernelContainer.db;
    const now = Date.now();

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'denom_teacher', 'placeholder', 'teacher', '分母测试教师', now);
    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classId,
      '分母测试班',
      teacherId,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)').run(
      studentId,
      'NUM_DENOM',
      'Denom Student',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      studentId,
      now,
    );

    const insertAssignment = db.prepare(
      'INSERT OR REPLACE INTO assignments (id, class_id, title, created_at, academic_year) VALUES (?, ?, ?, ?, ?)',
    );
    insertAssignment.run('asg-denom-1', classId, '本学年作业 1', now, academicYear);
    insertAssignment.run('asg-denom-2', classId, '本学年作业 2（未交）', now, academicYear);
    insertAssignment.run('asg-denom-3', classId, '其他学年作业', now, otherYear);

    const insertSubmission = db.prepare(
      `INSERT OR REPLACE INTO assignment_submissions
        (assignment_id, student_id, score, status, submitted_at, graded_at, source, academic_year)
       VALUES (?, ?, ?, 'graded', ?, ?, 'manual', ?)`,
    );
    // 故意把冗余列 academic_year 留空，验证父作业学年仍是权威口径。
    insertSubmission.run('asg-denom-1', studentId, 90, now, now, null);
    insertSubmission.run('asg-denom-3', studentId, 100, now, now, otherYear);
  });

  afterAll(() => {
    const db = kernelContainer.db;
    db.prepare('DELETE FROM assignment_submissions WHERE student_id = ?').run(studentId);
    db.prepare('DELETE FROM assignments WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
  });

  it('本学年 2 个作业、仅 1 个得 90 ⇒ 作业分 45，而不是 90', () => {
    const grading = new GradingService(kernelContainer.db);
    const row = grading
      .computeSemesterGrades(classId, '2025 秋', academicYear)
      .students.find((s) => s.studentId === studentId);
    expect(row).toBeDefined();
    expect(row!.assignmentScore).toBe(45);
  });

  it('其他学年只有 1 个作业且得 100 ⇒ 作业分 100，本学年成绩不串入', () => {
    const grading = new GradingService(kernelContainer.db);
    const row = grading
      .computeSemesterGrades(classId, '2025 秋', otherYear)
      .students.find((s) => s.studentId === studentId);
    expect(row).toBeDefined();
    expect(row!.assignmentScore).toBe(100);
  });
});
