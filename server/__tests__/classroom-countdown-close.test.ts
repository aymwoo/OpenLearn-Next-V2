import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';
import { activeCountdowns, type ActiveCountdownState } from '../shared-state.js';
import type { ServerContext } from '../context.js';

/** 广播里与「关闭」相关的字段（其余字段断言不依赖，保持宽松结构类型即可） */
type CountdownBroadcastPayload = {
  lessonId?: string;
  dismissed?: boolean;
};

type CountdownResponse = {
  success: boolean;
  countdown: ActiveCountdownState;
};

/**
 * 课堂倒计时「关闭」动作的服务端契约：
 * - 关闭后停表、剩余时间回退到总时长，并置 `dismissed: true` 持久化；
 * - 状态经 `classroom:countdown_updated` 广播，学生端据此隐藏横幅；
 * - 重新 start 会清除 `dismissed`，学生端可再次看到倒计时。
 */
describe('课堂倒计时关闭动作（服务端持久化 + 广播）', () => {
  let server: Server;
  let baseUrl: string;

  const db = kernelContainer.db;
  const teacherId = 'usr-cd-close';
  const teacherToken = 'tok-cd-close';
  const classId = 'cls-cd-close';
  const lessonId = 'les-cd-close';

  const emitted: Array<{ rooms: string[]; event: string; payload: CountdownBroadcastPayload }> = [];
  const fakeIo = {
    to: (rooms: string | string[]) => ({
      emit: (event: string, payload: CountdownBroadcastPayload) => {
        emitted.push({ rooms: Array.isArray(rooms) ? rooms : [rooms], event, payload });
      },
    }),
  };

  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { Cookie: `edu_os_token=${teacherToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const postCountdown = async (body: unknown) => {
    const res = await call('POST', `/api/classroom/sessions/${lessonId}/countdown`, body);
    expect(res.status).toBe(200);
    const json = (await res.json()) as CountdownResponse;
    expect(json.success).toBe(true);
    return json.countdown;
  };

  const getCountdown = async () => {
    const res = await call('GET', `/api/classroom/sessions/${lessonId}/countdown`);
    expect(res.status).toBe(200);
    return ((await res.json()) as CountdownResponse).countdown;
  };

  beforeAll(async () => {
    ensureTestSchema();

    const app = express();
    app.use(express.json());
    registerClassroomRoutes({ app, io: fakeIo } as unknown as ServerContext, new ClassroomRuntimeService(db));

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'cd_close_teacher', 'cd_close_teacher', 'hash', 'teacher', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'cd_close_teacher', name: 'cd_close_teacher' }),
      now,
      now + 86400000,
    );
    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classId,
      '倒计时关闭测试班',
      teacherId,
      now,
    );
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(lessonId, '倒计时关闭测试课', teacherId, now, now);

    const initRes = await call('POST', `/api/classroom/sessions/${lessonId}/init`, { classId });
    expect(initRes.status).toBe(200);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    activeCountdowns.delete(lessonId);
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(teacherToken);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
  });

  it('start → close 停表回位并广播 dismissed，重新 start 清除 dismissed', async () => {
    // 1. 教师发起倒计时
    const started = await postCountdown({ action: 'start', duration: 300, label: '关闭验证' });
    expect(started.isRunning).toBe(true);
    expect(started.dismissed).toBe(false);
    expect(started.timeRemaining).toBe(300);

    // 2. 关闭：停表 + 剩余时间回到总时长 + dismissed
    emitted.length = 0;
    const closed = await postCountdown({ action: 'close' });
    expect(closed.isRunning).toBe(false);
    expect(closed.isPaused).toBe(false);
    expect(closed.endsAt).toBeNull();
    expect(closed.timeRemaining).toBe(closed.totalDuration);
    expect(closed.dismissed).toBe(true);

    const broadcast = emitted.find((e) => e.event === 'classroom:countdown_updated');
    expect(broadcast).toBeDefined();
    expect(broadcast!.payload.dismissed).toBe(true);
    expect(broadcast!.payload.lessonId).toBe(lessonId);

    // 3. 持久化：GET 与 settings_json 都能读到 dismissed（学生刷新/重连不再弹出）
    const fetched = await getCountdown();
    expect(fetched.dismissed).toBe(true);
    const sessionRow = db
      .prepare('SELECT settings_json FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(lessonId) as { settings_json: string } | undefined;
    expect(sessionRow).toBeDefined();
    expect(JSON.parse(sessionRow!.settings_json).countdown.dismissed).toBe(true);

    // 4. 重新发起：dismissed 清除，学生端横幅恢复
    const restarted = await postCountdown({ action: 'start', duration: 120, label: '第二轮' });
    expect(restarted.isRunning).toBe(true);
    expect(restarted.dismissed).toBe(false);
    expect(restarted.timeRemaining).toBe(120);
  });

  it('暂停后关闭同样是「停表 + 回位」，reset 不改变 dismissed 归属', async () => {
    await postCountdown({ action: 'start', duration: 300, label: '暂停后关闭' });
    const paused = await postCountdown({ action: 'pause' });
    expect(paused.isPaused).toBe(true);
    expect(paused.dismissed).toBe(false);

    const closed = await postCountdown({ action: 'close' });
    expect(closed.isPaused).toBe(false);
    expect(closed.isRunning).toBe(false);
    expect(closed.dismissed).toBe(true);

    // reset 只回零，不会把已关闭的倒计时重新「打开」
    const reset = await postCountdown({ action: 'reset' });
    expect(reset.isRunning).toBe(false);
    expect(reset.timeRemaining).toBe(reset.totalDuration);
    expect(reset.dismissed).toBe(true);
  });
});
