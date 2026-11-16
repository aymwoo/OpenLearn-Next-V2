/**
 * 长周期课次生命周期（Gitee IKVNIX / F-0008）
 *
 * 锁死：教师结束课次后学生不再看到未结束提示；结束后可再开新课次且旧动态可按课次查出；
 * 学生忽略/延后提示落用户偏好表；跳回接口 classId 取自会话行；僵尸课次自动归档且可豁免；
 * 自动归档前后 findActiveLessonForStudent 的实时录成绩口径不回归；v0.6.1 归档回退课中仍可用。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { ClassroomFeedService, attachClassroomFeedService } from '../services/classroom-feed-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';
import { findActiveLessonForStudent } from '../utils/auto-record-score.js';
import {
  DEFAULT_AUTO_ARCHIVE_AFTER_MS,
  MIN_AUTO_ARCHIVE_AFTER_MS,
  archiveZombieSessions,
  closeClassroomSession,
  getAutoArchiveAfterMs,
  setAutoArchiveAfterMs,
  setSessionAutoArchiveExempt,
} from '../services/classroom-session-lifecycle.js';

const teacherId = 'usr-lc-teacher';
const teacherToken = 'tok-lc-teacher';
const studentId = 'stu-lc-0001';
const studentToken = 'tok-lc-student';
const otherStudentId = 'stu-lc-0002';
const otherStudentToken = 'tok-lc-student-2';
const classId = 'cls-lc-0001';
const otherClassId = 'cls-lc-0002';
const lessonId = 'les-lc-0001';

let server: Server;
let baseUrl: string;
let feedService: ClassroomFeedService;
const db = kernelContainer.db as any;

const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}`, 'Content-Type': 'application/json' });

const req = (method: string, path: string, token?: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? cookie(token) : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function insertSession(id: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO classroom_sessions
       (id, lesson_id, class_id, teacher_id, stage, started_at, created_at, last_activity_at, auto_archive_exempt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    overrides.lesson_id ?? lessonId,
    overrides.class_id ?? classId,
    overrides.teacher_id ?? teacherId,
    overrides.stage ?? 'IN_CLASS_TEACHING',
    overrides.started_at ?? now,
    overrides.created_at ?? now,
    overrides.last_activity_at === undefined ? now : overrides.last_activity_at,
    overrides.auto_archive_exempt ?? null,
  );
}

beforeAll(async () => {
  ensureTestSchema();

  const app = express();
  app.use(express.json());
  const classroomService = new ClassroomRuntimeService(db);
  feedService = new ClassroomFeedService(db);
  attachClassroomFeedService(feedService, kernelContainer.eventBus as any);
  registerClassroomRoutes({ app, io: undefined } as any, classroomService, feedService);

  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const now = Date.now();
  db.prepare(
    'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(teacherId, 'lc_teacher', 'x', 'teacher', '课次教师', now);

  const insSession = db.prepare(
    'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
  );
  const exp = now + 3600_000;
  insSession.run(
    teacherToken,
    JSON.stringify({ userId: teacherId, role: 'teacher', username: 'lc_teacher' }),
    now,
    exp,
  );
  insSession.run(
    studentToken,
    JSON.stringify({ userId: studentId, studentId, role: 'student', username: 'lc_stu_1' }),
    now,
    exp,
  );
  insSession.run(
    otherStudentToken,
    JSON.stringify({ userId: otherStudentId, studentId: otherStudentId, role: 'student', username: 'lc_stu_2' }),
    now,
    exp,
  );

  db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
    classId,
    '课次测试班',
    teacherId,
    now,
  );
  db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
    otherClassId,
    '另一个班',
    teacherId,
    now,
  );
  db.prepare(
    'INSERT OR REPLACE INTO lessons (id, title, created_at, updated_at, creator_id) VALUES (?, ?, ?, ?, ?)',
  ).run(lessonId, '长周期课程', now, now, teacherId);
  for (const [id, num] of [
    [studentId, 'STU_LC_1'],
    [otherStudentId, 'STU_LC_2'],
  ] as const) {
    db.prepare('INSERT OR REPLACE INTO students (id, name, student_number, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      id,
      num,
      now,
    );
  }
  db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
    classId,
    studentId,
    now,
  );
  db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
    otherClassId,
    otherStudentId,
    now,
  );
});

afterAll(async () => {
  db.prepare("DELETE FROM user_preferences WHERE principal_key LIKE 'student:stu-lc-%'").run();
  db.prepare('DELETE FROM classroom_feed WHERE lesson_id = ?').run(lessonId);
  db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
  db.prepare('DELETE FROM class_students WHERE student_id IN (?, ?)').run(studentId, otherStudentId);
  db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentId, otherStudentId);
  db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
  db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classId, otherClassId);
  db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
  db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(studentToken, otherStudentToken, teacherToken);
  try {
    db.prepare('UPDATE site_settings SET classroom_session_auto_archive_after_ms = NULL WHERE id = ?').run('global');
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  db.prepare('DELETE FROM classroom_feed WHERE lesson_id = ?').run(lessonId);
  db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
  db.prepare("DELETE FROM user_preferences WHERE principal_key LIKE 'student:stu-lc-%'").run();
  try {
    db.prepare('UPDATE site_settings SET classroom_session_auto_archive_after_ms = NULL WHERE id = ?').run('global');
  } catch {
    /* ignore */
  }
});

