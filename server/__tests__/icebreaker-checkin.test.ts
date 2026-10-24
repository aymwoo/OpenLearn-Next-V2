import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { DiagnosticService } from '../services/diagnostic-service.js';
import { v7 as uuidv7 } from 'uuid';

describe('Issue #131: 课前破冰心情打卡端到端与持久化集成测试', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const teacherId = `usr_teach_${uuidv7().slice(0, 8)}`;
  const student1Id = `usr_stu1_${uuidv7().slice(0, 8)}`;
  const student2Id = `usr_stu2_${uuidv7().slice(0, 8)}`;
  const otherStudentId = `usr_other_${uuidv7().slice(0, 8)}`;

  const student1Token = `tok_stu1_${uuidv7().slice(0, 8)}`;
  const student2Token = `tok_stu2_${uuidv7().slice(0, 8)}`;
  const otherStudentToken = `tok_other_${uuidv7().slice(0, 8)}`;

  const testClassId = `cls_ice_${uuidv7().slice(0, 8)}`;
  const testLessonId = `les_ice_${uuidv7().slice(0, 8)}`;

  const student1Headers = {
    'Content-Type': 'application/json',
    Cookie: `edu_os_token=${student1Token}`,
  };
  const student2Headers = {
    'Content-Type': 'application/json',
    Cookie: `edu_os_token=${student2Token}`,
  };
  const otherStudentHeaders = {
    'Content-Type': 'application/json',
    Cookie: `edu_os_token=${otherStudentToken}`,
  };

  beforeAll(async () => {
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;
    const db = kernelContainer.db;

    // 1. 创建教师
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'teacher_ice_test', 'hash', 'teacher', '测试教师', now);

    // 2. 创建班级并归属该教师
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(testClassId, '高一(1)班', '破冰测试班', teacherId, now);

    // 3. 创建课节
    db.prepare(
      `INSERT OR REPLACE INTO lessons (id, title, content, progress_mode, creator_id, created_at, updated_at)
       VALUES (?, ?, ?, 'teacher_led', ?, ?, ?)`,
    ).run(testLessonId, '高一物理：机械能守恒', '内容', teacherId, now, now);

    // 4. 创建学生1（入班）
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(student1Id, 'stu1_ice', 'hash', 'student', '张小明', now);
    db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(student1Id, 'S001', '张小明', 's1@test.com', now);
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      testClassId,
      student1Id,
      now,
    );
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      student1Token,
      JSON.stringify({ userId: student1Id, studentId: student1Id, role: 'student', username: 'stu1_ice' }),
      now,
      expiresAt,
    );

    // 5. 创建学生2（入班）
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(student2Id, 'stu2_ice', 'hash', 'student', '李小红', now);
    db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(student2Id, 'S002', '李小红', 's2@test.com', now);
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      testClassId,
      student2Id,
      now,
    );
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      student2Token,
      JSON.stringify({ userId: student2Id, studentId: student2Id, role: 'student', username: 'stu2_ice' }),
      now,
      expiresAt,
    );

    // 6. 创建其他班级学生（未选 testClassId）
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(otherStudentId, 'other_ice', 'hash', 'student', '王小强', now);
    db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(otherStudentId, 'S003', '王小强', 's3@test.com', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      otherStudentToken,
      JSON.stringify({ userId: otherStudentId, studentId: otherStudentId, role: 'student', username: 'other_ice' }),
      now,
      expiresAt,
    );

    // 7. 搭建 Express 实例
    app = express();
    app.use(express.json());
    registerLessonsRoutes({ app } as any);

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    const db = kernelContainer.db;
    db.prepare('DELETE FROM icebreaker_checkins WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(testClassId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?, ?)').run(student1Id, student2Id, otherStudentId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(
      student1Token,
      student2Token,
      otherStudentToken,
    );
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(teacherId, student1Id, student2Id, otherStudentId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(testLessonId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(testClassId);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('未认证打卡被阻断为 401', async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClassId}/checkin/icebreaker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood: 'fullPower' }),
    });
    expect(res.status).toBe(401);
  });

  it('非本班学生打卡被拒绝为 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClassId}/checkin/icebreaker`, {
      method: 'POST',
      headers: otherStudentHeaders,
      body: JSON.stringify({ mood: 'fullPower', lessonId: testLessonId }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });

  it('向不存在的班级打卡返回 404', async () => {
    const res = await fetch(`${baseUrl}/api/classes/nonexistent-class-999/checkin/icebreaker`, {
      method: 'POST',
      headers: student1Headers,
      body: JSON.stringify({ mood: 'fullPower', lessonId: testLessonId }),
    });
    expect(res.status).toBe(404);
  });

  it('非法 mood 参数返回 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClassId}/checkin/icebreaker`, {
      method: 'POST',
      headers: student1Headers,
      body: JSON.stringify({ mood: 'invalid_super_happy', lessonId: testLessonId }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid mood');
  });

  it('本班学生打卡成功，返回 200 并统计为 1 人', async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClassId}/checkin/icebreaker`, {
      method: 'POST',
      headers: student1Headers,
      body: JSON.stringify({ mood: 'fullPower', lessonId: testLessonId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.stats).toEqual({ fullPower: 1, needCoffee: 0, needHelp: 0 });
  });

  it('同一学生重复打卡（切换心情）只更新状态，不重复增加人数', async () => {
    // 学生1将心情从 fullPower 修改为 needCoffee
    const res = await fetch(`${baseUrl}/api/classes/${testClassId}/checkin/icebreaker`, {
      method: 'POST',
      headers: student1Headers,
      body: JSON.stringify({ mood: 'needCoffee', lessonId: testLessonId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // 人数仍然为 1，fullPower 变 0，needCoffee 变 1
    expect(body.stats).toEqual({ fullPower: 0, needCoffee: 1, needHelp: 0 });
  });

  it('另一学生打卡后，总打卡人数正确累加为 2', async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClassId}/checkin/icebreaker`, {
      method: 'POST',
      headers: student2Headers,
      body: JSON.stringify({ mood: 'needHelp', lessonId: testLessonId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // 学生1是 needCoffee，学生2是 needHelp
    expect(body.stats).toEqual({ fullPower: 0, needCoffee: 1, needHelp: 1 });
  });

  it('模拟服务重启（全新 DiagnosticService 实例）：数据从 SQLite 持久化层完整读取，不丢失', () => {
    const newService = new DiagnosticService(kernelContainer.db);
    const stats = newService.getIcebreakerStats(testClassId, testLessonId);
    expect(stats).toEqual({ fullPower: 0, needCoffee: 1, needHelp: 1 });

    const diag = newService.getPreClassDiagnostic(testLessonId, testClassId);
    expect(diag.icebreakerStats).toEqual({ fullPower: 0, needCoffee: 1, needHelp: 1 });
  });
});
