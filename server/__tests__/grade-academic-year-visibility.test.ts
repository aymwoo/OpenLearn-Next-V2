/**
 * 成绩链路集成回归：课件成绩必须带对学年、用稳定的课件标识关联作业，
 * 并且每一次录入/补录都在服务端留下可诊断的结构化日志。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { CoursewareService } from '../services/courseware-service.js';
import { GradingService } from '../services/grading-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

const db = kernelContainer.db;

describe('课件成绩 — 学年可见性、稳定关联与可观测性', () => {
  const teacherId = 'usr-grade-year-teacher';
  const classId = 'cls-grade-year';
  const studentId = 'stu-grade-year';
  const lessonId = 'les-grade-year';
  const scheduleId = 'sch-grade-year';
  const coursewareId = 'cw-grade-year-row';
  const coursewareUuid = 'cw-grade-year-uuid';
  const semester = '学年可见性集成测试学期';
  const academicYear = '2025-2026';
  let firstAssignmentId = '';

  const insertAttempt = (id: string, score: number, finishedAt: number) => {
    db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, coursewareId, studentId, finishedAt - 1000, finishedAt, 'finished');
    db.prepare('INSERT INTO submission_result (id, attempt_id, score, completion) VALUES (?, ?, ?, ?)').run(
      `sr-${id}`,
      id,
      score,
      1,
    );
  };

  const assignmentIdOf = (attemptId: string) => {
    const row = db
      .prepare(
        `SELECT s.assignment_id FROM assignment_submissions s
         JOIN assignments a ON a.id = s.assignment_id
         WHERE a.class_id = ? AND a.lesson_id = ? AND s.student_id = ?`,
      )
      .get(classId, lessonId, studentId) as { assignment_id: string } | undefined;
    return row?.assignment_id;
  };

  const cleanup = () => {
    try {
      db.prepare('DELETE FROM student_semester_reports WHERE class_id = ?').run(classId);
      db.prepare('DELETE FROM student_lesson_progress WHERE student_id = ?').run(studentId);
      db.prepare(
        'DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)',
      ).run(classId);
      db.prepare('DELETE FROM assignments WHERE class_id = ?').run(classId);
      db.prepare('DELETE FROM submission_result WHERE attempt_id LIKE ?').run('att-grade-year-%');
      db.prepare('DELETE FROM courseware_attempt WHERE id LIKE ?').run('att-grade-year-%');
      db.prepare('DELETE FROM courseware WHERE id = ?').run(coursewareId);
      db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
      db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
      db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
      db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
    } catch {
      // 清理失败不掩盖测试结论
    }
  };

  beforeAll(() => {
    cleanup();
    const now = Date.now();
    db.prepare('INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      teacherId,
      'grade_year_teacher',
      'placeholder',
      'teacher',
      '学年测试教师',
      now,
    );
    db.prepare(
      'INSERT INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(classId, '学年可见性班', 'grade year fixture', 'pass-grade-year', teacherId, now);
    db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      studentId,
      'GRADE-YEAR-1',
      '学年测试学生',
      '',
      now,
    );
    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      studentId,
      now,
    );
    db.prepare('INSERT INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      lessonId,
      '学年可见性课节',
      now,
      now,
    );
    db.prepare(
      'INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, created_at, academic_year) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(scheduleId, classId, lessonId, '2026-03-01', now, academicYear);
    db.prepare('INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      coursewareId,
      coursewareUuid,
      '学年测试课件',
      'html',
      'index.html',
      now,
    );

    insertAttempt('att-grade-year-1', 88, now + 1000);
  });

  afterAll(cleanup);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('手动录入按排课学年落库，并只在对应学年的学期成绩里可见', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const service = new CoursewareService(db);

    const result = await service.promoteAttempt('att-grade-year-1', lessonId, classId);
    firstAssignmentId = result.assignmentId;
    expect(result.score).toBe(88);

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(firstAssignmentId) as any;
    expect(assignment.academic_year).toBe(academicYear);
    expect(assignment.content).toContain(`"coursewareUuid":"${coursewareUuid}"`);

    const submission = db
      .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(firstAssignmentId, studentId) as any;
    expect(submission.score).toBe(88);
    expect(submission.academic_year).toBe(academicYear);

    // 学年过滤：同一年能看到作业分，其他学年看不到这条成绩
    const grading = new GradingService(db);
    const currentYear = grading
      .computeSemesterGrades(classId, semester, academicYear)
      .students.find((s) => s.studentId === studentId)!;
    expect(currentYear.assignmentScore).toBe(88);
    const otherYear = grading
      .computeSemesterGrades(classId, semester, '2024-2025')
      .students.find((s) => s.studentId === studentId)!;
    expect(otherYear.assignmentScore).toBe(0);

    // 可观测性：成功录入留下一条可审计的结构化日志
    const log = infoSpy.mock.calls.find(([tag]) => tag === '[courseware.promote] recorded');
    expect(log).toBeDefined();
    expect(JSON.parse(String(log![1]))).toMatchObject({
      attemptId: 'att-grade-year-1',
      studentId,
      lessonId,
      classId,
      assignmentId: firstAssignmentId,
      score: 88,
    });
  });

  it('课件改名后重录仍复用同一作业，不会产生重复作业行', async () => {
    db.prepare('UPDATE courseware SET name = ? WHERE id = ?').run('改名后的课件', coursewareId);
    insertAttempt('att-grade-year-2', 92, Date.now() + 5000);

    const service = new CoursewareService(db);
    const result = await service.promoteAttempt('att-grade-year-2', lessonId, classId);

    expect(result.assignmentId).toBe(firstAssignmentId);
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM assignments WHERE class_id = ? AND lesson_id = ?')
      .get(classId, lessonId) as { c: number };
    expect(count.c).toBe(1);

    const submission = db
      .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(firstAssignmentId, studentId) as any;
    expect(submission.score).toBe(92);
    expect(submission.academic_year).toBe(academicYear);
    expect(assignmentIdOf('att-grade-year-1')).toBe(firstAssignmentId);
  });

  it('批量补录输出可诊断摘要：手工成绩受保护时给出原因分布', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const service = new CoursewareService(db);

    const report = service.autoRecordForLesson(lessonId, classId);
    expect(report.recorded).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.details[0]?.reason).toBe('manual-protected');

    const log = infoSpy.mock.calls.find(([tag]) => tag === '[courseware.auto-record]');
    expect(log).toBeDefined();
    expect(JSON.parse(String(log![1]))).toMatchObject({
      lessonId,
      classId,
      recorded: 0,
      skipped: 1,
      reasons: { 'manual-protected': 1 },
    });
  });
});
