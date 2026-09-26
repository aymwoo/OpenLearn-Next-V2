import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import { registerClassroomRoutes, BUILTIN_TEACHING_MODES } from '../routes/classroom.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';

/**
 * 教学模式（Teaching Modes）API 契约测试 —— 课堂启动门户的模式选择器数据源。
 *
 * 锁死四件事：
 *   1. 读开放 / 写限管理员（模式集合会影响全校课堂，不能由教师随意增删）；
 *   2. 内置模式不可删除、但可改写文案（管理员按校情调整措辞）；
 *   3. 内置模式永远存在且排在自定义模式之前（API 以代码常量兜底，不依赖 seed）；
 *   4. 「当次课堂选用的模式」真实落库到 classroom_sessions.teaching_mode_id。
 */
describe('教学模式 API（课堂启动门户）', () => {
  let server: Server;
  let baseUrl: string;
  let classroomService: ClassroomRuntimeService;

  const adminId = 'usr-tm-admin-0001';
  const teacherId = 'usr-tm-teacher-0001';
  const adminToken = 'tok-tm-admin-0001';
  const teacherToken = 'tok-tm-teacher-0001';
  const lessonId = 'les-tm-0001';
  const customModeId = 'tm-test-custom';

  const db = kernelContainer.db as any;
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const json = (token: string) => ({ 'Content-Type': 'application/json', ...cookie(token) });

  const call = (method: string, urlPath: string, token: string | null, body?: unknown) =>
    fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: token ? { 'Content-Type': 'application/json', ...cookie(token) } : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const listModes = async (token: string) => {
    const res = await call('GET', '/api/classroom/teaching-modes', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; modes: any[] };
    return body.modes;
  };

  beforeAll(async () => {
    // 测试库不一定已应用课堂/教学模式迁移，显式补齐（runMigrations 幂等，按 _migrations 记账）
    runMigrations(db, loadMigrationsFromDirectory(path.resolve(__dirname, '../../migrations')));

    const now = Date.now();
    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(adminId, 'tm_admin', 'placeholder', 'administrator', '模式管理员', now);
    insertUser.run(teacherId, 'tm_teacher', 'placeholder', 'teacher', '模式教师', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'tm_admin' }),
      now,
      expiresAt,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'tm_teacher' }),
      now,
      expiresAt,
    );

    db.prepare('INSERT OR REPLACE INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      lessonId,
      '教学模式测试课节',
      now,
      now,
    );

    // 前置清理：避免上一次运行残留影响断言
    db.prepare('DELETE FROM teaching_modes WHERE id = ?').run(customModeId);
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);

    const app = express();
    app.use(express.json());
    classroomService = new ClassroomRuntimeService(db);
    registerClassroomRoutes({ app, io: undefined } as any, classroomService);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    db.prepare('DELETE FROM teaching_modes WHERE id = ?').run(customModeId);
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(adminToken, teacherToken);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(adminId, teacherId);
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('鉴权', () => {
    it('匿名不可读取', async () => {
      const res = await call('GET', '/api/classroom/teaching-modes', null);
      expect(res.status).toBe(401);
    });

    it('教师可读取（门户页由教师使用）', async () => {
      const modes = await listModes(teacherToken);
      expect(Array.isArray(modes)).toBe(true);
      expect(modes.length).toBeGreaterThanOrEqual(BUILTIN_TEACHING_MODES.length);
    });

    it('教师不可创建（写入限管理员）', async () => {
      const res = await call('POST', '/api/classroom/teaching-modes', teacherToken, {
        id: 'tm-teacher-attempt',
        name: '教师自建模式',
      });
      expect(res.status).toBe(403);
    });
  });

  describe('内置模式的兜底与顺序', () => {
    it('返回全部内置模式，且不依赖数据库 seed', async () => {
      const modes = await listModes(teacherToken);
      for (const b of BUILTIN_TEACHING_MODES) {
        const hit = modes.find((m) => m.id === b.id);
        expect(hit, `内置模式 ${b.id} 应始终存在`).toBeTruthy();
        expect(hit.name).toBe(b.name);
        expect(hit.isBuiltin).toBe(true);
      }
    });

    it('按 sortOrder 升序返回', async () => {
      const modes = await listModes(teacherToken);
      const orders = modes.map((m) => m.sortOrder);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });
  });

  describe('管理员 CRUD', () => {
    it('创建自定义模式', async () => {
      const res = await call('POST', '/api/classroom/teaching-modes', adminToken, {
        id: customModeId,
        name: '项目式',
        nameEn: 'Project-based',
        description: '以真实项目驱动跨课时产出',
        icon: 'FolderKanban',
        color: 'sky',
        sortOrder: 15,
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).id).toBe(customModeId);

      const modes = await listModes(adminToken);
      const created = modes.find((m) => m.id === customModeId);
      expect(created).toBeTruthy();
      expect(created.isBuiltin).toBe(false);
      // sortOrder=15 应排在 sortOrder=10 的「讲授式」之后、20 的「探究式」之前
      expect(modes.findIndex((m) => m.id === customModeId)).toBe(1);
    });

    it('拒绝非法 id 格式', async () => {
      const res = await call('POST', '/api/classroom/teaching-modes', adminToken, {
        id: 'bad id; drop table',
        name: '非法',
      });
      expect(res.status).toBe(400);
    });

    it('拒绝缺少 name', async () => {
      const res = await call('POST', '/api/classroom/teaching-modes', adminToken, { id: 'tm-no-name' });
      expect(res.status).toBe(400);
    });

    it('拒绝重复 id', async () => {
      const res = await call('POST', '/api/classroom/teaching-modes', adminToken, {
        id: customModeId,
        name: '重复',
      });
      expect(res.status).toBe(409);
    });

    it('拒绝占用内置 id', async () => {
      const res = await call('POST', '/api/classroom/teaching-modes', adminToken, {
        id: BUILTIN_TEACHING_MODES[0].id,
        name: '想覆盖内置',
      });
      expect(res.status).toBe(409);
    });

    it('改写内置模式文案（落库覆盖，isBuiltin 语义保持）', async () => {
      const target = BUILTIN_TEACHING_MODES[0];
      const res = await call('PUT', `/api/classroom/teaching-modes/${target.id}`, adminToken, {
        description: '本校统一改为「先讲后练」节奏',
      });
      expect(res.status).toBe(200);

      const modes = await listModes(adminToken);
      const updated = modes.find((m) => m.id === target.id);
      expect(updated.description).toBe('本校统一改为「先讲后练」节奏');
      expect(updated.isBuiltin).toBe(true);
      expect(updated.name).toBe(target.name); // 未传字段保持原值
    });

    it('更新未知模式返回 404', async () => {
      const res = await call('PUT', '/api/classroom/teaching-modes/tm-not-exist', adminToken, { name: 'x' });
      expect(res.status).toBe(404);
    });

    it('内置模式不可删除', async () => {
      const res = await call('DELETE', `/api/classroom/teaching-modes/${BUILTIN_TEACHING_MODES[0].id}`, adminToken);
      expect(res.status).toBe(403);
    });

    it('可删除自定义模式', async () => {
      const res = await call('DELETE', `/api/classroom/teaching-modes/${customModeId}`, adminToken);
      expect(res.status).toBe(200);
      const modes = await listModes(adminToken);
      expect(modes.find((m) => m.id === customModeId)).toBeUndefined();
    });
  });

  describe('当次课堂选用的教学模式', () => {
    const readSelected = () =>
      (db.prepare('SELECT teaching_mode_id FROM classroom_sessions WHERE lesson_id = ?').get(lessonId) as any)
        ?.teaching_mode_id;

    it('可设置并落库', async () => {
      const res = await call('PUT', `/api/classroom/sessions/${lessonId}/teaching-mode`, teacherToken, {
        teachingModeId: 'inquiry',
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).teachingModeId).toBe('inquiry');
      expect(readSelected()).toBe('inquiry');
    });

    it('可通过 init 端点一并写入', async () => {
      const res = await call('POST', `/api/classroom/sessions/${lessonId}/init`, teacherToken, {
        teachingModeId: 'collaborative',
      });
      expect(res.status).toBe(200);
      expect(readSelected()).toBe('collaborative');
    });

    it('init 拒绝格式非法或已不存在的教学模式', async () => {
      const invalidFormat = await call('POST', `/api/classroom/sessions/${lessonId}/init`, teacherToken, {
        teachingModeId: 'bad id!',
      });
      expect(invalidFormat.status).toBe(400);

      const missingMode = await call('POST', `/api/classroom/sessions/${lessonId}/init`, teacherToken, {
        teachingModeId: 'tm-not-exist',
      });
      expect(missingMode.status).toBe(404);
      expect(readSelected()).toBe('collaborative');
    });

    it('init 拒绝不存在的课程或班级', async () => {
      const missingLesson = await call('POST', '/api/classroom/sessions/les-missing/init', teacherToken, {});
      expect(missingLesson.status).toBe(404);

      const missingClass = await call('POST', `/api/classroom/sessions/${lessonId}/init`, teacherToken, {
        classId: 'cls-missing',
      });
      expect(missingClass.status).toBe(404);
    });

    it('传空字符串表示清除选择', async () => {
      const res = await call('PUT', `/api/classroom/sessions/${lessonId}/teaching-mode`, teacherToken, {
        teachingModeId: '',
      });
      expect(res.status).toBe(200);
      expect(readSelected()).toBeNull();
    });

    it('拒绝未知模式 id', async () => {
      const res = await call('PUT', `/api/classroom/sessions/${lessonId}/teaching-mode`, teacherToken, {
        teachingModeId: 'tm-not-exist',
      });
      expect(res.status).toBe(404);
    });

    it('拒绝非法模式 id 格式', async () => {
      const res = await call('PUT', `/api/classroom/sessions/${lessonId}/teaching-mode`, teacherToken, {
        teachingModeId: 'bad id!',
      });
      expect(res.status).toBe(400);
    });
  });
});
