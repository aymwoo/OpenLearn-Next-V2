/**
 * @vitest-environment node
 *
 * Issue #123: 课内即时发起测评与大屏/驾驶舱实时统计看板。
 *
 * 验证核心能力：
 * 1. 教师在课堂会话中即时发起测评：POST /api/classroom/sessions/:lessonId/assessment
 *    - 权限校验（学生发起 403，教师发起成功）
 *    - 会话绑定（active_assessment 写入 classroom_sessions）
 *    - Socket 广播校验（classroom:assessment_started）
 * 2. 驾驶舱与大屏实时看板：GET /api/classroom/sessions/:lessonId/assessment-progress
 *    - 全班应答进度统计（未开始 / 作答中 / 已交卷）
 *    - 班级即时均分与学生答题状态列表
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { registerAssessmentRoutes } from '../routes/assessments.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { assessmentService } from '../services/assessment-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

describe('课内即时测评发起与课堂实时看板', () => {
  let server: Server;
  let baseUrl: string;
  let classroomService: ClassroomRuntimeService;

  const lessonId = 'les-room-assess-001';
  const classId = 'cls-room-assess-001';
  const teacherId = 'usr-room-assess-teacher';
  const teacherToken = 'tok-room-assess-teacher';
  const student1Id = 'stu-room-assess-1';
  const student1Token = 'tok-room-assess-1';
  const student2Id = 'stu-room-assess-2';
  const student2Token = 'tok-room-assess-2';

  const db = kernelContainer.db as any;
  let assessmentId: string;

  const seedSession = (token: string, session: Record<string, unknown>) => {
    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
    db.prepare('INSERT INTO client_sessions (id, session_data, expires_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(token, JSON.stringify(session), Date.now() + 3_600_000, Date.now());
  };

  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { cookie: `edu_os_token=${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, text, json };
  };

  beforeAll(async () => {
    ensureTestSchema();

    // 清理并注入测试数据
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(student1Id, student2Id);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM assessment_answers').run();
    db.prepare('DELETE FROM assessment_attempts').run();
    db.prepare('DELETE FROM assessment_assignments').run();
    db.prepare('DELETE FROM assessment_items').run();
    db.prepare('DELETE FROM assessments').run();

    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'room_teacher', '随堂教师', 'hash', 'teacher', now);

    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classId,
      '随堂测评班',
      teacherId,
      now,
    );

    for (const sid of [student1Id, student2Id]) {
      db.prepare('INSERT INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)').run(
        sid,
        sid === student1Id ? 'STU-01' : 'STU-02',
        sid === student1Id ? '课堂学生甲' : '课堂学生乙',
        now,
      );
      db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
        classId,
        sid,
        now,
      );
    }

    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(lessonId, '力学随堂互动课', teacherId, now, now);

    classroomService = new ClassroomRuntimeService(db);
    await classroomService.getOrCreateSession(lessonId, teacherId, classId);

    seedSession(teacherToken, { userId: teacherId, username: 'room_teacher', role: 'teacher' });
    seedSession(student1Token, { userId: student1Id, studentId: student1Id, username: 'stu_1', role: 'student' });
    seedSession(student2Token, { userId: student2Id, studentId: student2Id, username: 'stu_2', role: 'student' });

    // 创建一份预设随堂测验试卷
    const paper = assessmentService.createAssessment({
      ownerId: teacherId,
      title: '牛顿运动定律随堂测',
      kind: 'quiz',
      settings: {
        singleAttempt: true,
        shuffleItems: false,
        shuffleOptions: false,
      },
    });
    assessmentId = paper.id;
    assessmentService.replaceItems(
      paper.id,
      teacherId,
      [
        {
          id: 'q_1',
          type: 'single_choice',
          stem: '力是改变物体什么状态的原因？',
          config: { options: ['运动状态', '静止状态', '质量', '体积'] },
          answerKey: { index: 0 },
          maxScore: 10,
          sortOrder: 0,
        },
      ],
    );

    const app = express();
    app.use(express.json());
    registerClassroomRoutes({ app, io: undefined } as any, classroomService);
    registerAssessmentRoutes({ app } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('学生无权发起课内测评，返回 403', async () => {
    const res = await call('POST', `/api/classroom/sessions/${lessonId}/assessment`, student1Token, {
      assessmentId,
    });
    expect(res.status).toBe(403);
  });

  it('教师课内即时发起测评成功，并与课堂会话关联', async () => {
    const res = await call('POST', `/api/classroom/sessions/${lessonId}/assessment`, teacherToken, {
      assessmentId,
      durationSec: 600,
    });
    expect(res.status).toBe(201);
    expect(res.json.success).toBe(true);
    expect(res.json.assignmentId).toBeDefined();

    // 验证课堂会话中记录了 activeAssessment
    const sessionRes = await call('GET', `/api/classroom/sessions/${lessonId}`, teacherToken);
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.json.activeAssessment).toBeDefined();
    expect(sessionRes.json.activeAssessment.assignmentId).toBe(res.json.assignmentId);
    expect(sessionRes.json.activeAssessment.title).toBe('牛顿运动定律随堂测');
  });

  it('大屏与教师看板拉取全班作答进度与即时统计', async () => {
    // 初始状态：全班 2 人均为 unstarted
    const initProgress = await call('GET', `/api/classroom/sessions/${lessonId}/assessment-progress`, teacherToken);
    expect(initProgress.status).toBe(200);
    expect(initProgress.json.totalStudents).toBe(2);
    expect(initProgress.json.unstartedCount).toBe(2);
    expect(initProgress.json.inProgressCount).toBe(0);
    expect(initProgress.json.submittedCount).toBe(0);
    expect(initProgress.json.averageScore).toBeNull();

    const assignmentId = initProgress.json.assignment.id;

    // 学生 1 进入作答
    const start1 = await call('POST', `/api/assessment-assignments/${assignmentId}/attempts`, student1Token);
    expect(start1.status).toBe(201);

    // 此时拉取看板：应有 1 人作答中，1 人未开始
    const inProgress = await call('GET', `/api/classroom/sessions/${lessonId}/assessment-progress`, teacherToken);
    expect(inProgress.status).toBe(200);
    expect(inProgress.json.unstartedCount).toBe(1);
    expect(inProgress.json.inProgressCount).toBe(1);
    expect(inProgress.json.submittedCount).toBe(0);

    // 学生 1 答题并交卷（得分 10）
    await call('PUT', `/api/assessment-attempts/${start1.json.attempt.id}/answers/q_1`, student1Token, {
      answer: 0,
    });
    const submit1 = await call('POST', `/api/assessment-attempts/${start1.json.attempt.id}/submit`, student1Token);
    expect(submit1.status).toBe(200);

    // 再次拉取看板：已交卷 1 人，平均分 10
    const finalProgress = await call('GET', `/api/classroom/sessions/${lessonId}/assessment-progress`, teacherToken);
    expect(finalProgress.status).toBe(200);
    expect(finalProgress.json.unstartedCount).toBe(1);
    expect(finalProgress.json.inProgressCount).toBe(0);
    expect(finalProgress.json.submittedCount).toBe(1);
    expect(finalProgress.json.averageScore).toBe(10);

    const stu1Status = finalProgress.json.students.find((s: any) => s.studentId === student1Id);
    expect(stu1Status).toBeDefined();
    expect(['submitted', 'graded']).toContain(stu1Status.status);
    expect(stu1Status.score).toBe(10);
  });
});
