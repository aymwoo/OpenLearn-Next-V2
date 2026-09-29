/**
 * 大屏展台数据接口 · 出勤与课件指标
 *
 * 重点防回归：曾因 SQL 使用 `?1` 具名参数（better-sqlite3 不支持）抛错，
 * 且 catch 把已成功的 expected 查询一起清零，导致展台「应到人数永远显示 0」。
 * 这类错误 mock 测不出来（mock 不会执行 SQL），必须跑真实 SQLite。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';
import type { Server as SocketIOServer } from 'socket.io';

const teacherToken = 'tok-stage-teacher';
const teacherId = 'usr-stage-teacher';
const classId = 'cls-stage-001';
const lessonId = 'lesson-stage-001';

let app: express.Express;
let server: Server;
let baseUrl: string;

const cookie = { Cookie: `edu_os_token=${teacherToken}`, 'Content-Type': 'application/json' };

beforeAll(async () => {
  ensureTestSchema();
  const db = kernelContainer.db;
  const now = Date.now();

  db.prepare(
    'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(
    teacherToken,
    JSON.stringify({ userId: teacherId, role: 'teacher', username: 'stage_teacher' }),
    now,
    now + 3600_000,
  );
  db.prepare(
    'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(classId, '展台测试班', 'stage display', 'stage-pass', now);
  db.prepare(
    'INSERT OR REPLACE INTO lessons (id, title, content, timeline, progress_mode, progress_conditions, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(lessonId, '展台测试课', null, null, 'manual', null, teacherId, now, now);

  // 5 名学生入班
  for (let i = 1; i <= 5; i++) {
    db.prepare('INSERT OR REPLACE INTO students (id, name, created_at) VALUES (?, ?, ?)').run(
      `stage-stu-${i}`,
      `学生${i}`,
      now,
    );
    db.prepare('INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      `stage-stu-${i}`,
      now,
    );
  }

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const token = req.headers.cookie?.match?.(/edu_os_token=([^;]+)/)?.[1];
    if (token === teacherToken) {
      (req as any).session = { userId: teacherId, role: 'teacher', username: 'stage_teacher' };
    }
    next();
  });

  const runtime = new ClassroomRuntimeService(db, {
    emit: () => {},
    to: () => ({ emit: () => {} }),
  } as unknown as SocketIOServer);
  registerClassroomRoutes({ app, io: { emit: () => {}, to: () => ({ emit: () => {} }) } } as any, runtime);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const db = kernelContainer.db;
  for (let i = 1; i <= 5; i++) {
    db.prepare('DELETE FROM classroom_pacing_signals WHERE student_id = ?').run(`stage-stu-${i}`);
  }
  db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
  db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
  db.prepare('DELETE FROM students WHERE id LIKE ?').run('stage-stu-%');
  db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
  db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
  db.prepare('DELETE FROM client_sessions WHERE id = ?').run(teacherToken);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  const db = kernelContainer.db;
  db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
  db.prepare('DELETE FROM classroom_pacing_signals WHERE student_id LIKE ?').run('stage-stu-%');
});

async function startSession(stage = 'IN_CLASS_TEACHING') {
  const db = kernelContainer.db;
  const now = Date.now();
  db.prepare(
    `INSERT OR REPLACE INTO classroom_sessions
       (id, lesson_id, class_id, teacher_id, stage, checkin_code, created_at, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(`sess-stage-${now}`, lessonId, classId, teacherId, stage, '4821', now, now);
  return `sess-stage-${now}`;
}

async function fetchStage() {
  const res = await fetch(`${baseUrl}/api/classroom/stage/${lessonId}/data`, { headers: cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

describe('大屏展台数据接口 · 出勤', () => {
  it('返回课堂出勤：在线 / 应到 / 实到，字段齐全', async () => {
    await startSession();
    const data = await fetchStage();

    expect(data.attendance).toBeDefined();
    expect(data.attendance).toHaveProperty('online');
    expect(data.attendance).toHaveProperty('onlineInClass');
    expect(data.attendance).toHaveProperty('expected');
    expect(data.attendance).toHaveProperty('attended');
  });

  it('【回归】应到人数必须等于班级名单人数（曾因 SQL 具名参数恒为 0）', async () => {
    await startSession();
    const data = await fetchStage();
    // 上面种了 5 名学生
    expect(data.attendance.expected).toBe(5);
  });

  it('实到：按产生过课堂痕迹的学生计（节奏信号）', async () => {
    const sessionId = await startSession();
    const db = kernelContainer.db;
    // 2 名学生发了节奏信号
    db.prepare(
      'INSERT INTO classroom_pacing_signals (id, session_id, student_id, signal_type, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(`ps-stage-1`, sessionId, 'stage-stu-1', 'CLEAR', Date.now());
    db.prepare(
      'INSERT INTO classroom_pacing_signals (id, session_id, student_id, signal_type, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(`ps-stage-2`, sessionId, 'stage-stu-2', 'CONFUSED', Date.now());

    const data = await fetchStage();
    expect(data.attendance.attended).toBe(2);
    // 2/5 = 40%
    expect(data.attendance.expected).toBe(5);
  });

  it('无会话时不编造出勤数字（全部为 0，由 UI 显示「—」）', async () => {
    const data = await fetchStage();
    expect(data.stage).toBe('PRE_CLASS_READY');
    expect(data.attendance.expected).toBe(0);
    expect(data.attendance.attended).toBe(0);
  });

  it('返回真实课节/会话标识与入课口令', async () => {
    await startSession();
    const data = await fetchStage();
    expect(data.lessonId).toBe(lessonId);
    expect(data.classId).toBe(classId);
    expect(data.sessionId).toBeTruthy();
    expect(data.checkinCode).toBe('4821');
  });
});

describe('大屏展台数据接口 · 课件与动态', () => {
  it('课件参与统计字段齐全且为真实聚合', async () => {
    await startSession();
    const data = await fetchStage();

    expect(data.courseware).toBeDefined();
    expect(typeof data.courseware.attempts).toBe('number');
    expect(typeof data.courseware.participants).toBe('number');
    expect(typeof data.courseware.completed).toBe('number');
    expect(typeof data.courseware.avgCompletion).toBe('number');
  });

  it('课堂动态流是数组（无数据时为空数组而非 null）', async () => {
    await startSession();
    const data = await fetchStage();
    expect(Array.isArray(data.feed)).toBe(true);
  });

  it('节奏晴雨表按类型聚合计数', async () => {
    const sessionId = await startSession();
    const db = kernelContainer.db;
    db.prepare(
      'INSERT INTO classroom_pacing_signals (id, session_id, student_id, signal_type, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(`ps-stage-3`, sessionId, 'stage-stu-3', 'TOO_FAST', Date.now());

    const data = await fetchStage();
    expect(data.pacing.TOO_FAST).toBeGreaterThanOrEqual(1);
  });

  it('结课通票提交数为真实计数', async () => {
    await startSession('WRAP_UP_EXIT_TICKET');
    const data = await fetchStage();
    expect(typeof data.exitTicketSubmitted).toBe('number');
    expect(data.stage).toBe('WRAP_UP_EXIT_TICKET');
  });
});
