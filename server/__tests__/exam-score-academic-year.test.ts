/**
 * 回归测试 —— 考试成绩的学年可见性（Issue #219）。
 *
 * 背景：`exam_scores` 的写入语句此前不带 `academic_year` 列，新录入的成绩该列恒为 NULL；
 * 而学期总评查询在指定学年时会同时过滤 `e.academic_year = ? AND es.academic_year = ?`，
 * 于是这批成绩被整段过滤掉 —— 分子少、分母不减，总评被系统性拉低。
 *
 * 另外 `exams` 表在「测评同步到作业」路径下创建时不带 `academic_year`，
 * 启动期的年份继承回填因此也救不回来。
 *
 * 这里覆盖修复后的行为：
 *   1. 批量录分写入的 exam_scores.academic_year 与父考试一致
 *   2. 父考试没有学年时按录入时间推导（不再写 NULL）
 *   3. 按学年查看学期总评时，考试分进入分子（不丢分）
 *   4. 存量 academic_year 为 NULL 的历史成绩仍然可见
 *   5. 分母与分子同口径：查看的学年没有考试时，不判「缺考 0 分」
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GradingService } from '../services/grading-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

const db = kernelContainer.db;

describe('考试成绩 — 学年落库与学期总评可见性（#219）', () => {
  const service = new GradingService();
  const classId = 'cls-exam-year';
  const studentId = 'stu-exam-year';
  const examId = 'exam-exam-year';
  const examNoYearId = 'exam-exam-year-noyear';
  const otherYearExamId = 'exam-exam-year-other';
  const academicYear = '2025-2026';

  const insertStudent = () => {
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      studentId,
      'exam-year-1',
      '学年成绩学生',
      'examyear@test',
      Date.now(),
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      studentId,
      Date.now(),
    );
  };

  const insertExam = (id: string, year: string | null, maxScore = 100) => {
    db.prepare(
      'INSERT OR REPLACE INTO exams (id, class_id, title, description, max_score, created_at, academic_year) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, classId, `考试 ${id}`, '', maxScore, Date.now(), year);
  };

  const cleanup = () => {
    db.prepare('DELETE FROM exam_scores WHERE exam_id IN (?, ?, ?)').run(examId, examNoYearId, otherYearExamId);
    db.prepare('DELETE FROM exams WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM student_semester_reports WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
  };

  beforeAll(() => {
    cleanup();
    insertStudent();
    insertExam(examId, academicYear);
    insertExam(examNoYearId, null);
    insertExam(otherYearExamId, '2024-2025');
  });

  afterAll(() => {
    cleanup();
  });

  it('批量录分写入的 exam_scores.academic_year 与父考试一致', () => {
    service.batchSaveExamScores(examId, [{ studentId, score: 90 }]);
    const row = db.prepare('SELECT academic_year FROM exam_scores WHERE exam_id = ? AND student_id = ?').get(examId, studentId) as {
      academic_year: string | null;
    };
    expect(row.academic_year).toBe(academicYear);
  });

  it('父考试没有学年时按录入时间推导，不再写 NULL', () => {
    service.batchSaveExamScores(examNoYearId, [{ studentId, score: 70 }]);
    const row = db
      .prepare('SELECT academic_year FROM exam_scores WHERE exam_id = ? AND student_id = ?')
      .get(examNoYearId, studentId) as { academic_year: string | null };
    expect(row.academic_year).not.toBeNull();
    expect(row.academic_year).toMatch(/^\d{4}-\d{4}$/);
  });

  it('按学年查看学期总评时，考试分进入分子（修复前会被整段过滤掉）', () => {
    const result = service.computeSemesterGrades(classId, '学年成绩测试学期', academicYear);
    const student = result.students.find((s) => s.studentId === studentId);
    expect(student).toBeDefined();
    // examId 的 90 分必须计入（max_score=100 → 归一化 90）
    expect(student!.examScore).toBe(90);
  });

  it('存量 academic_year 为 NULL 的历史成绩仍然可见', () => {
    // 模拟旧写入路径：把该行成绩的学年抹成 NULL（历史库就是这样）
    db.prepare('UPDATE exam_scores SET academic_year = NULL WHERE exam_id = ? AND student_id = ?').run(
      examId,
      studentId,
    );
    try {
      const result = service.computeSemesterGrades(classId, '学年成绩测试学期', academicYear);
      const student = result.students.find((s) => s.studentId === studentId);
      // 学年的权威口径是父考试（e.academic_year = '2025-2026'），冗余列 es.academic_year
      // 为 NULL 的历史行仍应计入 —— 修复前这里是 0 分（整段成绩被过滤掉）。
      expect(student!.examScore).toBe(90);
    } finally {
      db.prepare('UPDATE exam_scores SET academic_year = ? WHERE exam_id = ? AND student_id = ?').run(
        academicYear,
        examId,
        studentId,
      );
    }
  });

  it('分母与分子同口径：查看的学年没有考试时不判「缺考 0 分」', () => {
    // otherYearExamId 属于 2024-2025，不属于 2025-2026
    const result = service.computeSemesterGrades(classId, '学年成绩测试学期', '2030-2031');
    const student = result.students.find((s) => s.studentId === studentId);
    // 该学年没有任何考试 → 考试分项不适用（100），而不是被别的学年拉成 0
    expect(student!.examScore).toBe(100);
  });
});
