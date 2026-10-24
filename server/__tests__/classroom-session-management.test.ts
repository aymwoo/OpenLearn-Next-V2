import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { ClassroomRuntimeService, ARCHIVED_REPORT_STAGE } from '../services/classroom-runtime-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

describe('课堂会话管理 API (Classroom Session Management)', () => {
  let server: Server;
  let baseUrl: string;
  let classroomService: ClassroomRuntimeService;

  const teacherId = 'usr-sm-teacher-001';
  const teacherToken = 'tok-sm-teacher-001';
  const studentId = 'stu-sm-001';
  const studentToken = 'tok-sm-student-001';

  const lessonId1 = 'les-sm-001';
  const lessonId2 = 'les-sm-002';
  const classId1 = 'cls-sm-001';
  const classId2 = 'cls-sm-002';

  const sessionActiveId = 'cs_sm_test_active';
  const sessionArchivedId = 'cs_sm_test_archived';
  const sessionToDeleteId = 'cs_sm_test_to_delete';

  const db = kernelContainer.db as any;
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  const call = (method: string, urlPath: string, token: string | null, body?: unknown) =>
    fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: token
        ? { 'Content-Type': 'application/json', ...cookie(token) }
        : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    ensureTestSchema();

    const now = Date.now();
    // 插入测试用户
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'sm_teacher', 'placeholder', 'teacher', '测试教师', now);
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)').run(
      studentId,
      'STU_SM_001',
      '学生张三',
      now,
    );

    // 插入 Session Token
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'sm_teacher' }),
      now,
      expiresAt,
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'student_sm' }),
      now,
      expiresAt,
    );

    // 插入课程与班级
    db.prepare('INSERT OR REPLACE INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      lessonId1,
      'Python与算法思维',
      now,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      lessonId2,
      '机器人控制导论',
      now,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
      classId1,
      '高一科技创新1班',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
      classId2,
      '高一科技创新2班',
      now,
    );

    // 插入活跃会话与已归档会话
    db.prepare(
      `
      INSERT OR REPLACE INTO classroom_sessions 
        (id, lesson_id, class_id, teacher_id, stage, teaching_mode_id, checkin_code, started_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      sessionActiveId,
      lessonId1,
      classId1,
      teacherId,
      'IN_CLASS_TEACHING',
      'interactive',
      '8821',
      now - 1200000,
      now - 1200000,
    );

    db.prepare(
      `
      INSERT OR REPLACE INTO classroom_sessions 
        (id, lesson_id, class_id, teacher_id, stage, teaching_mode_id, checkin_code, started_at, ended_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      sessionArchivedId,
      lessonId2,
      classId2,
      teacherId,
      ARCHIVED_REPORT_STAGE,
      'inquiry',
      '6652',
      now - 86400000,
      now - 82800000,
      now - 86400000,
    );

    // 插入待删除的会话及关联数据
    db.prepare(
      `
      INSERT OR REPLACE INTO classroom_sessions 
        (id, lesson_id, class_id, teacher_id, stage, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(sessionToDeleteId, lessonId1, classId1, teacherId, 'PRE_CLASS_READY', now - 100000);

    const pollId = 'poll-sm-01';
    db.prepare(
      `
      INSERT OR REPLACE INTO classroom_quick_polls (id, session_id, lesson_id, question_type, options_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(pollId, sessionToDeleteId, lessonId1, 'SINGLE', '["A","B"]', now);

    db.prepare(
      `
      INSERT OR REPLACE INTO classroom_poll_votes (id, poll_id, student_id, selected_option, voted_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run('vote-sm-01', pollId, studentId, 'A', now);

    db.prepare(
      `
      INSERT OR REPLACE INTO classroom_exit_tickets (id, session_id, student_id, lesson_id, core_answer, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run('et-sm-01', sessionToDeleteId, studentId, lessonId1, '测试通票解答', now);

    db.prepare(
      `
      INSERT OR REPLACE INTO classroom_feed (id, session_id, lesson_id, type, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run('feed-sm-01', sessionToDeleteId, lessonId1, 'info', '测试弹幕消息', now);

    const app = express();
    app.use(express.json());
    classroomService = new ClassroomRuntimeService(db);
    registerClassroomRoutes({ app, io: undefined } as any, classroomService);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    db.prepare('DELETE FROM classroom_poll_votes WHERE poll_id = ?').run('poll-sm-01');
    db.prepare('DELETE FROM classroom_quick_polls WHERE session_id = ?').run(sessionToDeleteId);
    db.prepare('DELETE FROM classroom_exit_tickets WHERE session_id = ?').run(sessionToDeleteId);
    db.prepare('DELETE FROM classroom_feed WHERE session_id = ?').run(sessionToDeleteId);
    db.prepare('DELETE FROM classroom_sessions WHERE id IN (?, ?, ?)').run(
      sessionActiveId,
      sessionArchivedId,
      sessionToDeleteId,
    );
    db.prepare('DELETE FROM lessons WHERE id IN (?, ?)').run(lessonId1, lessonId2);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classId1, classId2);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(teacherToken, studentToken);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('鉴权限制', () => {
    it('未登录不能获取会话列表 (401)', async () => {
      const res = await call('GET', '/api/classroom/sessions', null);
      expect(res.status).toBe(401);
    });

    it('学生角色不能获取会话管理列表 (403)', async () => {
      const res = await call('GET', '/api/classroom/sessions', studentToken);
      expect(res.status).toBe(403);
    });

    it('教师角色允许访问会话管理列表 (200)', async () => {
      const res = await call('GET', '/api/classroom/sessions', teacherToken);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.items)).toBe(true);
      expect(typeof data.total).toBe('number');
    });
  });

  describe('会话列表查询与过滤', () => {
    it('支持按 status=active 过滤出未归档会话', async () => {
      const res = await call('GET', '/api/classroom/sessions?status=active', teacherToken);
      expect(res.status).toBe(200);
      const data = await res.json();
      const ids = data.items.map((i: any) => i.id);
      expect(ids).toContain(sessionActiveId);
      expect(ids).not.toContain(sessionArchivedId);
    });

    it('支持按 status=archived 过滤出已归档会话', async () => {
      const res = await call('GET', '/api/classroom/sessions?status=archived', teacherToken);
      expect(res.status).toBe(200);
      const data = await res.json();
      const ids = data.items.map((i: any) => i.id);
      expect(ids).toContain(sessionArchivedId);
      expect(ids).not.toContain(sessionActiveId);
    });

    it('Issue #91：列表项带 presentCount（在场学生数，非在线总人数）', async () => {
      const res = await call('GET', '/api/classroom/sessions?status=active', teacherToken);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items.length).toBeGreaterThan(0);
      for (const item of data.items) {
        expect(typeof item.presentCount, `${item.id} 应带 presentCount`).toBe('number');
        expect(item.presentCount).toBeGreaterThanOrEqual(0);
      }
    });

    it('支持按 search 关键词模糊查询课程名称', async () => {
      const res = await call('GET', '/api/classroom/sessions?search=机器人', teacherToken);
      expect(res.status).toBe(200);
      const data = await res.json();
      const ids = data.items.map((i: any) => i.id);
      expect(ids).toContain(sessionArchivedId);
      expect(ids).not.toContain(sessionActiveId);
    });

    it('聚合返回会话关联的互动统计指标', async () => {
      const res = await call('GET', `/api/classroom/sessions?lessonId=${lessonId1}`, teacherToken);
      expect(res.status).toBe(200);
      const data = await res.json();
      const toDelete = data.items.find((i: any) => i.id === sessionToDeleteId);
      expect(toDelete).toBeDefined();
      expect(toDelete.stats.pollCount).toBe(1);
      expect(toDelete.stats.exitTicketCount).toBe(1);
      expect(toDelete.stats.feedCount).toBe(1);
    });
  });

  describe('会话手动归档', () => {
    it('归档不存在的会话返回 404', async () => {
      const res = await call('POST', '/api/classroom/sessions/cs_not_exist/archive', teacherToken);
      expect(res.status).toBe(404);
    });

    it('成功归档活动会话并更新 stage 为 ARCHIVED_REPORT', async () => {
      const res = await call('POST', `/api/classroom/sessions/${sessionActiveId}/archive`, teacherToken);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.stage).toBe(ARCHIVED_REPORT_STAGE);

      // 验证 DB 中的真实状态
      const row = db.prepare('SELECT stage, ended_at FROM classroom_sessions WHERE id = ?').get(sessionActiveId);
      expect(row.stage).toBe(ARCHIVED_REPORT_STAGE);
      expect(row.ended_at).toBeGreaterThan(0);
    });
  });

  describe('会话级联物理删除', () => {
    it('删除不存在的会话返回 404', async () => {
      const res = await call('DELETE', '/api/classroom/sessions/cs_not_exist', teacherToken);
      expect(res.status).toBe(404);
    });

    it('成功删除会话，并级联清理关联的 polls、votes、exit tickets、feed', async () => {
      const res = await call('DELETE', `/api/classroom/sessions/${sessionToDeleteId}`, teacherToken);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.deletedId).toBe(sessionToDeleteId);

      // 验证 classroom_sessions 表已无记录
      const sessionRow = db.prepare('SELECT id FROM classroom_sessions WHERE id = ?').get(sessionToDeleteId);
      expect(sessionRow).toBeUndefined();

      // 验证关联子表记录已被级联清除
      const pollRow = db.prepare('SELECT id FROM classroom_quick_polls WHERE session_id = ?').get(sessionToDeleteId);
      expect(pollRow).toBeUndefined();
      const voteRow = db.prepare('SELECT id FROM classroom_poll_votes WHERE poll_id = ?').get('poll-sm-01');
      expect(voteRow).toBeUndefined();
      const etRow = db.prepare('SELECT id FROM classroom_exit_tickets WHERE session_id = ?').get(sessionToDeleteId);
      expect(etRow).toBeUndefined();
      const feedRow = db.prepare('SELECT id FROM classroom_feed WHERE session_id = ?').get(sessionToDeleteId);
      expect(feedRow).toBeUndefined();
    });
  });

  describe('跨教师租户隔离 (IDOR 防护) 与历史战报精确查询', () => {
    const otherTeacherId = 'usr-sm-teacher-002';
    const otherTeacherToken = 'tok-sm-teacher-002';
    const adminId = 'usr-sm-admin-001';
    const adminToken = 'tok-sm-admin-001';
    const histSessionOldId = 'cs_sm_hist_old';
    const histSessionNewId = 'cs_sm_hist_new';
    const histPollId = 'poll-sm-hist-old';

    beforeAll(() => {
      const now = Date.now();
      const expiresAt = now + 60 * 60 * 1000;
      db.prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(otherTeacherId, 'sm_teacher_2', 'placeholder', 'teacher', '另一位教师', now);
      db.prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(adminId, 'sm_admin', 'placeholder', 'administrator', '系统管理员', now);

      const insertSession = db.prepare(
        'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
      );
      insertSession.run(
        otherTeacherToken,
        JSON.stringify({ userId: otherTeacherId, role: 'teacher', username: 'sm_teacher_2' }),
        now,
        expiresAt,
      );
      insertSession.run(
        adminToken,
        JSON.stringify({ userId: adminId, role: 'administrator', username: 'sm_admin' }),
        now,
        expiresAt,
      );

      // 同一课程下的两个不同历史会话（验证 ?sessionId= 精确战报查询）
      db.prepare(
        `INSERT OR REPLACE INTO classroom_sessions
          (id, lesson_id, class_id, teacher_id, stage, started_at, ended_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        histSessionOldId,
        lessonId1,
        classId1,
        teacherId,
        ARCHIVED_REPORT_STAGE,
        now - 7200000,
        now - 5400000,
        now - 7200000,
      );

      db.prepare(
        `INSERT OR REPLACE INTO classroom_sessions
          (id, lesson_id, class_id, teacher_id, stage, started_at, ended_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        histSessionNewId,
        lessonId1,
        classId1,
        teacherId,
        ARCHIVED_REPORT_STAGE,
        now - 50000,
        now - 10000,
        now - 50000,
      );

      db.prepare(
        `INSERT OR REPLACE INTO classroom_quick_polls (id, session_id, lesson_id, question_type, options_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(histPollId, histSessionOldId, lessonId1, 'SINGLE', '["A","B"]', now - 7000000);
      db.prepare(
        `INSERT OR REPLACE INTO classroom_poll_votes (id, poll_id, student_id, selected_option, voted_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('vote-sm-hist-1', histPollId, studentId, 'B', now - 6900000);
    });

    afterAll(() => {
      db.prepare('DELETE FROM classroom_poll_votes WHERE poll_id = ?').run(histPollId);
      db.prepare('DELETE FROM classroom_quick_polls WHERE id = ?').run(histPollId);
      db.prepare('DELETE FROM classroom_sessions WHERE id IN (?, ?)').run(histSessionOldId, histSessionNewId);
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(otherTeacherToken, adminToken);
      db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(otherTeacherId, adminId);
    });

    it('普通教师无法在列表中看到其他教师的专属会话，也不能归档或删除他人会话 (403)', async () => {
      const listRes = await call('GET', '/api/classroom/sessions', otherTeacherToken);
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      const ids = listData.items.map((i: any) => i.id);
      expect(ids).not.toContain(sessionArchivedId);
      expect(ids).not.toContain(histSessionOldId);

      const archRes = await call('POST', `/api/classroom/sessions/${histSessionOldId}/archive`, otherTeacherToken);
      expect(archRes.status).toBe(403);

      const delRes = await call('DELETE', `/api/classroom/sessions/${histSessionOldId}`, otherTeacherToken);
      expect(delRes.status).toBe(403);
    });

    it('管理员可查看全部教师的课堂会话', async () => {
      const listRes = await call('GET', '/api/classroom/sessions', adminToken);
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      const ids = listData.items.map((i: any) => i.id);
      expect(ids).toContain(sessionArchivedId);
      expect(ids).toContain(histSessionOldId);
    });

    it('panoramic-report 支持通过 ?sessionId= 精确读取指定历史会话战报及真实投票选项分布', async () => {
      // 不传 sessionId 时默认返回最新会话 histSessionNewId
      const latestRes = await call('GET', `/api/classroom/sessions/${lessonId1}/panoramic-report`, teacherToken);
      expect(latestRes.status).toBe(200);
      const latestData = await latestRes.json();
      expect(latestData.session.id).toBe(histSessionNewId);
      expect(latestData.metrics.pollVotesTotal).toBe(0);

      // 传 sessionId=histSessionOldId 时返回历史旧会话及其真实投票分布
      const oldRes = await call(
        'GET',
        `/api/classroom/sessions/${lessonId1}/panoramic-report?sessionId=${histSessionOldId}`,
        teacherToken,
      );
      expect(oldRes.status).toBe(200);
      const oldData = await oldRes.json();
      expect(oldData.session.id).toBe(histSessionOldId);
      expect(oldData.metrics.pollVotesTotal).toBe(1);
      expect(oldData.metrics.pollOptionBreakdown).toEqual([{ option: 'B', count: 1, percent: 100 }]);
    });
  });
});
