import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { registerOsRoutes } from '../routes/os.js';
import {
  initAIPersonaPersistence,
  resetAIPersonaRegistryForTest,
  registerAIPersona,
  upsertAdminPersona,
  deleteAdminPersona,
  listAIPersonas,
  getAIPersona,
  getDefaultPersonaIdForRole,
} from '../ai-persona-registry.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migration049 = fs
  .readFileSync(path.join(repoRoot, 'migrations/049_ai_personas.sql'), 'utf-8')
  .split('-- DOWN')[0];

function createSessionToken(role: 'administrator' | 'teacher' | 'student', userId: string): string {
  const token = `tok_${role}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  const sessionData = JSON.stringify({
    role,
    userId,
    username: userId,
    name: userId,
  });
  kernelContainer.db
    .prepare('INSERT INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, sessionData, now, now + 3600_000);
  return token;
}

describe('IKVA8R P1 · ai_personas 持久化与 /api/agent/personas 角色门禁 & 管理 CRUD', () => {
  let db: Database.Database;
  let server: http.Server;
  let baseUrl = '';

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(migration049);
    initAIPersonaPersistence(db);

    const app = express();
    app.use(express.json());
    registerOsRoutes({
      app,
      runOpenAIAgentChat: async () => ({ agentText: 'ok', toolResults: [] }),
      buildAgentSystemInstruction: () => '',
      activityRegistry: {
        listProviders: () => [],
      } as unknown as Parameters<typeof registerOsRoutes>[0]['activityRegistry'],
      aiLimiter: ((_req, _res, next) => next()) as express.RequestHandler,
    } as unknown as Parameters<typeof registerOsRoutes>[0]);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetAIPersonaRegistryForTest(null);
    db.close();
  });

  it('admin 创建的 Persona 持久化在 ai_personas，重启重新 init 后保留且孤儿 plugin 行被清理', () => {
    upsertAdminPersona({
      id: 'teacher_coach',
      nameZh: '备课教练',
      nameEn: 'Prep Coach',
      instructionZh: '帮助教师梳理教学重难点。',
      instructionEn: 'Help teachers structure lesson objectives.',
      mode: 'replace',
      basePolicy: 'drop',
      visibility: ['teacher', 'administrator'],
      defaultForRole: ['teacher'],
      toolPolicy: { allow: ['lesson.*'] },
      maxTurns: 7,
    });

    registerAIPersona(
      {
        id: 'orphan_plugin_bot',
        nameZh: '孤儿插件助手',
        nameEn: 'Orphan Bot',
        instructionZh: '临时指令',
        instructionEn: 'Temp instruction',
      },
      'ext-crashed-plugin',
    );
    expect(getAIPersona('orphan_plugin_bot')).toBeDefined();

    // 模拟服务重启后重新绑定持久化库
    initAIPersonaPersistence(db);

    const restored = getAIPersona('teacher_coach');
    expect(restored).toBeDefined();
    expect(restored?.source).toBe('admin');
    expect(restored?.mode).toBe('replace');
    expect(restored?.basePolicy).toBe('drop');
    expect(restored?.visibility).toEqual(['teacher', 'administrator']);
    expect(restored?.defaultForRole).toEqual(['teacher']);
    expect(restored?.toolPolicy).toEqual({ allow: ['lesson.*'] });
    expect(restored?.maxTurns).toBe(7);

    // 孤儿 plugin 行应在重启初始化时被清除
    expect(getAIPersona('orphan_plugin_bot')).toBeUndefined();
    expect(listAIPersonas('student').some((p) => p.id === 'teacher_coach')).toBe(false);
    expect(getDefaultPersonaIdForRole('teacher')).toBe('teacher_coach');
  });

  it('禁止删除内置 Persona，允许删除 admin 创建的 Persona 并同步从 DB 移除', () => {
    expect(() => deleteAdminPersona('socratic_questioner')).toThrow(/cannot be deleted/i);

    upsertAdminPersona({
      id: 'deletable_persona',
      nameZh: '临时角色',
      nameEn: 'Temp Persona',
      instructionZh: '测试',
      instructionEn: 'Test',
    });
    deleteAdminPersona('deletable_persona');
    expect(getAIPersona('deletable_persona')).toBeUndefined();
    initAIPersonaPersistence(db);
    expect(getAIPersona('deletable_persona')).toBeUndefined();
  });

  it('HTTP 门禁：GET 按角色过滤 visibility，POST /api/agent/chat 越权返回 403，CRUD 仅管理员可用', async () => {
    const adminToken = createSessionToken('administrator', 'admin_u');
    const teacherToken = createSessionToken('teacher', 'teacher_u');
    const studentToken = createSessionToken('student', 'student_u');

    // 非管理员不能创建 Persona
    const teacherCreate = await fetch(`${baseUrl}/api/agent/personas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${teacherToken}`,
      },
      body: JSON.stringify({
        id: 'blocked_create',
        nameZh: 'x',
        nameEn: 'x',
        instructionZh: 'x',
        instructionEn: 'x',
      }),
    });
    expect(teacherCreate.status).toBe(403);

    // 管理员创建仅教师可见的 Persona
    const adminCreate = await fetch(`${baseUrl}/api/agent/personas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${adminToken}`,
      },
      body: JSON.stringify({
        id: 'teacher_only_persona',
        nameZh: '教师专属',
        nameEn: 'Teacher Only',
        instructionZh: '仅教师可见。',
        instructionEn: 'Teacher only.',
        visibility: ['teacher'],
        mode: 'replace',
        basePolicy: 'drop',
      }),
    });
    expect(adminCreate.status).toBe(201);

    // 学生 GET /api/agent/personas 看不到 teacher_only_persona
    const studentListRes = await fetch(`${baseUrl}/api/agent/personas`, {
      headers: { Cookie: `edu_os_token=${studentToken}` },
    });
    expect(studentListRes.status).toBe(200);
    const studentListData = (await studentListRes.json()) as { personas: Array<{ id: string }> };
    expect(studentListData.personas.some((p) => p.id === 'teacher_only_persona')).toBe(false);

    // 教师 GET 看得到
    const teacherListRes = await fetch(`${baseUrl}/api/agent/personas`, {
      headers: { Cookie: `edu_os_token=${teacherToken}` },
    });
    const teacherListData = (await teacherListRes.json()) as { personas: Array<{ id: string }> };
    expect(teacherListData.personas.some((p) => p.id === 'teacher_only_persona')).toBe(true);

    // 学生 POST /api/agent/chat 强行传 teacher_only_persona 应返回 403
    const forbiddenChatRes = await fetch(`${baseUrl}/api/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${studentToken}`,
      },
      body: JSON.stringify({
        message: 'hello',
        lang: 'zh',
        personaId: 'teacher_only_persona',
      }),
    });
    expect(forbiddenChatRes.status).toBe(403);
    const forbiddenChatBody = await forbiddenChatRes.json();
    expect(forbiddenChatBody.error).toBe('PERSONA_FORBIDDEN');

    // 管理员 PATCH 与 DELETE 生效
    const patchRes = await fetch(`${baseUrl}/api/agent/personas/teacher_only_persona`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${adminToken}`,
      },
      body: JSON.stringify({ maxTurns: 9 }),
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).persona.maxTurns).toBe(9);

    const delRes = await fetch(`${baseUrl}/api/agent/personas/teacher_only_persona`, {
      method: 'DELETE',
      headers: { Cookie: `edu_os_token=${adminToken}` },
    });
    expect(delRes.status).toBe(200);
    expect(getAIPersona('teacher_only_persona')).toBeUndefined();
  });
});
