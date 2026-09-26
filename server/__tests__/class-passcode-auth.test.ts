import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import bcrypt from 'bcryptjs';

describe('班级上课临时密码与双轨登录鉴权', () => {
  let server: Server;
  let baseUrl: string;

  const db = kernelContainer.db as any;

  const teacherToken = 'tok-passcode-teacher-1';
  const studentToken = 'tok-passcode-student-1';
  const teacherId = 'teacher-passcode-1';

  const classId1 = 'class-passcode-101';
  const classId2 = 'class-passcode-102';
  const studentId1 = 'stu-passcode-001';
  const studentId2 = 'stu-passcode-002'; // 未加入 classId1

  const studentPersonalPwd = 'MySecretPassword123';
  const classTempPasscode = '8899';

  beforeAll(async () => {
    const app = express();
    app.use(express.json());

    const noopLimiter = (_req: any, _res: any, next: any) => next();
    registerRosterRoutes({ app, io: undefined, loginLimiter: noopLimiter } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    // 准备测试数据
    const now = Date.now();

    // 1. Session tokens
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(teacherToken, studentToken);
    db.prepare('INSERT INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)').run(
      teacherToken,
      JSON.stringify({ role: 'teacher', userId: teacherId, username: 'teacher1', name: '李老师' }),
      now,
      now + 86400000,
    );

    // 2. Classes
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classId1, classId2);
    db.prepare(
      'INSERT INTO classes (id, name, description, class_passcode, class_passcode_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(classId1, '高一(1)班', '实验班', classTempPasscode, now + 3600000, now);
    db.prepare(
      'INSERT INTO classes (id, name, description, class_passcode, class_passcode_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(classId2, '高一(2)班', '平行班', null, null, now);

    // 3. Students
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentId1, studentId2);
    const hash = bcrypt.hashSync(studentPersonalPwd, 10);
    db.prepare('INSERT INTO students (id, student_number, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      studentId1,
      'STU101',
      '张明',
      'zhang@school.edu',
      hash,
      now,
    );
    db.prepare('INSERT INTO students (id, student_number, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      studentId2,
      'STU102',
      '李红',
      'li@school.edu',
      hash,
      now,
    );

    // 4. Enrollments (studentId1 在 classId1, studentId2 在 classId2)
    db.prepare('DELETE FROM class_students WHERE student_id IN (?, ?)').run(studentId1, studentId2);
    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(classId1, studentId1, now);
    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(classId2, studentId2, now);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const authCookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  it('第三方插件获取接口 GET /api/classes/:id/passcode 返回完整数据及有效状态', async () => {
    const res = await fetch(`${baseUrl}/api/classes/${classId1}/passcode`, {
      headers: authCookie(teacherToken),
    });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.classId).toBe(classId1);
    expect(data.className).toBe('高一(1)班');
    expect(data.classPasscode).toBe(classTempPasscode);
    expect(data.isExpired).toBe(false);
    expect(data.remainingSeconds).toBeGreaterThan(0);
    expect(data.studentCount).toBe(1);
  });

  it('双轨登录 1：学生可以使用个人密码正常登录', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entrance: 'student',
        studentId: 'STU101',
        password: studentPersonalPwd,
      }),
    });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.session.role).toBe('student');
    expect(data.session.name).toBe('张明');
  });

  it('双轨登录 2：所在班级学生可凭班级上课临时密码登录', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entrance: 'student',
        studentId: 'STU101',
        password: classTempPasscode,
      }),
    });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.session.role).toBe('student');
    expect(data.session.userId).toBe(studentId1);
  });

  it('双轨登录 3：临时密码过期后，学生使用临时密码登录被拒绝并提示过期', async () => {
    // 将 classId1 的 expires_at 设置为过去的时间戳
    const pastTime = Date.now() - 10000;
    db.prepare('UPDATE classes SET class_passcode_expires_at = ? WHERE id = ?').run(pastTime, classId1);

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entrance: 'student',
        studentId: 'STU101',
        password: classTempPasscode,
      }),
    });
    expect(res.status).toBe(401);
    const data: any = await res.json();
    expect(data.code).toBe('CLASS_PASSCODE_EXPIRED');

    // 尽管临时密码过期，个人自设密码依然可以登录
    const personalRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entrance: 'student',
        studentId: 'STU101',
        password: studentPersonalPwd,
      }),
    });
    expect(personalRes.status).toBe(200);
  });

  it('双轨登录 4：非本班学生使用其他班级的临时密码无法登录', async () => {
    // 恢复 classId1 的密码与有效时间
    const futureTime = Date.now() + 3600000;
    db.prepare('UPDATE classes SET class_passcode_expires_at = ? WHERE id = ?').run(futureTime, classId1);

    // studentId2 属于 classId2，使用 classId1 的临时密码应该登录失败
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entrance: 'student',
        studentId: 'STU102',
        password: classTempPasscode,
      }),
    });
    expect(res.status).toBe(401);
  });

  it('教师通过 PUT /api/classes/:id 更新或清除临时密码生效', async () => {
    // 更新为新临时密码
    const newPasscode = '6688';
    const newExpiresAt = Date.now() + 7200000;
    const putRes = await fetch(`${baseUrl}/api/classes/${classId1}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authCookie(teacherToken) },
      body: JSON.stringify({
        class_passcode: newPasscode,
        class_passcode_expires_at: newExpiresAt,
      }),
    });
    expect(putRes.status).toBe(200);

    // 学生使用新密码登录成功
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entrance: 'student',
        studentId: 'STU101',
        password: newPasscode,
      }),
    });
    expect(loginRes.status).toBe(200);

    // 旧密码不再有效
    const oldLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entrance: 'student',
        studentId: 'STU101',
        password: classTempPasscode,
      }),
    });
    expect(oldLoginRes.status).toBe(401);
  });
});
