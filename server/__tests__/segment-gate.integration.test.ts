import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';
import { lessonActiveSegments } from '../shared-state.js';

describe('教学环节门槛（segment-access）', () => {
  let server: Server;
  let baseUrl: string;
  const lessonId = 'les-seg-gate-0001';
  const teacherId = 'usr-seg-gate-teacher';
  const studentId = 'stu-seg-gate-0001';
  const teacherToken = 'tok-seg-gate-teacher';
  const studentToken = 'tok-seg-gate-student';
  const pluginId = 'ext-seg-gate-test';
  const commandType = 'ext-seg-gate-test.judge';
  const actionId = 'act-seg-gate-test';
  const db = kernelContainer.db as any;
  const emitted: Array<{ room?: string; event: string; payload: unknown }> = [];

  const jsonHeaders = (token: string) => ({
    'Content-Type': 'application/json',
    Cookie: `edu_os_token=${token}`,
  });

  const post = (path: string, token: string, body?: Record<string, unknown>) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify(body ?? {}),
    });

  const timeline = [
    { id: 'seg-a', title: '导入' },
    {
      id: 'seg-b',
      title: '练习后',
      gates: [{ type: 'quiz_completed', params: { elementId: 'quiz-1' } }],
    },
  ];

  beforeAll(async () => {
    ensureTestSchema();
    const app = express();
    app.use(express.json());
    const io = {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          emitted.push({ room, event, payload });
        },
      }),
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
      },
    };
    const classroomService = new ClassroomRuntimeService(db, io as any);
    registerClassroomRoutes({ app, io } as any, classroomService);
    registerLessonsRoutes({ app } as any);

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'seg_gate_teacher', '环节教师', 'hash', 'teacher', now);
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, timeline, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(lessonId, '环节门槛课', teacherId, JSON.stringify(timeline), now, now);
    db.prepare('INSERT OR REPLACE INTO students (id, name, student_number, created_at) VALUES (?, ?, ?, ?)').run(
      studentId,
      '环节学生',
      'SG0001',
      now,
    );
    const sessionData = (userId: string, role: string, extra: Record<string, string> = {}) =>
      JSON.stringify({ userId, role, username: userId, name: userId, ...extra });
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(teacherToken, sessionData(teacherId, 'teacher'), now, now + 86400000);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(studentToken, sessionData(studentId, 'student', { studentId }), now, now + 86400000);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    try {
      kernelContainer.commandBus.unregisterHandler(commandType);
    } catch {
      /* 未注册 */
    }
    try {
      kernelContainer.actionRegistry.unregister(actionId);
    } catch {
      /* 未注册 */
    }
    for (const table of [
      'segment_visits',
      'segment_gate_overrides',
      'lesson_checkins',
      'lesson_quiz_submissions',
      'whiteboard_elements',
      'assignments',
      'assignment_submissions',
      'classroom_sessions',
    ]) {
      try {
        db.prepare(`DELETE FROM ${table} WHERE lesson_id = ?`).run(lessonId);
      } catch {
        /* 个别表没有 lesson_id */
      }
    }
    db.prepare('DELETE FROM assignment_submissions WHERE student_id = ?').run(studentId);
    db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(teacherToken, studentToken);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
    lessonActiveSegments.delete(lessonId);
  });

  async function follow(activeSegmentId: string) {
    const res = await post(`/api/classroom/sessions/${lessonId}/segment`, teacherToken, { activeSegmentId });
    expect(res.status).toBe(200);
  }

  async function access(token: string, targetSegmentId: string, studentIdOverride?: string) {
    const res = await post(`/api/lessons/${lessonId}/segment-access`, token, {
      targetSegmentId,
      ...(studentIdOverride ? { studentId: studentIdOverride } : {}),
    });
    const body = await res.json();
    return { status: res.status, body };
  }

  it('练习未完成时拒绝，提交后放行，并记下停留', async () => {
    db.prepare(
      'INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('quiz-1', lessonId, 'quiz', JSON.stringify({ segmentId: 'seg-a', correctAnswer: 'A' }), Date.now());

    const denied = await access(studentToken, 'seg-b');
    expect(denied.status).toBe(403);
    expect(denied.body.allowed).toBe(false);
    expect(denied.body.reason).toContain('练习尚未完成');
    expect(denied.body.visibleSegmentId).toBe('seg-a');
    expect(denied.body.gates[0].progress).toMatchObject({ current: 0, target: 1 });

    db.prepare(
      `INSERT INTO lesson_quiz_submissions
        (id, lesson_id, element_id, student_id, answer, score, is_correct, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sub-1', lessonId, 'quiz-1', studentId, 'A', 100, 1, Date.now());

    const allowed = await access(studentToken, 'seg-b');
    expect(allowed.status).toBe(200);
    expect(allowed.body.allowed).toBe(true);
    const visit = db
      .prepare('SELECT segment_id FROM segment_visits WHERE lesson_id = ? AND student_id = ? AND left_at IS NULL')
      .get(lessonId, studentId) as { segment_id: string };
    expect(visit.segment_id).toBe('seg-b');
  });

  it('教师推进全班环节后，学生不能自行换到别的环节', async () => {
    const moved = await post(`/api/classroom/sessions/${lessonId}/segment`, teacherToken, {
      activeSegmentId: 'seg-b',
    });
    expect(moved.status).toBe(200);
    expect(emitted.some((item) => item.event === 'student-active-segment-changed')).toBe(true);

    const off = await access(studentToken, 'seg-a');
    expect(off.status).toBe(403);
    expect(off.body.reason).toBe('请跟随课堂当前环节');
    expect(off.body.visibleSegmentId).toBe('seg-b');
    expect(off.body.classSegmentId).toBe('seg-b');
  });

  it('四阶段推进不读取环节条件', async () => {
    const stage = await post(`/api/classroom/sessions/${lessonId}/stage`, teacherToken, {
      stage: 'IN_CLASS_TEACHING',
    });
    expect(stage.status).toBe(200);
    const still = await access(studentToken, 'seg-other');
    expect(still.body.reason).toBe('请跟随课堂当前环节');
  });

  it('教师查看自己时跳过条件，预览学生时仍按学生判定', async () => {
    const self = await access(teacherToken, 'seg-b');
    expect(self.status).toBe(200);
    expect(self.body.bypass).toBe(true);

    db.prepare('DELETE FROM lesson_quiz_submissions WHERE lesson_id = ? AND student_id = ?').run(lessonId, studentId);
    const preview = await access(teacherToken, 'seg-b', studentId);
    expect(preview.status).toBe(403);
    expect(preview.body.allowed).toBe(false);
  });

  it('教师覆盖后放行，并写入审计事件', async () => {
    const saved = await post(`/api/classroom/sessions/${lessonId}/segment-overrides`, teacherToken, {
      studentId,
      segmentId: 'seg-b',
      reason: '当堂补做',
    });
    expect(saved.status).toBe(200);
    const allowed = await access(studentToken, 'seg-b');
    expect(allowed.body.allowed).toBe(true);
    expect(allowed.body.overridden).toBe(true);
    const audit = db
      .prepare(`SELECT type, payload FROM events WHERE type = ? AND payload LIKE ? ORDER BY timestamp DESC LIMIT 1`)
      .get('segment.gate_overridden', `%${lessonId}%`) as { type: string; payload: string };
    expect(audit.type).toBe('segment.gate_overridden');
    expect(audit.payload).toContain(studentId);
  });

  it('停留时长与签到读取新增的事实表', async () => {
    db.prepare('UPDATE lessons SET timeline = ? WHERE id = ?').run(
      JSON.stringify([
        { id: 'seg-a', title: '导入' },
        { id: 'seg-b', title: '下一环', gates: [{ type: 'dwell_seconds', params: { seconds: 30 } }] },
      ]),
      lessonId,
    );
    db.prepare('DELETE FROM segment_gate_overrides WHERE lesson_id = ?').run(lessonId);
    const now = Date.now();
    db.prepare(
      `INSERT INTO segment_visits (id, lesson_id, segment_id, student_id, entered_at, left_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('sv-short', lessonId, 'seg-a', studentId, now - 10_000, now);
    const short = await access(studentToken, 'seg-b');
    expect(short.body.allowed).toBe(false);
    expect(short.body.reason).toContain('停留时长不足');

    db.prepare('UPDATE lessons SET timeline = ? WHERE id = ?').run(
      JSON.stringify([
        { id: 'seg-a', title: '导入' },
        { id: 'seg-b', title: '下一环', gates: [{ type: 'checked_in', params: {} }] },
      ]),
      lessonId,
    );
    const absent = await access(studentToken, 'seg-b');
    expect(absent.body.reason).toContain('尚未签到');
    db.prepare('INSERT OR REPLACE INTO lesson_checkins (lesson_id, student_id, checked_in_at) VALUES (?, ?, ?)').run(
      lessonId,
      studentId,
      Date.now(),
    );
    const present = await access(studentToken, 'seg-b');
    expect(present.body.allowed).toBe(true);
  });

  it('作业提交与废弃的课级 gated 条件仍能回退判定', async () => {
    db.prepare(
      'INSERT OR REPLACE INTO assignments (id, class_id, lesson_id, title, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('hw-seg', 'cls-unused', lessonId, '环节作业', Date.now());
    db.prepare('UPDATE lessons SET timeline = ?, progress_mode = ?, progress_conditions = ? WHERE id = ?').run(
      JSON.stringify([
        { id: 'seg-a', title: '导入', assignmentIds: ['hw-seg'] },
        { id: 'seg-b', title: '下一环', gates: [{ type: 'assignment_submitted', params: {} }] },
      ]),
      'manual',
      null,
      lessonId,
    );
    const missing = await access(studentToken, 'seg-b');
    expect(missing.body.allowed).toBe(false);
    db.prepare(
      `INSERT OR REPLACE INTO assignment_submissions (assignment_id, student_id, content, submitted_at, status)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('hw-seg', studentId, 'done', Date.now(), 'submitted');
    const sent = await access(studentToken, 'seg-b');
    expect(sent.body.allowed).toBe(true);

    db.prepare('UPDATE lessons SET timeline = ?, progress_mode = ?, progress_conditions = ? WHERE id = ?').run(
      JSON.stringify([
        { id: 'seg-a', title: '导入' },
        { id: 'seg-b', title: '下一环' },
      ]),
      'gated',
      JSON.stringify({ minQuizScore: 80 }),
      lessonId,
    );
    db.prepare('DELETE FROM lesson_quiz_submissions WHERE lesson_id = ?').run(lessonId);
    db.prepare(
      'INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('quiz-legacy', lessonId, 'quiz', JSON.stringify({ segmentId: 'seg-a', correctAnswer: 'B' }), Date.now());
    await follow('seg-b');
    const legacyDenied = await access(studentToken, 'seg-b');
    expect(legacyDenied.body.usedDeprecatedProgressConditions).toBe(true);
    expect(legacyDenied.body.allowed).toBe(false);
    await follow('seg-a');
    const first = await access(studentToken, 'seg-a');
    expect(first.body.allowed).toBe(true);
  });

  it('插件用只读命令判定，未知类型拒绝', async () => {
    db.prepare('UPDATE lessons SET timeline = ?, progress_mode = ? WHERE id = ?').run(
      JSON.stringify([
        { id: 'seg-a', title: '导入' },
        { id: 'seg-b', title: '下一环', gates: [{ type: 'custom_mastery', params: { need: 1 } }] },
      ]),
      'manual',
      lessonId,
    );
    await follow('seg-b');
    const unknown = await access(studentToken, 'seg-b');
    expect(unknown.body.allowed).toBe(false);
    expect(unknown.body.reason).toContain('未知条件类型');

    const manifest = {
      id: pluginId,
      name: '门槛插件',
      version: '1.0.0',
      contributes: {
        'segment.gate_type': [{ id: 'custom_mastery', commandType: 'judge', labelZh: '掌握度', labelEn: 'Mastery' }],
      },
    };
    db.prepare(
      'INSERT OR REPLACE INTO plugins (id, name, manifest, source_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(pluginId, '门槛插件', JSON.stringify(manifest), 'export default {}', 'active', Date.now());
    kernelContainer.actionRegistry.register({
      id: actionId,
      commandType,
      description: '测试用环节条件',
      capabilityRequired: 'segment:gate_eval',
      exposeToAgent: false,
      inputSchema: { type: 'object' },
    });
    let allow = false;
    kernelContainer.commandBus.registerHandler(commandType, {
      execute: async (cmd) => {
        const payload = cmd.payload as { readOnly?: boolean };
        expect(payload.readOnly).toBe(true);
        expect(cmd.actorId).toBe('system:segment-gate');
        return allow
          ? { allowed: true }
          : { allowed: false, reason: '插件条件未满足', progress: { current: 1, target: 2, unit: '次' } };
      },
    });

    const denied = await access(studentToken, 'seg-b');
    expect(denied.body.allowed).toBe(false);
    expect(denied.body.reason).toContain('插件条件未满足');
    expect(denied.body.gates[0].progress).toMatchObject({ current: 1, target: 2 });

    allow = true;
    const passed = await access(studentToken, 'seg-b');
    expect(passed.body.allowed).toBe(true);
  });
});
