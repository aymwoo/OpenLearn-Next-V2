import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerCoursewareRoutes } from '../routes/courseware.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('Security Scope: Courseware Attempts & Cross-Class Authorization (Issue #139)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  // ── 测试主体与身份夹具 ─────────────────────────────────────────
  const teacherAId = 'usr-t-scope-a';
  const teacherAToken = 'tok-t-scope-a';
  const teacherBId = 'usr-t-scope-b';
  const teacherBToken = 'tok-t-scope-b';
  const adminId = 'usr-admin-scope';
  const adminToken = 'tok-admin-scope';

  const studentA1Id = 'stu-scope-a1';
  const studentA1Token = 'tok-stu-scope-a1';
  const studentB1Id = 'stu-scope-b1';
  const studentB1Token = 'tok-stu-scope-b1';

  const classAId = 'cls-scope-a';
  const classBId = 'cls-scope-b';

  const lessonAId = `lesson-scope-a-${Date.now()}`;
  const lessonBId = `lesson-scope-b-${Date.now()}`;

  const cwId = `cw-scope-${Date.now()}`;
  const cwUuid = `uuid-${cwId}`;

  const attemptA1 = `att-scope-a1-${Date.now()}`;
  const attemptB1 = `att-scope-b1-${Date.now()}`;
  const attemptTest = `att-scope-test-${Date.now()}`;

  const cookieTeacherA = { Cookie: `edu_os_token=${teacherAToken}` };
  const cookieTeacherB = { Cookie: `edu_os_token=${teacherBToken}` };
  const cookieAdmin = { Cookie: `edu_os_token=${adminToken}` };
  const cookieStudentA1 = { Cookie: `edu_os_token=${studentA1Token}` };
  const cookieStudentB1 = { Cookie: `edu_os_token=${studentB1Token}` };

  beforeAll(async () => {
    await kernelContainer.ready;
    const now = Date.now();
    const db = kernelContainer.db;

    // 1. 初始化用户
    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(teacherAId, 'teacher_a', 'pwd', 'teacher', '张老师', now);
    insertUser.run(teacherBId, 'teacher_b', 'pwd', 'teacher', '李老师', now);
    insertUser.run(adminId, 'admin_scope', 'pwd', 'administrator', '系统管理员', now);
    insertUser.run(studentA1Id, 'student_a1', 'pwd', 'student', '学生A1', now);
    insertUser.run(studentB1Id, 'student_b1', 'pwd', 'student', '学生B1', now);

    // 2. 初始化 Session
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      teacherAToken,
      JSON.stringify({ userId: teacherAId, role: 'teacher', username: 'teacher_a' }),
      now,
      now + 86400000,
    );
    insertSession.run(
      teacherBToken,
      JSON.stringify({ userId: teacherBId, role: 'teacher', username: 'teacher_b' }),
      now,
      now + 86400000,
    );
    insertSession.run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'admin_scope' }),
      now,
      now + 86400000,
    );
    insertSession.run(
      studentA1Token,
      JSON.stringify({ userId: studentA1Id, studentId: studentA1Id, role: 'student', username: 'student_a1' }),
      now,
      now + 86400000,
    );
    insertSession.run(
      studentB1Token,
      JSON.stringify({ userId: studentB1Id, studentId: studentB1Id, role: 'student', username: 'student_b1' }),
      now,
      now + 86400000,
    );

    // 3. 初始化班级与归属 (Class A 由 Teacher A 管辖，Class B 由 Teacher B 管辖)
    const insertClass = db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertClass.run(classAId, '高一A班', '物理实验A', 'pass-a', teacherAId, now);
    insertClass.run(classBId, '高一B班', '物理实验B', 'pass-b', teacherBId, now);

    // 4. 学生及选班绑定
    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertStudent.run(studentA1Id, 'NUM-A1', '学生A1', 'a1@test.com', now);
    insertStudent.run(studentB1Id, 'NUM-B1', '学生B1', 'b1@test.com', now);

    const insertClassStudent = db.prepare(
      'INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
    );
    insertClassStudent.run(classAId, studentA1Id, now);
    insertClassStudent.run(classBId, studentB1Id, now);

    // 5. 课时记录
    const insertLesson = db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertLesson.run(lessonAId, '课时A', '{}', null, 'manual', teacherAId, now, now);
    insertLesson.run(lessonBId, '课时B', '{}', null, 'manual', teacherBId, now, now);

    // 6. 课件记录
    db.prepare(
      'INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(cwId, cwUuid, '物理课件', 'html', 'index.html', now);

    // 7. 课件作答记录
    const insertAttempt = db.prepare(
      'INSERT OR REPLACE INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertAttempt.run(attemptA1, cwId, studentA1Id, now - 1000, now - 500, 'finished');
    insertAttempt.run(attemptB1, cwId, studentB1Id, now - 800, now - 300, 'finished');
    insertAttempt.run(attemptTest, cwId, 'teacher', now - 600, now - 100, 'finished');

    // 8. 评分记录
    const insertResult = db.prepare(
      'INSERT OR REPLACE INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertResult.run(`res-a1-${now}`, attemptA1, 95, '优秀作答A1', 1.0, JSON.stringify({ detail: 'secret-a1' }));
    insertResult.run(`res-b1-${now}`, attemptB1, 88, '良好作答B1', 0.9, JSON.stringify({ detail: 'secret-b1' }));
    insertResult.run(`res-test-${now}`, attemptTest, 100, '教师自测', 1.0, JSON.stringify({ detail: 'test' }));

    // 9. 启动 Express
    app = express();
    app.use(express.json());
    registerCoursewareRoutes({ app } as any);
    registerLessonsRoutes({ app } as any);

    await new Promise<void>((resolve) => {
      server = createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  describe('1. 课件作答记录列表隔离 (GET /api/courseware/attempts)', () => {
    it('教师 A 只能看到管辖班级学生 A1 和自测记录，无法看到班级 B 学生 B1', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${encodeURIComponent(cwUuid)}`, {
        headers: cookieTeacherA,
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      const attemptIds = body.data.map((item: any) => item.attemptId);
      expect(attemptIds).toContain(attemptA1);
      expect(attemptIds).toContain(attemptTest);
      expect(attemptIds).not.toContain(attemptB1);
    });

    it('教师 B 只能看到管辖班级学生 B1，无法看到班级 A 学生 A1', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${encodeURIComponent(cwUuid)}`, {
        headers: cookieTeacherB,
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      const attemptIds = body.data.map((item: any) => item.attemptId);
      expect(attemptIds).toContain(attemptB1);
      expect(attemptIds).not.toContain(attemptA1);
    });

    it('管理员可看到全校所有学生及测试作答', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${encodeURIComponent(cwUuid)}`, {
        headers: cookieAdmin,
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      const attemptIds = body.data.map((item: any) => item.attemptId);
      expect(attemptIds).toContain(attemptA1);
      expect(attemptIds).toContain(attemptB1);
      expect(attemptIds).toContain(attemptTest);
    });

    it('学生 A1 仅能看到本人记录，且敏感字段被脱敏', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${encodeURIComponent(cwUuid)}`, {
        headers: cookieStudentA1,
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].attemptId).toBe(attemptA1);
      expect(body.data[0].extra_json).toBeUndefined();
      expect(body.data[0].comment).toBeUndefined();
    });
  });

  describe('2. 课件作答进度详情鉴权 (GET /api/courseware/attempts/:id/progress)', () => {
    it('教师 A 查看学生 A1 的作答进度返回 200', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptA1}/progress`, {
        headers: cookieTeacherA,
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.progress.score).toBe(95);
    });

    it('教师 A 跨班查看学生 B1 的作答进度被拦截返回 403', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptB1}/progress`, {
        headers: cookieTeacherA,
      });
      expect(res.status).toBe(403);
    });

    it('教师 B 查看学生 B1 的作答进度返回 200', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptB1}/progress`, {
        headers: cookieTeacherB,
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.progress.score).toBe(88);
    });

    it('学生 A1 跨用户查看学生 B1 的进度被拦截返回 403', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptB1}/progress`, {
        headers: cookieStudentA1,
      });
      expect(res.status).toBe(403);
    });

    it('管理员可查看任意学生的作答进度返回 200', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptA1}/progress`, {
        headers: cookieAdmin,
      });
      expect(res.status).toBe(200);
    });
  });

  describe('3. 原始答卷数据鉴权 (GET /api/courseware/attempts/:id/raw)', () => {
    it('教师 A 读取学生 B1 原始答卷被拦截返回 403', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptB1}/raw`, {
        headers: cookieTeacherA,
      });
      expect(res.status).toBe(403);
    });

    it('学生 A1 读取学生 B1 原始答卷被拦截返回 403', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptB1}/raw`, {
        headers: cookieStudentA1,
      });
      expect(res.status).toBe(403);
    });

    it('不存在的 attemptId 返回 404', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/non-existent-attempt/raw`, {
        headers: cookieTeacherA,
      });
      expect(res.status).toBe(404);
    });
  });

  describe('4. 同类写操作路由跨班级越权防护', () => {
    it('教师 A 尝试标记非管辖班级 B 学生为缺考返回 403', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/mark-absent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...cookieTeacherA,
        },
        body: JSON.stringify({
          lessonId: lessonBId,
          classId: classBId,
          studentId: studentB1Id,
          coursewareId: cwId,
        }),
      });
      expect(res.status).toBe(403);
    });

    it('教师 A 尝试晋升非管辖班级 B 的作答成绩返回 403', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptB1}/promote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...cookieTeacherA,
        },
        body: JSON.stringify({
          lessonId: lessonBId,
          classId: classBId,
        }),
      });
      expect(res.status).toBe(403);
    });

    it('教师 A 尝试对非管辖班级 B 执行自动补录返回 403', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/auto-record`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...cookieTeacherA,
        },
        body: JSON.stringify({
          lessonId: lessonBId,
          classId: classBId,
        }),
      });
      expect(res.status).toBe(403);
    });

    it('缺少 classId 时写操作返回 400', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/auto-record`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...cookieTeacherA,
        },
        body: JSON.stringify({
          lessonId: lessonAId,
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('5. 课时分段评估跨学生越权防护 (POST /api/lessons/:id/segment-access)', () => {
    it('教师 A 尝试评估非管辖班级学生 B1 时被拦截返回 403', async () => {
      const res = await fetch(`${baseUrl}/api/lessons/${lessonAId}/segment-access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...cookieTeacherA,
        },
        body: JSON.stringify({
          studentId: studentB1Id,
          targetSegmentId: 'seg-1',
        }),
      });
      expect(res.status).toBe(403);
    });
  });
});