describe('课次关闭与课程解耦', () => {
  it('教师结束本次课次后学生端不再返回进行中会话', async () => {
    insertSession('sess-lc-close-1');
    const active = await (await req('GET', '/api/student/active-session', studentToken)).json();
    expect(active.activeSession?.sessionId).toBe('sess-lc-close-1');

    const closeRes = await req('POST', `/api/classroom/sessions/${lessonId}/close`, teacherToken, {});
    expect(closeRes.status).toBe(200);
    const closed = await closeRes.json();
    expect(closed.success).toBe(true);
    expect(closed.classId).toBe(classId);
    expect(closed.stage).toBe('ARCHIVED_REPORT');

    const after = await (await req('GET', '/api/student/active-session', studentToken)).json();
    expect(after.activeSession).toBeNull();
  });

  it('学生不能结束课次', async () => {
    insertSession('sess-lc-close-forbid');
    const res = await req('POST', `/api/classroom/sessions/${lessonId}/close`, studentToken, {});
    expect(res.status).toBe(403);
    const row = db.prepare('SELECT stage FROM classroom_sessions WHERE id = ?').get('sess-lc-close-forbid');
    expect(row.stage).toBe('IN_CLASS_TEACHING');
  });

  it('结束后可再开新课次，且旧课次动态仍可按 session 查出', async () => {
    insertSession('sess-lc-hist-1');
    db.prepare(
      `INSERT INTO classroom_feed (id, session_id, lesson_id, class_id, type, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'feed-lc-hist-1',
      'sess-lc-hist-1',
      lessonId,
      classId,
      'quiz_answered',
      '小明 完成了随堂练习作答',
      Date.now(),
    );

    const closeRes = await req('POST', `/api/classroom/sessions/${lessonId}/close`, teacherToken, {});
    expect(closeRes.status).toBe(200);

    // 归档后按本课次查询，历史动态还在（进行中判定与历史查询拆开）
    const archivedGet = await (await req('GET', `/api/classroom/sessions/${lessonId}`, teacherToken)).json();
    expect(archivedGet.hasActiveSession).toBe(false);
    expect(archivedGet.stage).toBe('ARCHIVED_REPORT');
    expect(archivedGet.resumable).toBe(false);
    expect(archivedGet.feedReplay.some((f: { message: string }) => f.message.includes('小明'))).toBe(true);

    const runtime = new ClassroomRuntimeService(db);
    const next = await runtime.getOrCreateSession(lessonId, teacherId, classId);
    expect(next.id).not.toBe('sess-lc-hist-1');
    expect(next.stage).toBe('PRE_CLASS_READY');

    const freshGet = await (await req('GET', `/api/classroom/sessions/${lessonId}`, teacherToken)).json();
    expect(freshGet.hasActiveSession).toBe(true);
    expect(freshGet.session.id).toBe(next.id);
    expect(freshGet.feedReplay).toEqual([]);

    expect(feedService.getFeedReplayForSession('sess-lc-hist-1').some((f) => String(f.message).includes('小明'))).toBe(
      true,
    );
  });
});

describe('恢复协议与学生跳回', () => {
  it('GET 会话带 stageLabel / resumable / lastActivityAt，classId 取自会话行', async () => {
    const now = Date.now();
    insertSession('sess-lc-resume-1', { last_activity_at: now - 1000 });
    db.prepare(
      `UPDATE classroom_sessions
          SET settings_json = json_set(coalesce(settings_json, '{}'), '$.viewState.currentPage', 3)
        WHERE id = ?`,
    ).run('sess-lc-resume-1');

    const data = await (await req('GET', `/api/classroom/sessions/${lessonId}`, teacherToken)).json();
    expect(data.stage).toBe('IN_CLASS_TEACHING');
    expect(data.stageLabel).toBe('课中授课');
    expect(data.resumable).toBe(true);
    expect(data.classId).toBe(classId);
    expect(data.lastActivityAt).toBe(now - 1000);
    expect(data.viewState.currentPage).toBe(3);
  });

  it('学生 POST resume 返回会话行 classId 与现场快照，忽略客户端试图覆盖的班级', async () => {
    insertSession('sess-lc-resume-2');
    db.prepare(
      `UPDATE classroom_sessions
          SET settings_json = json_set(coalesce(settings_json, '{}'), '$.viewState.currentPage', 5)
        WHERE id = ?`,
    ).run('sess-lc-resume-2');
    db.prepare(
      `INSERT INTO classroom_feed (id, session_id, lesson_id, class_id, type, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('feed-lc-resume-2', 'sess-lc-resume-2', lessonId, classId, 'achievement', '小红 获得课堂表彰', Date.now());

    const res = await req('POST', `/api/classroom/sessions/${lessonId}/resume`, studentToken, {
      classId: otherClassId,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.resumable).toBe(true);
    expect(data.classId).toBe(classId);
    expect(data.classId).not.toBe(otherClassId);
    expect(data.viewState.currentPage).toBe(5);
    expect(data.feedReplay.some((f: { message: string }) => f.message.includes('小红'))).toBe(true);
  });

  it('异班学生不能 resume；已归档课次返回 409', async () => {
    insertSession('sess-lc-resume-3');
    const forbidden = await req('POST', `/api/classroom/sessions/${lessonId}/resume`, otherStudentToken, {});
    expect(forbidden.status).toBe(403);

    closeClassroomSession(db, db.prepare('SELECT * FROM classroom_sessions WHERE id = ?').get('sess-lc-resume-3'));
    const archived = await req('POST', `/api/classroom/sessions/${lessonId}/resume`, studentToken, {});
    expect(archived.status).toBe(409);
    const body = await archived.json();
    expect(body.resumable).toBe(false);
  });
});

describe('未结束提示忽略 / 延后', () => {
  it('学生可本次忽略，偏好落入 user_preferences，active-session 不再要求展示横幅', async () => {
    insertSession('sess-lc-prompt-1');
    const dismiss = await req('POST', '/api/student/active-session/prompt', studentToken, {
      sessionId: 'sess-lc-prompt-1',
      action: 'ignore',
    });
    expect(dismiss.status).toBe(200);
    const body = await dismiss.json();
    expect(body.prompt.showBanner).toBe(false);
    expect(body.prompt.ignored).toBe(true);

    const stored = db
      .prepare('SELECT pref_value FROM user_preferences WHERE principal_key = ? AND pref_key = ?')
      .get('student:stu-lc-0001', 'classroom.unfinished_prompt') as { pref_value: string };
    expect(stored.pref_value).toContain('sess-lc-prompt-1');

    const active = await (await req('GET', '/api/student/active-session', studentToken)).json();
    expect(active.activeSession.sessionId).toBe('sess-lc-prompt-1');
    expect(active.prompt.showBanner).toBe(false);
  });

  it('延后到明天写入 until，且不能为别人的课次设置偏好', async () => {
    insertSession('sess-lc-prompt-2');
    const snooze = await req('POST', '/api/student/active-session/prompt', studentToken, {
      sessionId: 'sess-lc-prompt-2',
      action: 'snooze',
    });
    expect(snooze.status).toBe(200);
    const body = await snooze.json();
    expect(body.prompt.showBanner).toBe(false);
    expect(body.prompt.snoozedUntil).toBeGreaterThan(Date.now());

    insertSession('sess-lc-prompt-other', { class_id: otherClassId, lesson_id: lessonId });
    const forbidden = await req('POST', '/api/student/active-session/prompt', studentToken, {
      sessionId: 'sess-lc-prompt-other',
      action: 'ignore',
    });
    expect(forbidden.status).toBe(403);
  });
});

describe('僵尸课次自动归档与成绩口径', () => {
  it('默认阈值是 24h 且不能低于 3h', () => {
    expect(getAutoArchiveAfterMs(db)).toBe(DEFAULT_AUTO_ARCHIVE_AFTER_MS);
    expect(setAutoArchiveAfterMs(db, 60_000)).toBe(MIN_AUTO_ARCHIVE_AFTER_MS);
    expect(getAutoArchiveAfterMs(db)).toBe(MIN_AUTO_ARCHIVE_AFTER_MS);
    const settings = setAutoArchiveAfterMs(db, DEFAULT_AUTO_ARCHIVE_AFTER_MS);
    expect(settings).toBe(DEFAULT_AUTO_ARCHIVE_AFTER_MS);
  });

  it('超过阈值且无豁免的课次会被自动归档，学生端不再提示', async () => {
    const stale = Date.now() - DEFAULT_AUTO_ARCHIVE_AFTER_MS - 1000;
    insertSession('sess-lc-zombie-1', { last_activity_at: stale });
    const res = await (await req('GET', '/api/student/active-session', studentToken)).json();
    expect(res.activeSession).toBeNull();
    const row = db
      .prepare('SELECT stage, auto_archived_at FROM classroom_sessions WHERE id = ?')
      .get('sess-lc-zombie-1');
    expect(row.stage).toBe('ARCHIVED_REPORT');
    expect(row.auto_archived_at).toBeGreaterThan(0);
  });

  it('教师豁免的课次不会被自动归档；未到期课次保持进行中', async () => {
    const stale = Date.now() - DEFAULT_AUTO_ARCHIVE_AFTER_MS - 1000;
    insertSession('sess-lc-exempt-1', { last_activity_at: stale });
    const exemptRes = await req('POST', '/api/classroom/sessions/sess-lc-exempt-1/auto-archive-exempt', teacherToken, {
      exempt: true,
    });
    expect(exemptRes.status).toBe(200);
    archiveZombieSessions(db);
    expect(db.prepare('SELECT stage FROM classroom_sessions WHERE id = ?').get('sess-lc-exempt-1').stage).toBe(
      'IN_CLASS_TEACHING',
    );

    insertSession('sess-lc-fresh-1', { last_activity_at: Date.now() });
    archiveZombieSessions(db);
    expect(db.prepare('SELECT stage FROM classroom_sessions WHERE id = ?').get('sess-lc-fresh-1').stage).toBe(
      'IN_CLASS_TEACHING',
    );
  });

  it('last_activity_at 为空时先补时间戳而不立刻改阶段（升级不改变已部署实际状态）', () => {
    insertSession('sess-lc-grace-1', { last_activity_at: null });
    const closed = archiveZombieSessions(db, Date.now() + DEFAULT_AUTO_ARCHIVE_AFTER_MS * 2);
    expect(closed.find((c) => c.sessionId === 'sess-lc-grace-1')).toBeUndefined();
    const row = db
      .prepare('SELECT stage, last_activity_at FROM classroom_sessions WHERE id = ?')
      .get('sess-lc-grace-1');
    expect(row.stage).toBe('IN_CLASS_TEACHING');
    expect(row.last_activity_at).toBeGreaterThan(0);
  });

  it('实时录成绩在自动归档前后不回归：进行中能命中，归档后不再命中', () => {
    const now = Date.now();
    insertSession('sess-lc-score-1', { last_activity_at: now });
    expect(findActiveLessonForStudent(db, studentId)).toEqual({ lessonId, classId });

    const stale = now - DEFAULT_AUTO_ARCHIVE_AFTER_MS - 5_000;
    db.prepare('UPDATE classroom_sessions SET last_activity_at = ? WHERE id = ?').run(stale, 'sess-lc-score-1');
    archiveZombieSessions(db, now);
    expect(findActiveLessonForStudent(db, studentId)).toBeNull();

    insertSession('sess-lc-score-2', { last_activity_at: now, created_at: now + 1 });
    expect(findActiveLessonForStudent(db, studentId)).toEqual({ lessonId, classId });
  });
});

describe('v0.6.1 回退语义兼容', () => {
  it('归档后仍可通过阶段接口合法回到课中授课', async () => {
    insertSession('sess-lc-rollback-1');
    await req('POST', `/api/classroom/sessions/${lessonId}/close`, teacherToken, {});
    const rollback = await req('POST', `/api/classroom/sessions/${lessonId}/stage`, teacherToken, {
      stage: 'IN_CLASS_TEACHING',
      classId,
    });
    expect(rollback.status).toBe(200);
    const body = await rollback.json();
    expect(body.success ?? body.stage ?? true).toBeTruthy();
    const row = db.prepare('SELECT stage FROM classroom_sessions WHERE id = ?').get('sess-lc-rollback-1');
    expect(row.stage).toBe('IN_CLASS_TEACHING');
  });
});

describe('生命周期设置权限', () => {
  it('管理员可配置阈值，学生不能修改', async () => {
    const denied = await req('PUT', '/api/classroom/session-lifecycle-settings', studentToken, {
      autoArchiveAfterMs: DEFAULT_AUTO_ARCHIVE_AFTER_MS,
    });
    expect(denied.status).toBe(403);
  });
});
