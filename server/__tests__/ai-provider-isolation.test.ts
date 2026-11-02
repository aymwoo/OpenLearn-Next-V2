/**
 * @vitest-environment node
 *
 * Issue #383 专项测试：教师/管理员配置的 AI Provider 账号级数据隔离与越权防护。
 *
 * 验收标准：
 * 1. 账号 A 创建的私有 Provider，账号 B（无论教师还是管理员）在列表接口中不可见；
 * 2. 账号 B 无法通过 API（列举 / 读取 / 调用 / 编辑 / 删除 / 掩码测试）使用或篡改账号 A 的 Provider 或获取其密钥；
 * 3. 密钥仅存服务端（AES-256 加密），响应中只出现掩码 Key；
 * 4. 账号 A 本人仍可正常列举、编辑、选用、删除自己的私有 Provider；
 * 5. 平台级共享 Provider（is_shared = 1）仅管理员可创建/修改/删除，对所有授权师生可见可用；
 * 6. Fallback 兜底逻辑仅在当前用户可访问范围内生效（本人私有 > 平台共享），绝不跨账号使用他人私有 Key。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { encryptApiKey } from '../../packages/core/di/api-key-crypto.js';
import { resolveAccessibleAiProvider } from '../../packages/core/di/ai-provider-resolver.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { registerOsRoutes } from '../routes/os.js';
import type { ServerContext } from '../context.js';
import { ActivityRegistry } from '../../packages/activity-ecosystem/index.js';

describe('Issue #383: AI Provider 账号隔离与越权防护', () => {
  let db: Database.Database;
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const TEACHER_A_ID = 'usr_teacher_a';
  const TEACHER_B_ID = 'usr_teacher_b';
  const ADMIN_1_ID = 'usr_admin_1';
  const ADMIN_2_ID = 'usr_admin_2';

  const TOK_TEACHER_A = 'tok_teacher_a';
  const TOK_TEACHER_B = 'tok_teacher_b';
  const TOK_ADMIN_1 = 'tok_admin_1';
  const TOK_ADMIN_2 = 'tok_admin_2';

  const cookie = (tok: string) => ({
    Cookie: `edu_os_token=${tok}`,
    'Content-Type': 'application/json',
  });

  beforeAll(async () => {
    db = kernelContainer.db;
    const now = Date.now();
    const expiresAt = now + 86400000;

    // 清理并注入测试用户
    db.prepare("INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, 'hash', 'teacher', ?, ?)")
      .run(TEACHER_A_ID, 'teacher_a', 'Teacher A', now);
    db.prepare("INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, 'hash', 'teacher', ?, ?)")
      .run(TEACHER_B_ID, 'teacher_b', 'Teacher B', now);
    db.prepare("INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, 'hash', 'administrator', ?, ?)")
      .run(ADMIN_1_ID, 'admin_1', 'Admin 1', now);
    db.prepare("INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, 'hash', 'administrator', ?, ?)")
      .run(ADMIN_2_ID, 'admin_2', 'Admin 2', now);

    // 注入会话
    const insertSession = db.prepare('INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)');
    insertSession.run(TOK_TEACHER_A, JSON.stringify({ userId: TEACHER_A_ID, username: 'teacher_a', role: 'teacher', subRole: 'teacher' }), now, expiresAt);
    insertSession.run(TOK_TEACHER_B, JSON.stringify({ userId: TEACHER_B_ID, username: 'teacher_b', role: 'teacher', subRole: 'teacher' }), now, expiresAt);
    insertSession.run(TOK_ADMIN_1, JSON.stringify({ userId: ADMIN_1_ID, username: 'admin_1', role: 'teacher', subRole: 'administrator' }), now, expiresAt);
    insertSession.run(TOK_ADMIN_2, JSON.stringify({ userId: ADMIN_2_ID, username: 'admin_2', role: 'teacher', subRole: 'administrator' }), now, expiresAt);

    app = express();
    app.use(express.json());

    const mockCtx = {
      app,
      io: { emit: vi.fn(), to: () => ({ emit: vi.fn() }) } as any,
      loginLimiter: ((_req: any, _res: any, next: any) => next()) as any,
      aiLimiter: ((_req: any, _res: any, next: any) => next()) as any,
      activityRegistry: new ActivityRegistry(),
      lessonActiveSegments: new Map(),
      buildAgentSystemInstruction: () => '',
      runGeminiAgentChat: vi.fn(),
      runOpenAIAgentChat: vi.fn().mockResolvedValue({ text: 'mock chat reply' }),
      buildAgentFinalMessage: vi.fn(),
      normalizeToolSchema: vi.fn(),
      buildOpenAITools: vi.fn(),
      executeAgentToolCall: vi.fn(),
      buildOpenAIChatUrl: vi.fn(),
    } as unknown as ServerContext;

    registerPluginsRoutes(mockCtx);
    registerOsRoutes(mockCtx);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(TOK_TEACHER_A, TOK_TEACHER_B, TOK_ADMIN_1, TOK_ADMIN_2);
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(TEACHER_A_ID, TEACHER_B_ID, ADMIN_1_ID, ADMIN_2_ID);
    db.prepare("DELETE FROM ai_providers WHERE id NOT IN ('prov_deepseek', 'prov_minimax')").run();
  });

  beforeEach(() => {
    db.prepare("DELETE FROM ai_providers WHERE id NOT IN ('prov_deepseek', 'prov_minimax')").run();
  });

  describe('1. 列表可见性隔离 (GET /api/ai-providers)', () => {
    it('账号 A 创建的私有 Provider，账号 B（无论教师还是管理员）均不可见', async () => {
      const now = Date.now();
      // 教师 A 的私有模型
      db.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('prov_test_a', 'Provider A', 'https://api.a.com', encryptApiKey('key-a'), 'model-a', TEACHER_A_ID, 0, now, now);

      // 管理员 1 的私有模型
      db.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('prov_test_admin_priv', 'Admin Private', 'https://api.adm.com', encryptApiKey('key-adm'), 'model-adm', ADMIN_1_ID, 0, now + 1, now + 1);

      // 平台共享模型
      db.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('prov_test_shared', 'Shared Provider', 'https://api.shared.com', encryptApiKey('key-shared'), 'model-shared', ADMIN_1_ID, 1, now + 2, now + 2);

      // 1) 教师 A 查看：应看到 prov_test_a 与 prov_test_shared，看不到 prov_test_admin_priv
      const resA = await fetch(`${baseUrl}/api/ai-providers`, { headers: cookie(TOK_TEACHER_A) });
      expect(resA.status).toBe(200);
      const dataA = await resA.json();
      const idsA = dataA.map((p: any) => p.id);
      expect(idsA).toContain('prov_test_a');
      expect(idsA).toContain('prov_test_shared');
      expect(idsA).not.toContain('prov_test_admin_priv');

      // 2) 教师 B 查看：只能看到 prov_test_shared，看不到 prov_test_a 和 prov_test_admin_priv
      const resB = await fetch(`${baseUrl}/api/ai-providers`, { headers: cookie(TOK_TEACHER_B) });
      expect(resB.status).toBe(200);
      const dataB = await resB.json();
      const idsB = dataB.map((p: any) => p.id);
      expect(idsB).not.toContain('prov_test_a');
      expect(idsB).not.toContain('prov_test_admin_priv');
      expect(idsB).toContain('prov_test_shared');

      // 3) 管理员 2 查看：能看到 prov_test_shared，但看不到管理员 1 或教师 A 的私有模型
      const resAdmin2 = await fetch(`${baseUrl}/api/ai-providers`, { headers: cookie(TOK_ADMIN_2) });
      expect(resAdmin2.status).toBe(200);
      const dataAdmin2 = await resAdmin2.json();
      const idsAdmin2 = dataAdmin2.map((p: any) => p.id);
      expect(idsAdmin2).not.toContain('prov_test_a');
      expect(idsAdmin2).not.toContain('prov_test_admin_priv');
      expect(idsAdmin2).toContain('prov_test_shared');

      // 4) 响应中 API Key 均为掩码，绝无明文
      for (const item of dataA) {
        expect(item.api_key).toMatch(/^(\*+|\[UNDECRYPTABLE\]|.{0,4}\*{4}.*)$/);
        expect(item.api_key).not.toBe('key-a');
      }
    });
  });

  describe('2. 新增与生命周期管理鉴权 (POST / PUT / DELETE /api/ai-providers)', () => {
    it('普通教师可以创建自己的私有 Provider，但禁止创建共享 Provider', async () => {
      // 正常创建私有 Provider
      const resCreatePrivate = await fetch(`${baseUrl}/api/ai-providers`, {
        method: 'POST',
        headers: cookie(TOK_TEACHER_A),
        body: JSON.stringify({
          name: 'My DeepSeek',
          api_url: 'https://api.deepseek.com',
          api_key: 'sk-my-private-key',
          model_name: 'deepseek-chat',
        }),
      });
      expect(resCreatePrivate.status).toBe(200);
      const bodyPrivate = await resCreatePrivate.json();
      expect(bodyPrivate.success).toBe(true);
      const newId = bodyPrivate.id;

      const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(newId) as any;
      expect(row.owner_id).toBe(TEACHER_A_ID);
      expect(row.is_shared).toBe(0);

      // 教师试图指定 is_shared: 1 应被 403 拒绝
      const resCreateShared = await fetch(`${baseUrl}/api/ai-providers`, {
        method: 'POST',
        headers: cookie(TOK_TEACHER_A),
        body: JSON.stringify({
          name: 'Illegal Shared',
          api_url: 'https://api.bad.com',
          api_key: 'sk-bad',
          model_name: 'bad-model',
          is_shared: 1,
        }),
      });
      expect(resCreateShared.status).toBe(403);
    });

    it('管理员可以创建平台共享 Provider', async () => {
      const res = await fetch(`${baseUrl}/api/ai-providers`, {
        method: 'POST',
        headers: cookie(TOK_ADMIN_1),
        body: JSON.stringify({
          name: 'School Shared Qwen',
          api_url: 'https://dashscope.aliyuncs.com',
          api_key: 'sk-school-key',
          model_name: 'qwen-max',
          is_shared: 1,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(body.id) as any;
      expect(row.owner_id).toBe(ADMIN_1_ID);
      expect(row.is_shared).toBe(1);
    });

    it('账号 B 无法修改或删除账号 A 的私有 Provider（即便是管理员也不得篡改他人私有模型）', async () => {
      const now = Date.now();
      db.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('prov_test_teacher_a', 'Teacher A Private', 'https://api.a.com', encryptApiKey('key-a'), 'model-a', TEACHER_A_ID, 0, now, now);

      // 1) 教师 B 尝试修改 -> 403
      const resPutTeacherB = await fetch(`${baseUrl}/api/ai-providers/prov_test_teacher_a`, {
        method: 'PUT',
        headers: cookie(TOK_TEACHER_B),
        body: JSON.stringify({ name: 'Tampered Name', api_url: 'https://api.a.com', model_name: 'model-a' }),
      });
      expect(resPutTeacherB.status).toBe(403);

      // 2) 管理员 1 尝试修改教师 A 的私有凭证 -> 403 (严格按账号隔离)
      const resPutAdmin = await fetch(`${baseUrl}/api/ai-providers/prov_test_teacher_a`, {
        method: 'PUT',
        headers: cookie(TOK_ADMIN_1),
        body: JSON.stringify({ name: 'Admin Tampered', api_url: 'https://api.a.com', model_name: 'model-a' }),
      });
      expect(resPutAdmin.status).toBe(403);

      // 3) 教师 B 尝试删除 -> 403
      const resDelTeacherB = await fetch(`${baseUrl}/api/ai-providers/prov_test_teacher_a`, {
        method: 'DELETE',
        headers: cookie(TOK_TEACHER_B),
      });
      expect(resDelTeacherB.status).toBe(403);

      // 4) 管理员 1 尝试删除教师 A 的私有凭证 -> 403
      const resDelAdmin = await fetch(`${baseUrl}/api/ai-providers/prov_test_teacher_a`, {
        method: 'DELETE',
        headers: cookie(TOK_ADMIN_1),
      });
      expect(resDelAdmin.status).toBe(403);

      // 5) 教师 A 本人正常修改与删除
      const resPutOwner = await fetch(`${baseUrl}/api/ai-providers/prov_test_teacher_a`, {
        method: 'PUT',
        headers: cookie(TOK_TEACHER_A),
        body: JSON.stringify({ name: 'Updated by Teacher A', api_url: 'https://api.a.com', model_name: 'model-a' }),
      });
      expect(resPutOwner.status).toBe(200);

      const resDelOwner = await fetch(`${baseUrl}/api/ai-providers/prov_test_teacher_a`, {
        method: 'DELETE',
        headers: cookie(TOK_TEACHER_A),
      });
      expect(resDelOwner.status).toBe(200);
      expect(db.prepare('SELECT id FROM ai_providers WHERE id = ?').get('prov_test_teacher_a')).toBeUndefined();
    });

    it('平台共享模型仅系统管理员可修改和删除，教师无权修改/删除', async () => {
      const now = Date.now();
      db.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('prov_test_shared_1', 'Global Model', 'https://api.shared.com', encryptApiKey('key-s'), 'model-s', ADMIN_1_ID, 1, now, now);

      // 教师 A 尝试修改 -> 403
      const resPutTeacher = await fetch(`${baseUrl}/api/ai-providers/prov_test_shared_1`, {
        method: 'PUT',
        headers: cookie(TOK_TEACHER_A),
        body: JSON.stringify({ name: 'Hacked Shared', api_url: 'https://api.shared.com', model_name: 'model-s' }),
      });
      expect(resPutTeacher.status).toBe(403);

      // 教师 A 尝试删除 -> 403
      const resDelTeacher = await fetch(`${baseUrl}/api/ai-providers/prov_test_shared_1`, {
        method: 'DELETE',
        headers: cookie(TOK_TEACHER_A),
      });
      expect(resDelTeacher.status).toBe(403);

      // 管理员 2 修改 -> 200
      const resPutAdmin = await fetch(`${baseUrl}/api/ai-providers/prov_test_shared_1`, {
        method: 'PUT',
        headers: cookie(TOK_ADMIN_2),
        body: JSON.stringify({ name: 'Admin 2 Updated', api_url: 'https://api.shared.com', model_name: 'model-s' }),
      });
      expect(resPutAdmin.status).toBe(200);

      // 管理员 2 删除 -> 200
      const resDelAdmin = await fetch(`${baseUrl}/api/ai-providers/prov_test_shared_1`, {
        method: 'DELETE',
        headers: cookie(TOK_ADMIN_2),
      });
      expect(resDelAdmin.status).toBe(200);
    });
  });

  describe('3. 连通性测试防探测鉴权 (POST /api/ai-providers/test)', () => {
    it('账号 B 无法使用掩码 Key 测试账号 A 的私有 Provider', async () => {
      const now = Date.now();
      db.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('prov_test_a', 'A Model', 'https://api.openai.com/v1', encryptApiKey('sk-real-secret'), 'gpt-4o', TEACHER_A_ID, 0, now, now);

      // 教师 B 试图通过传递掩码 Key 和目标参数测试教师 A 的 Provider
      const resTestB = await fetch(`${baseUrl}/api/ai-providers/test`, {
        method: 'POST',
        headers: cookie(TOK_TEACHER_B),
        body: JSON.stringify({
          id: 'prov_test_a',
          api_url: 'https://api.openai.com/v1',
          model_name: 'gpt-4o',
          api_key: 'sk-re****cret',
        }),
      });
      // 无法获取非自身且非共享的 Provider API Key
      expect(resTestB.status).toBe(403);
    });
  });

  describe('4. AI 对话与服务调用越权拦截 (resolveAccessibleAiProvider & POST /api/agent/chat)', () => {
    it('账号 B 指定账号 A 的私有 providerId 时，调用被 403 严格拒绝', async () => {
      const now = Date.now();
      db.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('prov_test_a', 'Provider A', 'https://api.a.com', encryptApiKey('key-a'), 'model-a', TEACHER_A_ID, 0, now, now);

      const resChat = await fetch(`${baseUrl}/api/agent/chat`, {
        method: 'POST',
        headers: cookie(TOK_TEACHER_B),
        body: JSON.stringify({
          message: 'Hello Assistant',
          providerId: 'prov_test_a',
        }),
      });

      expect(resChat.status).toBe(403);
      const data = await resChat.json();
      expect(data.error).toBe('PROVIDER_ACCESS_DENIED');
    });

    it('账号 B 未指定 providerId 时，绝不回退使用账号 A 的私有模型', async () => {
      const now = Date.now();
      // 数据库中仅有账号 A 的私有模型
      db.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('prov_test_a', 'Provider A', 'https://api.a.com', encryptApiKey('key-a'), 'model-a', TEACHER_A_ID, 0, now, now);

      // 账号 B 发起对话，未传 providerId
      const resChat = await fetch(`${baseUrl}/api/agent/chat`, {
        method: 'POST',
        headers: cookie(TOK_TEACHER_B),
        body: JSON.stringify({
          message: 'Hello Assistant',
        }),
      });

      // 应该提示未检测到可用的 AI 提供商，而不是默默使用账号 A 的 key
      expect(resChat.status).toBe(400);
      const data = await resChat.json();
      expect(data.error).toBe('NO_AI_PROVIDER');
    });

    it('账号 A 未指定 providerId 时，自动优先选用本人私有模型', async () => {
      const now = Date.now();
      // 账号 A 私有模型
      db.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('prov_test_a', 'Provider A', 'https://api.a.com', encryptApiKey('key-a'), 'model-a', TEACHER_A_ID, 0, now, now);

      // 平台共享模型
      db.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('prov_test_shared', 'Provider Shared', 'https://api.s.com', encryptApiKey('key-s'), 'model-s', ADMIN_1_ID, 1, now + 1, now + 1);

      // 账号 A 解析
      const resolved = resolveAccessibleAiProvider(db, { userId: TEACHER_A_ID });
      expect(resolved.id).toBe('prov_test_a'); // 优先使用本人私有模型
      expect(resolved.api_key).toBe('key-a');

      // 账号 B 解析（无私有模型，回退到共享模型）
      const resolvedB = resolveAccessibleAiProvider(db, { userId: TEACHER_B_ID });
      expect(resolvedB.id).toBe('prov_test_shared');
      expect(resolvedB.api_key).toBe('key-s');
    });

    it('账号 A 可以正常调用自己的私有模型', async () => {
      const now = Date.now();
      db.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('prov_test_a', 'Provider A', 'https://api.a.com', encryptApiKey('key-a'), 'model-a', TEACHER_A_ID, 0, now, now);

      const resChat = await fetch(`${baseUrl}/api/agent/chat`, {
        method: 'POST',
        headers: cookie(TOK_TEACHER_A),
        body: JSON.stringify({
          message: 'Hello Assistant',
          providerId: 'prov_test_a',
        }),
      });

      expect(resChat.status).toBe(200);
      const data = await resChat.json();
      expect(data.text).toBe('mock chat reply');
    });
  });
});
