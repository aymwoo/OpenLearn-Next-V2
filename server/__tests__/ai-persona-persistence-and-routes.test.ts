import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { registerOsRoutes } from '../routes/os.js';
import { encryptApiKey } from '../utils/crypto.js';
import {
  initAIPersonaPersistence,
  resetAIPersonaRegistryForTest,
  registerAIPersona,
  upsertAdminPersona,
  deleteAdminPersona,
  listAIPersonas,
  getAIPersona,
  getDefaultPersonaIdForRole,
  getPersonaReferences,
  clearPersonaProviderReferences,
} from '../ai-persona-registry.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migration049 = fs
  .readFileSync(path.join(repoRoot, 'migrations/049_ai_personas.sql'), 'utf-8')
  .split('-- DOWN')[0];
const migration050 = fs
  .readFileSync(path.join(repoRoot, 'migrations/050_ai_persona_governance.sql'), 'utf-8')
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

describe('Issue #510 · AI 配置角色治理（用途说明、启停、共享提供商绑定、引用保护与回退）', () => {
  let server: http.Server;
  let baseUrl = '';
  let capturedAgentCalls: Array<{ providerId: string; personaId?: string | null }> = [];

  beforeEach(async () => {
    const db = kernelContainer.db;
    const now = Date.now();
    // 使用迁移后的真实 kernelContainer.db 验证 ai_providers + ai_personas + ai_persona_governance 联合约束
    db.prepare('DELETE FROM ai_persona_governance').run();
    db.prepare('DELETE FROM ai_personas').run();
    db.prepare("DELETE FROM ai_providers WHERE id LIKE 'prov_510_%'").run();
    initAIPersonaPersistence(db);
    capturedAgentCalls = [];

    db.prepare(
      'INSERT OR REPLACE INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'prov_510_shared',
      '共享教研模型',
      'https://api.example.com/v1',
      encryptApiKey('sk-shared'),
      'gpt-4o',
      'admin_510',
      1,
      now,
      now,
    );

    db.prepare(
      'INSERT OR REPLACE INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'prov_510_private',
      '教师私有模型',
      'https://api.example.com/v1',
      encryptApiKey('sk-priv'),
      'gpt-4o-mini',
      'teacher_510',
      0,
      now,
      now,
    );

    const app = express();
    app.use(express.json());
    registerOsRoutes({
      app,
      runOpenAIAgentChat: async (provider: { id: string }, req: { personaId?: string | null }) => {
        capturedAgentCalls.push({ providerId: provider.id, personaId: req.personaId });
        return { agentText: `ok:${req.personaId || 'none'}`, toolResults: [] };
      },
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
    kernelContainer.db.prepare('DELETE FROM ai_persona_governance').run();
    kernelContainer.db.prepare('DELETE FROM ai_personas').run();
    kernelContainer.db.prepare("DELETE FROM ai_providers WHERE id LIKE 'prov_510_%'").run();
    resetAIPersonaRegistryForTest(null);
  });

  it('050 迁移持久化用途说明/启停/共享绑定，并拒绝绑定个人私有提供商', async () => {
    // 独立验证 migration049 + migration050 SQL 脚本组合可正常执行
    const memDb = new Database(':memory:');
    memDb.exec(migration049);
    memDb.exec(migration050);
    memDb.close();

    const adminToken = createSessionToken('administrator', 'admin_510');
    const teacherToken = createSessionToken('teacher', 'teacher_510');

    // 尝试将角色绑定到教师私有 Provider -> 403 PRIVATE_PROVIDER_FORBIDDEN
    const badBind = await fetch(`${baseUrl}/api/agent/personas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${adminToken}`,
      },
      body: JSON.stringify({
        id: 'lab_tutor_bad',
        nameZh: '实验助手',
        nameEn: 'Lab Tutor',
        descriptionZh: '物理实验指导',
        descriptionEn: 'Physics lab guidance',
        instructionZh: '指导实验安全与步骤',
        instructionEn: 'Guide lab safety and steps',
        preferredProviderId: 'prov_510_private',
      }),
    });
    expect(badBind.status).toBe(403);
    expect((await badBind.json()).error).toBe('PRIVATE_PROVIDER_FORBIDDEN');

    // 绑定平台共享 Provider + 默认角色 -> 201 成功持久化
    const okCreate = await fetch(`${baseUrl}/api/agent/personas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${adminToken}`,
      },
      body: JSON.stringify({
        id: 'lab_tutor_510',
        nameZh: '实验探究导师',
        nameEn: 'Lab Inquiry Tutor',
        descriptionZh: '用于课堂实验探究引导，绑定共享大模型。',
        descriptionEn: 'Guides classroom lab inquiry with bound shared provider.',
        instructionZh: '结合实验现象循序渐进提问。',
        instructionEn: 'Ask progressive questions about lab observations.',
        defaultForRole: ['teacher'],
        preferredProviderId: 'prov_510_shared',
      }),
    });
    expect(okCreate.status).toBe(201);
    const createdBody = (await okCreate.json()) as {
      persona: {
        id: string;
        descriptionZh?: string;
        enabled?: boolean;
        preferredProviderId?: string;
        preferredProviderName?: string;
      };
    };
    expect(createdBody.persona.descriptionZh).toContain('课堂实验探究');
    expect(createdBody.persona.enabled).toBe(true);
    expect(createdBody.persona.preferredProviderId).toBe('prov_510_shared');
    expect(createdBody.persona.preferredProviderName).toBe('共享教研模型');

    // 重载 DB 后仍保留用途说明、共享模型绑定与启用状态
    initAIPersonaPersistence(kernelContainer.db);
    const reloaded = getAIPersona('lab_tutor_510');
    expect(reloaded?.descriptionZh).toContain('课堂实验探究');
    expect(reloaded?.preferredProviderId).toBe('prov_510_shared');
    expect(reloaded?.enabled).toBe(true);

    // 对话未传 providerId 时优先使用绑定的共享模型
    const chatRes = await fetch(`${baseUrl}/api/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${teacherToken}`,
      },
      body: JSON.stringify({
        message: '请分析牛顿第二定律实验误差',
        lang: 'zh',
        personaId: 'lab_tutor_510',
      }),
    });
    expect(chatRes.status).toBe(200);
    expect(capturedAgentCalls[0]).toEqual({ providerId: 'prov_510_shared', personaId: 'lab_tutor_510' });

    // 共享提供商被删除或清理时，悬空绑定自动清理且对话不崩溃
    clearPersonaProviderReferences('prov_510_shared');
    expect(getAIPersona('lab_tutor_510')?.preferredProviderId).toBeUndefined();
  });

  it('停用或删除被引用的默认角色时触发 409 引用保护；强制确认后自动解除绑定并安全回退，chat 绝不中断', async () => {
    const adminToken = createSessionToken('administrator', 'admin_510');
    const teacherToken = createSessionToken('teacher', 'teacher_510');

    upsertAdminPersona({
      id: 'teacher_default_ref',
      nameZh: '备课默认助手',
      nameEn: 'Prep Default',
      descriptionZh: '教师默认备课角色',
      descriptionEn: 'Teacher default prep persona',
      instructionZh: '聚焦教案生成。',
      instructionEn: 'Focus on lesson planning.',
      defaultForRole: ['teacher'],
    });

    expect(getPersonaReferences('teacher_default_ref').defaultForRoles).toEqual(['teacher']);

    // 不传 force 停用被引用的默认角色 -> 409 PERSONA_IN_USE
    const guardedDisable = await fetch(`${baseUrl}/api/agent/personas/teacher_default_ref`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${adminToken}`,
      },
      body: JSON.stringify({ enabled: false }),
    });
    expect(guardedDisable.status).toBe(409);
    const guardJson = (await guardedDisable.json()) as {
      error: string;
      references: { defaultForRoles: string[] };
    };
    expect(guardJson.error).toBe('PERSONA_IN_USE');
    expect(guardJson.references.defaultForRoles).toEqual(['teacher']);

    // 确认 force=true 停用：自动清除 defaultForRole 并回退 defaultPersonaId 为 plain_assistant
    const forceDisable = await fetch(`${baseUrl}/api/agent/personas/teacher_default_ref?force=true`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${adminToken}`,
      },
      body: JSON.stringify({ enabled: false, force: true }),
    });
    expect(forceDisable.status).toBe(200);
    expect(getAIPersona('teacher_default_ref')?.enabled).toBe(false);
    expect(getAIPersona('teacher_default_ref')?.defaultForRole).toBeUndefined();
    expect(getDefaultPersonaIdForRole('teacher')).toBe('plain_assistant');

    // 普通用户 GET /api/agent/personas 看不到已停用角色；管理员 scope=all 仍可看到以便重新启用
    const teacherList = (await (
      await fetch(`${baseUrl}/api/agent/personas`, { headers: { Cookie: `edu_os_token=${teacherToken}` } })
    ).json()) as { personas: Array<{ id: string }> };
    expect(teacherList.personas.some((p) => p.id === 'teacher_default_ref')).toBe(false);

    const adminList = (await (
      await fetch(`${baseUrl}/api/agent/personas?scope=all`, { headers: { Cookie: `edu_os_token=${adminToken}` } })
    ).json()) as { personas: Array<{ id: string; enabled?: boolean }> };
    expect(adminList.personas.find((p) => p.id === 'teacher_default_ref')?.enabled).toBe(false);

    // 仍携带已停用 personaId 的旧侧栏发起对话 -> 自动安全回退至 plain_assistant 并返回 personaFallback
    const fallbackChatRes = await fetch(`${baseUrl}/api/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${teacherToken}`,
      },
      body: JSON.stringify({
        message: '继续对话',
        lang: 'zh',
        personaId: 'teacher_default_ref',
      }),
    });
    expect(fallbackChatRes.status).toBe(200);
    const fallbackBody = (await fallbackChatRes.json()) as {
      personaUsedId: string | null;
      personaFallback?: { requestedPersonaId: string; fallbackPersonaId: string | null; reason: string };
    };
    expect(fallbackBody.personaUsedId).toBe('plain_assistant');
    expect(fallbackBody.personaFallback).toEqual({
      requestedPersonaId: 'teacher_default_ref',
      fallbackPersonaId: 'plain_assistant',
      reason: 'disabled',
    });

    // plain_assistant 系统兜底角色受停用保护
    const disablePlainRes = await fetch(`${baseUrl}/api/agent/personas/plain_assistant`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${adminToken}`,
      },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disablePlainRes.status).toBe(400);
    expect((await disablePlainRes.json()).error).toBe('BUILTIN_FALLBACK_PROTECTED');
  });
});
