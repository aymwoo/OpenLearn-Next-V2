/**
 * 课堂会话保存与恢复（Session Persistence & Resume）E2E
 *
 * 场景：教师上课 → 产生各类课堂动态（落 classroom_feed）→ 教师离开
 * （不发任何请求，不清理任何状态）→ 重进课堂（换一个全新的 HTTP 客户端，
 * 模拟换设备/刷新页面）→ 通过恢复协议 GET /api/classroom/sessions/:lessonId
 * 一次性拿回：stage / started_at / 当前白板页 / 当前环节 / 动态流回放。
 *
 * 覆盖：
 *  - feed 服务事件订阅 → classroom_feed 落表 → 回放（M1）
 *  - view-state 回写端点（currentPage / activeSegmentId）→ 恢复读取（P1/P2）
 *  - 无会话 / 已归档边界
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { ClassroomFeedService, attachClassroomFeedService } from '../services/classroom-feed-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import type { Server as SocketIOServer } from 'socket.io';

const teacherToken = 'tok-resume-teacher-001';
const teacherId = 'usr-resume-teacher';
const classId = 'cls-resume-001';
let lessonId: string;
let app: express.Express;
let server: Server;
let baseUrl: string;
let feedService: ClassroomFeedService;

const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}`, 'Content-Type': 'application/json' });

beforeAll(async () => {
  const db = kernelContainer.db;
  const now = Date.now();

  db.prepare(
    'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(teacherToken, JSON.stringify({ userId: teacherId, role: 'teacher', username: 'resume_teacher' }), now, now + 3600_000);
  db.prepare(
    'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(classId, '恢复E2E班', '会话恢复测试', 'pass-resume', now);

  lessonId = `lesson-resume-${now}`;
  db.prepare(
    'INSERT OR REPLACE INTO lessons (id, title, content, timeline, progress_mode, progress_conditions, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(lessonId, '恢复E2E课', null, null, 'manual', null, teacherId, now, now);

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const token = req.headers.cookie?.match?.(/edu_os_token=([^;]+)/)?.[1];
    if (token === teacherToken) {
      (req as any).session = { userId: teacherId, role: 'teacher', username: 'resume_teacher' };
    }
    next();
  });

  const runtime = new ClassroomRuntimeService(db, { emit: () => {}, to: () => ({ emit: () => {} }) } as unknown as SocketIOServer);
  feedService = new ClassroomFeedService(db, { emit: () => {}, to: () => ({ emit: () => {} }) } as unknown as SocketIOServer);
  attachClassroomFeedService(feedService, kernelContainer.eventBus as any);
  registerClassroomRoutes({ app, io: { emit: () => {}, to: () => ({ emit: () => {} }) } } as any, runtime, feedService);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const db = kernelContainer.db;
  db.prepare('DELETE FROM classroom_feed WHERE lesson_id = ?').run(lessonId);
  db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
  db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
  db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
  db.prepare('DELETE FROM client_sessions WHERE id = ?').run(teacherToken);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('课堂会话保存与恢复', () => {
  let countdownEndsAt: number;

  it('教师开课并产生课堂痕迹（阶段/页码/环节/动态）', async () => {
    // 1) 初始化会话（进入 IN_CLASS_TEACHING）
    const initRes = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/init`, {
      method: 'POST',
      headers: cookie(teacherToken),
      body: JSON.stringify({ classId }),
    });
    expect(initRes.status).toBe(200);
    const stageRes = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/stage`, {
      method: 'POST',
      headers: cookie(teacherToken),
      body: JSON.stringify({ stage: 'IN_CLASS_TEACHING', classId }),
    });
    expect(stageRes.status).toBe(200);

    // 2) 回写视图状态：切到第 2 页 + 切到环节 seg-abc
    const vs = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/view-state`, {
      method: 'POST',
      headers: cookie(teacherToken),
      body: JSON.stringify({ currentPage: 2, activeSegmentId: 'seg-abc' }),
    });
    expect(vs.status).toBe(200);

    // 3) 课堂动态：通过内核事件总线发布（feed 服务订阅落表）
    await kernelContainer.eventBus.publish({
      id: 'evt-feed-1',
      type: 'whiteboard.quiz_answered',
      source: 'test',
      payload: { lessonId, studentId: 'stu-1', studentName: '小明' },
      timestamp: Date.now(),
    } as any);
    await kernelContainer.eventBus.publish({
      id: 'evt-feed-2',
      type: 'points.awarded',
      source: 'test',
      payload: { lessonId, studentId: 'stu-2', studentName: '小红' },
      timestamp: Date.now(),
    } as any);

    // 4) 倒计时也回写（既有链路，验证恢复一致性）
    const cd = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/countdown`, {
      method: 'POST',
      headers: cookie(teacherToken),
      body: JSON.stringify({ action: 'start', duration: 600, label: '随堂小测' }),
    });
    const cdBody = await cd.json();
    countdownEndsAt = cdBody.countdown?.endsAt;
    expect(cdBody.success).toBe(true);

    // feed 落表验证（异步订阅可能有微秒级延迟，轮询至多 1s）
    let count = 0;
    for (let i = 0; i < 10; i++) {
      count = feedService.countByLesson(lessonId);
      if (count >= 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('教师离开后重进：恢复协议一次性拿回全部现场', async () => {
    // 「全新客户端」重进 —— 不复用任何本地状态，仅靠服务端
    const res = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}`, {
      headers: { Cookie: `edu_os_token=${teacherToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    // 阶段与开始时间恢复
    expect(data.hasActiveSession).toBe(true);
    expect(data.stage).toBe('IN_CLASS_TEACHING');
    expect(data.session.started_at).toBeGreaterThan(0);

    // 白板页码恢复
    expect(data.viewState.currentPage).toBe(2);
    // 环节恢复
    expect(data.session.current_segment_id).toBe('seg-abc');
    // 动态流回放（升序，含两条测试动态且文案可读）
    expect(Array.isArray(data.feedReplay)).toBe(true);
    expect(data.feedReplay.length).toBeGreaterThanOrEqual(2);
    const messages = data.feedReplay.map((f: any) => f.message);
    expect(messages.some((m: string) => m.includes('小明'))).toBe(true);
    expect(messages.some((m: string) => m.includes('小红'))).toBe(true);
    // 倒计时恢复（settings_json 兜底）
    expect(data.activeCountdown?.label).toBe('随堂小测');
    expect(data.activeCountdown?.endsAt).toBe(countdownEndsAt);
  });

  it('view-state 校验：非法页码 400；无会话课时 404', async () => {
    const bad = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/view-state`, {
      method: 'POST',
      headers: cookie(teacherToken),
      body: JSON.stringify({ currentPage: -5 }),
    });
    expect(bad.status).toBe(400);

    const missing = await fetch(`${baseUrl}/api/classroom/sessions/lesson-no-session/view-state`, {
      method: 'POST',
      headers: cookie(teacherToken),
      body: JSON.stringify({ currentPage: 1 }),
    });
    expect(missing.status).toBe(404);
  });

  it('无会话课程：hasActiveSession=false 且不返回恢复字段（前端可安全渲染）', async () => {
    const res = await fetch(`${baseUrl}/api/classroom/sessions/lesson-never-opened`, {
      headers: { Cookie: `edu_os_token=${teacherToken}` },
    });
    const data = await res.json();
    expect(data.hasActiveSession).toBe(false);
    expect(data.feedReplay).toBeUndefined(); // 无会话分支不返回恢复字段
  });
});
