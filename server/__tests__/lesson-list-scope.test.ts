/**
 * @vitest-environment node
 *
 * 课节列表的数据范围（回归）。
 *
 * ## 背景
 *
 * `GET /api/lessons` 原先对**任何已登录角色**返回**全平台课程**：
 *
 * - 学生能枚举所有课程的标题与内容（越权）；
 * - 学生端外壳还会把 `lessons[0]` 默认选为当前课节 → 白板轮询去拉**别人课节**
 *   的白板 → 每次进外壳稳定吃一个 403。
 *
 * 现在按角色收窄（见 `server/services/class-access.ts`）：
 * - 管理员：全部；
 * - 教师：**自己教的** —— 自己创建的，或出现在自己所带班级（排课 / 作业 /
 *   课堂会话）里的；外加 `creator_id` 为空的历史课节（与 `authorizeLessonStaff`
 *   的既有约定一致）；
 * - 学生：**自己班的** —— 自己所在班级关联的，或自己有学习进度记录的。
 *
 * 单条端点 `GET /api/lessons/:id` 同步收窄，否则列表收窄了仍能按 id 拉任意课节。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('课节列表按角色收窄', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const teacherA = 'usr-lscope-teacher-a';
  const teacherB = 'usr-lscope-teacher-b';
  /** 第三方教师：用来把「课节创建者」与「课节所在班级」两个维度解耦。 */
  const teacherC = 'usr-lscope-teacher-c';
  const adminId = 'usr-lscope-admin';
  const studentId = 'stu-lscope-a';

  const tokTeacherA = 'tok-lscope-teacher-a';
  const tokTeacherB = 'tok-lscope-teacher-b';
  const tokAdmin = 'tok-lscope-admin';
  const tokStudent = 'tok-lscope-student';

  const classA = 'cls-lscope-a';
  const classB = 'cls-lscope-b';

  // 课节
  const lessonByTeacherA = 'lscope-lesson-a'; // 教师 A 创建
  const lessonByTeacherB = 'lscope-lesson-b'; // 教师 B 创建
  const lessonScheduledInA = 'lscope-lesson-sched'; // 别人创建，但排在 A 班课表
  const lessonAssignedInA = 'lscope-lesson-asg'; // 别人创建，但挂在本班作业
  const lessonSessionInA = 'lscope-lesson-sess'; // 别人创建，但本班有课堂会话
  const lessonWithProgress = 'lscope-lesson-prog'; // 别人创建，但学生自己有进度
  const lessonOrphan = 'lscope-lesson-orphan'; // creator_id 为空的历史课节
  const lessonForeign = 'lscope-lesson-foreign'; // 与该学生完全无关

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const get = (path: string, token: string) => fetch(`${baseUrl}${path}`, { headers: cookie(token) });
  const listIds = async (token: string): Promise<string[]> => {
    const res = await get('/api/lessons?pageSize=all', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    return body.data.map((l) => l.id);
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerLessonsRoutes({ app } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    const exp = now + 3600_000;
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      tokTeacherA,
      JSON.stringify({ userId: teacherA, role: 'teacher', username: 'lscope_ta' }),
      now,
      exp,
    );
    insertSession.run(
      tokTeacherB,
      JSON.stringify({ userId: teacherB, role: 'teacher', username: 'lscope_tb' }),
      now,
      exp,
    );
    insertSession.run(
      tokAdmin,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'lscope_admin' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudent,
      JSON.stringify({ userId: studentId, studentId, role: 'student', username: 'lscope_sa' }),
      now,
      exp,
    );

    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(teacherA, 'lscope_ta', 'x', 'teacher', '收窄教师甲', now);
    insertUser.run(teacherB, 'lscope_tb', 'x', 'teacher', '收窄教师乙', now);
    insertUser.run(teacherC, 'lscope_tc', 'x', 'teacher', '收窄教师丙', now);
    insertUser.run(adminId, 'lscope_admin', 'x', 'administrator', '收窄管理员', now);
    db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(studentId, 'LSCOPE-S', '收窄学生', '', now);

    const insertClass = db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertClass.run(classA, '收窄甲班', '', 'ls-a', teacherA, now);
    insertClass.run(classB, '收窄乙班', '', 'ls-b', teacherB, now);

    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classA,
      studentId,
      now,
    );

    const insertLesson = db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, content, timeline, progress_mode, created_at, updated_at, creator_id) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)',
    );
    insertLesson.run(lessonByTeacherA, 'L 范围 教师甲的课', '{}', 'manual', now, now, teacherA);
    insertLesson.run(lessonByTeacherB, 'L 范围 教师乙的课', '{}', 'manual', now, now, teacherB);
    insertLesson.run(lessonScheduledInA, 'L 范围 排在本班的课', '{}', 'manual', now, now, teacherC);
    insertLesson.run(lessonAssignedInA, 'L 范围 本班作业的课', '{}', 'manual', now, now, teacherC);
    insertLesson.run(lessonSessionInA, 'L 范围 本班课堂的课', '{}', 'manual', now, now, teacherC);
    insertLesson.run(lessonWithProgress, 'L 范围 我学过进度的课', '{}', 'manual', now, now, teacherC);
    insertLesson.run(lessonOrphan, 'L 范围 无主历史课', '{}', 'manual', now, now, null);
    insertLesson.run(lessonForeign, 'L 范围 完全无关的课', '{}', 'manual', now, now, teacherC);

    db.prepare(
      `INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', '', ?)`,
    ).run('sch-lscope-a', classA, lessonScheduledInA, '2026-01-01 09:00:00', '第1节', now);
    db.prepare(
      `INSERT OR REPLACE INTO assignments (id, class_id, lesson_id, title, description, content, created_at)
       VALUES (?, ?, ?, ?, '', '{}', ?)`,
    ).run('asg-lscope-a', classA, lessonAssignedInA, 'L 范围 作业', now);
    db.prepare(
      `INSERT OR REPLACE INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, checkin_code, created_at)
       VALUES (?, ?, ?, ?, 'PRE_CLASS_READY', '1234', ?)`,
    ).run('cs-lscope-a', lessonSessionInA, classA, teacherA, now);
    db.prepare(
      `INSERT OR REPLACE INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, completed_segments, assigned_at)
       VALUES (?, ?, 0, 30, '[]', ?)`,
    ).run(studentId, lessonWithProgress, now);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.prepare('DELETE FROM student_lesson_progress WHERE student_id = ?').run(studentId);
    db.prepare('DELETE FROM classroom_sessions WHERE id = ?').run('cs-lscope-a');
    db.prepare('DELETE FROM assignments WHERE id = ?').run('asg-lscope-a');
    db.prepare('DELETE FROM schedules WHERE id = ?').run('sch-lscope-a');
    db.prepare(
      'DELETE FROM lessons WHERE id IN (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      lessonByTeacherA,
      lessonByTeacherB,
      lessonScheduledInA,
      lessonAssignedInA,
      lessonSessionInA,
      lessonWithProgress,
      lessonOrphan,
      lessonForeign,
    );
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classA);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(teacherA, teacherB, teacherC, adminId);
    db.prepare('DELETE FROM client_sessions WHERE id LIKE ?').run('tok-lscope-%');
  });

  it('管理员看得到全部课节', async () => {
    const ids = await listIds(tokAdmin);
    for (const id of [
      lessonByTeacherA,
      lessonByTeacherB,
      lessonScheduledInA,
      lessonAssignedInA,
      lessonSessionInA,
      lessonWithProgress,
      lessonOrphan,
      lessonForeign,
    ]) {
      expect(ids, `管理员应看到 ${id}`).toContain(id);
    }
  });

  it('教师只看到自己教的课节（自己创建的 + 自己班上的）', async () => {
    const ids = await listIds(tokTeacherA);

    // 自己创建的 ✓
    expect(ids).toContain(lessonByTeacherA);
    // 自己班上的（排课 / 作业 / 课堂会话）✓ —— 即使是别人创建的
    expect(ids).toContain(lessonScheduledInA);
    expect(ids).toContain(lessonAssignedInA);
    expect(ids).toContain(lessonSessionInA);
    // 无主历史课节按既有约定对教师开放
    expect(ids).toContain(lessonOrphan);

    // 别人创建、与自己班无关的 ✗
    expect(ids).not.toContain(lessonByTeacherB);
    expect(ids).not.toContain(lessonForeign);
    // 学生自己的进度不构成教师的可见性
    expect(ids).not.toContain(lessonWithProgress);
  });

  it('教师 B 看不到教师 A 的课节', async () => {
    const ids = await listIds(tokTeacherB);
    expect(ids).toContain(lessonByTeacherB);
    expect(ids).not.toContain(lessonByTeacherA);
    expect(ids).not.toContain(lessonScheduledInA);
  });

  it('学生只看到自己班的课节 + 自己有进度的课节', async () => {
    const ids = await listIds(tokStudent);

    // 自己班上的（排课 / 作业 / 课堂会话）✓
    expect(ids).toContain(lessonScheduledInA);
    expect(ids).toContain(lessonAssignedInA);
    expect(ids).toContain(lessonSessionInA);
    // 自己有学习进度的 ✓
    expect(ids).toContain(lessonWithProgress);

    // 与自己无关的 ✗
    expect(ids).not.toContain(lessonForeign);
    expect(ids).not.toContain(lessonByTeacherB);
    // 无主历史课节不向学生开放
    expect(ids).not.toContain(lessonOrphan);
    // 学生看不到教师创建的课节（哪怕教师本人与自己无关）
    expect(ids).not.toContain(lessonByTeacherA);
  });

  it('单条端点与列表同口径：学生按 id 拉别人课节 → 403', async () => {
    expect((await get(`/api/lessons/${lessonForeign}`, tokStudent)).status).toBe(403);
    expect((await get(`/api/lessons/${lessonByTeacherA}`, tokStudent)).status).toBe(403);
    // 自己班上的 → 200
    expect((await get(`/api/lessons/${lessonScheduledInA}`, tokStudent)).status).toBe(200);
  });

  it('单条端点：教师按 id 拉别人课节 → 403，拉自己的 → 200', async () => {
    expect((await get(`/api/lessons/${lessonByTeacherA}`, tokTeacherA)).status).toBe(200);
    expect((await get(`/api/lessons/${lessonForeign}`, tokTeacherA)).status).toBe(403);
    // 管理员不受限
    expect((await get(`/api/lessons/${lessonForeign}`, tokAdmin)).status).toBe(200);
  });
});
