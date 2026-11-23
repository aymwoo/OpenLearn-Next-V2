/**
 * Gitee Issue IKW5KV：学生端界面可见性策略。
 *
 * 覆盖：
 * - 学生只能读取自己的策略；
 * - 教师只能维护自己班级/课节的策略；
 * - 教师全局 → 班级 → 课节的逐项覆盖；
 * - 非法功能 ID 拒绝落库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerStudentUiPolicyRoutes } from '../routes/student-ui-policy.js';
import type { ServerContext } from '../context.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('学生端界面可见性策略', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const teacherA = 'usr-sup-teacher-a';
  const teacherB = 'usr-sup-teacher-b';
  const adminId = 'usr-sup-admin';
  const studentA = 'stu-sup-a';
  const studentB = 'stu-sup-b';
  const classA = 'cls-sup-a';
  const classB = 'cls-sup-b';
  const lessonA = 'les-sup-a';
  const lessonB = 'les-sup-b';

  const tokTeacherA = 'tok-sup-teacher-a';
  const tokTeacherB = 'tok-sup-teacher-b';
  const tokAdmin = 'tok-sup-admin';
  const tokStudentA = 'tok-sup-student-a';
  const tokStudentB = 'tok-sup-student-b';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const jsonHeaders = (token: string) => ({ ...cookie(token), 'Content-Type': 'application/json' });

  const putPolicy = (token: string, body: unknown) =>
    fetch(`${baseUrl}/api/teacher/student-ui-policies`, {
      method: 'PUT',
      headers: jsonHeaders(token),
      body: JSON.stringify(body),
    });

  const deletePolicy = (token: string, scopeType: string, scopeId: string) =>
    fetch(`${baseUrl}/api/teacher/student-ui-policies?scopeType=${scopeType}&scopeId=${scopeId}`, {
      method: 'DELETE',
      headers: cookie(token),
    });

  const getStudentPolicy = (token: string, studentId: string, lessonId?: string) =>
    fetch(
      `${baseUrl}/api/students/${studentId}/ui-policy${lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : ''}`,
      { headers: cookie(token) },
    );

  const getChain = (token: string, scopeType: string, scopeId: string) =>
    fetch(
      `${baseUrl}/api/teacher/student-ui-policies?scopeType=${encodeURIComponent(scopeType)}&scopeId=${encodeURIComponent(scopeId)}`,
      { headers: cookie(token) },
    );

  beforeAll(async () => {
    const now = Date.now();
    const exp = now + 3600_000;
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(tokTeacherA, JSON.stringify({ userId: teacherA, role: 'teacher', username: 'sup_a' }), now, exp);
    insertSession.run(tokTeacherB, JSON.stringify({ userId: teacherB, role: 'teacher', username: 'sup_b' }), now, exp);
    insertSession.run(
      tokAdmin,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'sup_admin' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentA,
      JSON.stringify({ userId: studentA, studentId: studentA, role: 'student', username: 'sup_sa' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentB,
      JSON.stringify({ userId: studentB, studentId: studentB, role: 'student', username: 'sup_sb' }),
      now,
      exp,
    );

    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, owner_user_id, created_at) VALUES (?,?,?,?,?)',
    ).run(classA, '策略甲班', '', teacherA, now);
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, owner_user_id, created_at) VALUES (?,?,?,?,?)',
    ).run(classB, '策略乙班', '', teacherB, now);
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?,?,?,?,?)').run(
      studentA,
      'SUP-A',
      '策略甲生',
      '',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?,?,?,?,?)').run(
      studentB,
      'SUP-B',
      '策略乙生',
      '',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?,?,?)').run(
      classA,
      studentA,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?,?,?)').run(
      classB,
      studentB,
      now,
    );

    const insertLesson = db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    );
    insertLesson.run(lessonA, '策略甲课', '', teacherA, now, now);
    insertLesson.run(lessonB, '策略乙课', '', teacherB, now, now);
    const insertSchedule = db.prepare(
      'INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, created_at) VALUES (?,?,?,?,?,?,?)',
    );
    insertSchedule.run('sch-sup-a', classA, lessonA, '2026-11-20', '09:00 - 09:45', 'scheduled', now);
    insertSchedule.run('sch-sup-b', classB, lessonB, '2026-11-20', '10:00 - 10:45', 'scheduled', now);

    const app = express();
    app.use(express.json());
    registerStudentUiPolicyRoutes({ app } as unknown as ServerContext);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      db.prepare('DELETE FROM student_ui_policies WHERE scope_id IN (?,?,?,?)').run(classA, classB, lessonA, lessonB);
      db.prepare('DELETE FROM student_ui_policies WHERE scope_type = ? AND scope_id IN (?,?)').run(
        'teacher',
        teacherA,
        teacherB,
      );
      db.prepare('DELETE FROM client_sessions WHERE id IN (?,?,?,?,?)').run(
        tokTeacherA,
        tokTeacherB,
        tokAdmin,
        tokStudentA,
        tokStudentB,
      );
      db.prepare('DELETE FROM class_students WHERE class_id IN (?,?)').run(classA, classB);
      db.prepare('DELETE FROM schedules WHERE id IN (?,?)').run('sch-sup-a', 'sch-sup-b');
      db.prepare('DELETE FROM lessons WHERE id IN (?,?)').run(lessonA, lessonB);
      db.prepare('DELETE FROM classes WHERE id IN (?,?)').run(classA, classB);
      db.prepare('DELETE FROM students WHERE id IN (?,?)').run(studentA, studentB);
    } catch {
      // 清理失败不掩盖测试结论
    }
  });

  it('学生只能读取自己的策略', async () => {
    const own = await getStudentPolicy(tokStudentA, studentA);
    expect(own.status).toBe(200);
    const selfData = await own.json();
    expect(selfData.policy.features['widget.quick-stats']).toBe(true);

    const other = await getStudentPolicy(tokStudentB, studentA);
    expect(other.status).toBe(403);
  });

  it('教师不能维护其他班级策略', async () => {
    const res = await putPolicy(tokTeacherB, {
      scopeType: 'class',
      scopeId: classA,
      policy: { version: 1, features: { 'widget.quick-stats': false } },
    });
    expect(res.status).toBe(403);
  });

  it('非法功能 ID 返回 400 且不落库', async () => {
    const res = await putPolicy(tokTeacherA, {
      scopeType: 'class',
      scopeId: classA,
      policy: { version: 1, features: { 'widget.not-exist': false } },
    });
    expect(res.status).toBe(400);
    const row = db
      .prepare("SELECT 1 AS ok FROM student_ui_policies WHERE scope_type = 'class' AND scope_id = ?")
      .get(classA);
    expect(row).toBeUndefined();
  });

  it('按 教师全局 → 班级 → 课节 生效', async () => {
    const teacherRes = await putPolicy(tokTeacherA, {
      scopeType: 'teacher',
      scopeId: teacherA,
      policy: {
        version: 1,
        features: { 'widget.quick-stats': false, 'widget.academic-comparison': false },
        hideGuidance: true,
      },
    });
    expect(teacherRes.status).toBe(200);

    const classRes = await putPolicy(tokTeacherA, {
      scopeType: 'class',
      scopeId: classA,
      policy: { version: 1, features: { 'widget.quick-stats': true } },
    });
    expect(classRes.status).toBe(200);

    const classView = await getStudentPolicy(tokStudentA, studentA);
    const classPolicy = await classView.json();
    expect(classPolicy.policy.features['widget.quick-stats']).toBe(true);
    expect(classPolicy.policy.features['widget.academic-comparison']).toBe(false);
    expect(classPolicy.policy.hideGuidance).toBe(true);

    const lessonRes = await putPolicy(tokTeacherA, {
      scopeType: 'lesson',
      scopeId: lessonA,
      policy: { version: 1, features: { 'widget.quick-stats': false } },
    });
    expect(lessonRes.status).toBe(200);

    const lessonView = await getStudentPolicy(tokStudentA, studentA, lessonA);
    const lessonPolicy = await lessonView.json();
    expect(lessonPolicy.policy.features['widget.quick-stats']).toBe(false);
  });

  it('教师不能维护其他教师的课节策略', async () => {
    const res = await putPolicy(tokTeacherB, {
      scopeType: 'lesson',
      scopeId: lessonA,
      policy: { version: 1, features: { 'widget.quick-stats': false } },
    });
    expect(res.status).toBe(403);
  });

  it('学生不能借他人课节读取课节策略', async () => {
    const res = await getStudentPolicy(tokStudentA, studentA, lessonB);
    expect(res.status).toBe(403);
  });

  it('删除班级策略后回落到教师全局', async () => {
    const del = await deletePolicy(tokTeacherA, 'class', classA);
    expect(del.status).toBe(200);
    const view = await getStudentPolicy(tokStudentA, studentA);
    const data = await view.json();
    expect(data.policy.features['widget.quick-stats']).toBe(false);
  });

  it('未登录访问四个端点统一返回 401', async () => {
    expect((await fetch(`${baseUrl}/api/students/${studentA}/ui-policy`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/teacher/student-ui-policies?scopeType=class&scopeId=${classA}`)).status).toBe(
      401,
    );
    expect(
      (
        await fetch(`${baseUrl}/api/teacher/student-ui-policies`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scopeType: 'class', scopeId: classA, policy: { version: 1 } }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/api/teacher/student-ui-policies?scopeType=class&scopeId=${classA}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(401);
  });

  it('非法作用域参数返回 400', async () => {
    expect((await getChain(tokTeacherA, 'org', classA)).status).toBe(400);

    const emptyScope = await fetch(`${baseUrl}/api/teacher/student-ui-policies?scopeType=class&scopeId=`, {
      headers: cookie(tokTeacherA),
    });
    expect(emptyScope.status).toBe(400);

    const badPut = await putPolicy(tokTeacherA, {
      scopeType: 'lesson',
      scopeId: '',
      policy: { version: 1 },
    });
    expect(badPut.status).toBe(400);
  });

  it('不存在的作用域返回 404', async () => {
    expect((await getChain(tokTeacherA, 'class', 'cls-sup-missing')).status).toBe(404);
    expect((await getChain(tokTeacherA, 'lesson', 'les-sup-missing')).status).toBe(404);
  });

  it('教师全局作用域：本人与管理员可维护，其他教师 403', async () => {
    const own = await putPolicy(tokTeacherB, {
      scopeType: 'teacher',
      scopeId: teacherB,
      policy: { version: 1, features: { 'widget.schedules': false } },
    });
    expect(own.status).toBe(200);

    const other = await putPolicy(tokTeacherA, {
      scopeType: 'teacher',
      scopeId: teacherB,
      policy: { version: 1, features: { 'widget.schedules': true } },
    });
    expect(other.status).toBe(403);

    const admin = await putPolicy(tokAdmin, {
      scopeType: 'teacher',
      scopeId: teacherB,
      policy: { version: 1, features: { 'widget.schedules': true } },
    });
    expect(admin.status).toBe(200);

    expect((await deletePolicy(tokTeacherB, 'teacher', teacherB)).status).toBe(200);
  });

  it('教师读取策略链返回 stored / inherited / effective', async () => {
    const res = await getChain(tokTeacherA, 'class', classA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      stored: unknown;
      inherited: { features: Record<string, boolean> };
      effective: { features: Record<string, boolean> };
    };
    expect(body.success).toBe(true);
    expect(body.stored).toBeNull();
    expect(body.inherited.features['widget.quick-stats']).toBe(false);
    expect(body.effective.features['widget.quick-stats']).toBe(false);

    expect((await getChain(tokTeacherB, 'class', classA)).status).toBe(403);
    expect((await getChain(tokStudentA, 'class', classA)).status).toBe(403);
  });

  it('管理员可以读取任意学生的策略', async () => {
    const res = await getStudentPolicy(tokAdmin, studentB);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; policy: { features: Record<string, boolean> } };
    expect(body.success).toBe(true);
    expect(body.policy.features['widget.quick-stats']).toBe(true);
  });
});
