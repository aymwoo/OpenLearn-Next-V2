/**
 * P1 回归：学生自报进度不得直接计入成绩。
 *
 * - 学生写入 → verified = 0，且不产生 verified_progress_percent；
 * - 教师确认（同一接口）→ verified = 1，记录 verified_progress_percent；
 * - 学生后续修改展示进度不得覆盖已验证值；
 * - 没有已验证进度（无论有自报记录还是完全无记录）→ 进度分 null，不参与总评。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { GradingService } from '../services/grading-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('学生进度验证与成绩口径', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const teacherId = 'usr-verify-p1-teacher';
  const classId = 'cls-verify-p1';
  const studentId = 'stu-verify-p1';
  const untouchedStudentId = 'stu-verify-p1-untouched';
  const lessonId = 'les-verify-p1';
  const scheduleId = 'sch-verify-p1';
  const semester = 'P1 验证学期';

  const tokTeacher = 'tok-verify-p1-teacher';
  const tokStudent = 'tok-verify-p1-student';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const postProgress = (token: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/students/${studentId}/progress`, {
      method: 'POST',
      headers: { ...cookie(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const readProgress = () =>
    db
      .prepare(
        'SELECT completed, progress_percent, verified, verified_progress_percent FROM student_lesson_progress WHERE student_id = ? AND lesson_id = ?',
      )
      .get(studentId, lessonId) as any;

  const gradeOf = (id: string) => {
    const result = new GradingService(db).computeSemesterGrades(classId, semester);
    return result.students.find((s) => s.studentId === id)!;
  };

  beforeAll(async () => {
    const now = Date.now();
    const exp = now + 3600_000;
    const today = new Date().toISOString().split('T')[0];

    db.prepare('DELETE FROM student_semester_reports WHERE class_id = ? AND semester_name = ?').run(classId, semester);
    db.prepare('DELETE FROM student_lesson_progress WHERE student_id IN (?, ?)').run(studentId, untouchedStudentId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentId, untouchedStudentId);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      tokTeacher,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'verify_p1' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudent,
      JSON.stringify({ userId: studentId, studentId, role: 'student', username: 'verify_p1_s' }),
      now,
      exp,
    );

    db.prepare('INSERT INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      classId,
      '进度验证班',
      '',
      teacherId,
      now,
    );
    db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      studentId,
      'VERIFY-P1-A',
      '自报学生',
      '',
      now,
    );
    db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      untouchedStudentId,
      'VERIFY-P1-B',
      '无进度学生',
      '',
      now,
    );
    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      studentId,
      now,
    );
    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      untouchedStudentId,
      now,
    );
    db.prepare('INSERT INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      lessonId,
      '进度验证课节',
      now,
      now,
    );
    db.prepare(
      'INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(scheduleId, classId, lessonId, today, '09:00-10:00', 'scheduled', '', now);

    const app = express();
    app.use(express.json());
    const noop = (_req: any, _res: any, next: any) => next();
    registerRosterRoutes({ app, io: undefined, loginLimiter: noop } as any);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      db.prepare('DELETE FROM student_semester_reports WHERE class_id = ?').run(classId);
      db.prepare('DELETE FROM student_lesson_progress WHERE student_id IN (?, ?)').run(studentId, untouchedStudentId);
      db.prepare('DELETE FROM segment_visits WHERE lesson_id = ? AND student_id = ?').run(lessonId, studentId);
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
      db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
      db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
      db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentId, untouchedStudentId);
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(tokTeacher, tokStudent);
    } catch {
      // 清理失败不掩盖测试结论
    }
  });

  it('学生自报进度标记为未验证，进度分不参与总评', async () => {
    const res = await postProgress(tokStudent, { lessonId, completed: false, progressPercent: 80 });
    expect(res.status).toBe(200);

    const row = readProgress();
    expect(row.progress_percent).toBe(80);
    expect(row.verified).toBe(0);
    expect(row.verified_progress_percent).toBeNull();

    const grade = gradeOf(studentId);
    // 无已验证进度 → 该分项排除，其余分项满分并按剩余权重归一化
    expect(grade.progressScore).toBeNull();
    expect(grade.totalScore).toBe(100);
  });

  it('教师确认后同一进度变为已验证并计入成绩', async () => {
    const res = await postProgress(tokTeacher, { lessonId, completed: false, progressPercent: 80 });
    expect(res.status).toBe(200);

    const row = readProgress();
    expect(row.verified).toBe(1);
    expect(row.verified_progress_percent).toBe(80);

    const grade = gradeOf(studentId);
    expect(grade.progressScore).toBe(80);
    // 100*0.15 + 80*0.25 + 100*0.35 + 100*0.25 = 95
    expect(grade.totalScore).toBe(95);
  });

  it('学生之后修改展示进度不会覆盖已验证值，也不会改变成绩', async () => {
    const res = await postProgress(tokStudent, { lessonId, completed: false, progressPercent: 20 });
    expect(res.status).toBe(200);

    const row = readProgress();
    expect(row.progress_percent).toBe(20);
    expect(row.verified).toBe(1);
    expect(row.verified_progress_percent).toBe(80);

    const grade = gradeOf(studentId);
    expect(grade.progressScore).toBe(80);
    expect(grade.totalScore).toBe(95);
  });

  it('环节完成度从 segment_visits 派生，未离开的环节不计入', async () => {
    const now = Date.now();
    db.prepare('DELETE FROM segment_visits WHERE lesson_id = ? AND student_id = ?').run(lessonId, studentId);
    const insertVisit = db.prepare(
      'INSERT INTO segment_visits (id, lesson_id, segment_id, student_id, entered_at, left_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertVisit.run('sv-p1-a', lessonId, 'seg-a', studentId, now, now);
    insertVisit.run('sv-p1-b', lessonId, 'seg-b', studentId, now, null);

    const res = await fetch(`${baseUrl}/api/students/${studentId}/progress`, { headers: cookie(tokTeacher) });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const row = body.find((p: any) => p.lesson_id === lessonId);
    expect(row).toBeTruthy();
    const segments = JSON.parse(row.completed_segments || '[]');
    expect(segments).toContain('seg-a');
    expect(segments).not.toContain('seg-b');
  });

  it('完全没有进度记录的学生同样排除该分项，总分不因此被扣减', () => {
    const grade = gradeOf(untouchedStudentId);
    expect(grade.progressScore).toBeNull();
    expect(grade.totalScore).toBe(100);
  });
});
