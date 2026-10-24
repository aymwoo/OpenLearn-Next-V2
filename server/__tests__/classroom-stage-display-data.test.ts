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
const studentToken = 'tok-stage-student';
const scheduleId = 'sch-stage-001';

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
    'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(
    studentToken,
    JSON.stringify({ userId: 'stage-stu-1', studentId: 'stage-stu-1', role: 'student', username: 'stage_stu_1' }),
    now,
    now + 3600_000,
  );
  db.prepare(
    'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(classId, '展台测试班', 'stage display', 'stage-pass', now);
  db.prepare(
    'INSERT OR REPLACE INTO lessons (id, title, content, timeline, progress_mode, progress_conditions, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(lessonId, '展台测试课', null, null, 'manual', null, teacherId, now, now);

  // 排课行：签到写入 attendance 时挂在它下面（attendance → schedules → lesson）
  db.prepare(
    'INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(scheduleId, classId, lessonId, '2026-01-05', '08:00', 'scheduled', now);

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
    } else if (token === studentToken) {
      (req as any).session = { userId: 'stage-stu-1', studentId: 'stage-stu-1', role: 'student' };
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
  db.prepare('DELETE FROM client_sessions WHERE id = ?').run(studentToken);
  db.prepare('DELETE FROM attendance WHERE schedule_id = ?').run(scheduleId);
  db.prepare('DELETE FROM lesson_checkins WHERE lesson_id = ?').run(lessonId);
  db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  const db = kernelContainer.db;
  db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
  db.prepare('DELETE FROM classroom_pacing_signals WHERE student_id LIKE ?').run('stage-stu-%');
  db.prepare('DELETE FROM attendance WHERE schedule_id = ?').run(scheduleId);
  db.prepare('DELETE FROM lesson_checkins WHERE lesson_id = ?').run(lessonId);
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

/**
 * Issue #245：扫码签到此前不被「实到」消费 —— 只扫码不互动的学生被漏计。
 */
describe('大屏展台数据接口 · 扫码签到计入实到（Issue #245）', () => {
  const studentCookie = { Cookie: `edu_os_token=${studentToken}`, 'Content-Type': 'application/json' };

  it('学生扫码签到后立即计入「实到」（此前恒为 0）', async () => {
    await startSession();
    const before = await fetchStage();
    expect(before.attendance.attended).toBe(0);

    const res = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/checkin`, {
      method: 'POST',
      headers: studentCookie,
      body: JSON.stringify({ code: '4821' }),
    });
    expect(res.status).toBe(200);

    const after = await fetchStage();
    expect(after.attendance.attended).toBe(1);
    expect(after.attendance.expected).toBe(5);
  });

  it('签到落库到 attendance 与 lesson_checkins 两处', async () => {
    await startSession();
    const res = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/checkin`, {
      method: 'POST',
      headers: studentCookie,
      body: JSON.stringify({ code: '4821' }),
    });
    expect(res.status).toBe(200);

    const db = kernelContainer.db;
    const att = db
      .prepare('SELECT status FROM attendance WHERE schedule_id = ? AND student_id = ?')
      .get(scheduleId, 'stage-stu-1') as any;
    expect(att?.status).toBe('present');

    const lc = db
      .prepare('SELECT 1 AS ok FROM lesson_checkins WHERE lesson_id = ? AND student_id = ?')
      .get(lessonId, 'stage-stu-1') as any;
    expect(lc?.ok).toBe(1);
  });

  it('考勤台账里登记的到场（present/late）计入实到，缺考与请假不计入', async () => {
    await startSession();
    const db = kernelContainer.db;
    const now = Date.now();
    const put = (studentId: string, status: string) =>
      db
        .prepare('INSERT OR REPLACE INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)')
        .run(scheduleId, studentId, status, now);

    put('stage-stu-1', 'present');
    put('stage-stu-2', 'late');
    put('stage-stu-3', 'absent');
    put('stage-stu-4', 'excused');

    const data = await fetchStage();
    // 只有 present 与 late 算「到场」
    expect(data.attendance.attended).toBe(2);
  });

  it('他班的签到不串进本班的「实到」', async () => {
    await startSession();
    const db = kernelContainer.db;
    const now = Date.now();

    // 另一个班的排课 + 到课记录
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('cls-stage-other', '别的班', 'other', 'other-pass', now);
    db.prepare(
      'INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('sch-stage-other', 'cls-stage-other', lessonId, '2026-01-05', '08:00', 'scheduled', now);
    db.prepare(
      'INSERT OR REPLACE INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)',
    ).run('sch-stage-other', 'stage-stu-5', 'present', now);

    try {
      const data = await fetchStage();
      expect(data.attendance.attended).toBe(0);
    } finally {
      db.prepare('DELETE FROM attendance WHERE schedule_id = ?').run('sch-stage-other');
      db.prepare('DELETE FROM schedules WHERE id = ?').run('sch-stage-other');
      db.prepare('DELETE FROM classes WHERE id = ?').run('cls-stage-other');
    }
  });

  it('不在本班名单里的到课记录不计入「实到」（计数不超过应到人数）', async () => {
    await startSession();
    const db = kernelContainer.db;
    db.prepare(
      'INSERT OR REPLACE INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)',
    ).run(scheduleId, 'stage-outsider', 'present', Date.now());

    const data = await fetchStage();
    expect(data.attendance.attended).toBe(0);
    expect(data.attendance.attended).toBeLessThanOrEqual(data.attendance.expected);
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
