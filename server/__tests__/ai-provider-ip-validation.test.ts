import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { registerOsRoutes } from '../routes/os.js';
import { runOpenAIAgentChat } from '../ai-agent.js';
import { ScheduleService } from '../services/schedule-service.js';
import { GradingService } from '../services/grading-service.js';
import { encryptApiKey } from '../utils/crypto.js';

describe('Issue #508: AI Provider IP 地址配置、测试与实际调用策略一致性回归测试', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;
  let mockAiServer: Server;
  let mockAiBaseUrl: string;
  const originalFetch = globalThis.fetch;

  const adminToken = 'tok-ip-test-admin';
  const adminId = 'usr-ip-test-admin';
  const cookie = { Cookie: `edu_os_token=${adminToken}`, 'Content-Type': 'application/json' };

  beforeAll(async () => {
    const db = kernelContainer.db;
    const now = Date.now();

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(adminId, 'ip_admin', 'hash', 'administrator', 'IP 测试管理员', now);

    const studentCols = new Set(
      (db.prepare('PRAGMA table_info(students)').all() as Array<{ name: string }>).map((c) => c.name),
    );
    const cols = ['id', 'name'];
    const vals: unknown[] = ['stu-ip-test', '测试学生'];
    if (studentCols.has('student_number')) {
      cols.push('student_number');
      vals.push('2026001');
    }
    if (studentCols.has('created_at')) {
      cols.push('created_at');
      vals.push(now);
    }
    db.prepare(`INSERT OR REPLACE INTO students (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(
      ...vals,
    );

    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'ip_admin' }),
      now,
      now + 3600000,
    );

    // 真实启动一个监听在 127.0.0.1 的 OpenAI 兼容服务端，验证保存、测试与实际调用全链路一致
    const mockAiApp = express();
    mockAiApp.use(express.json());
    mockAiApp.post('/v1/chat/completions', (req, res) => {
      const model = req.body?.model;
      if (model === 'missing-model') {
        return res.status(404).json({ error: { message: 'model not found' } });
      }
      if (req.headers.authorization === 'Bearer bad-key') {
        return res.status(401).json({ error: { message: 'invalid api key' } });
      }
      const userContent = JSON.stringify(req.body?.messages ?? []);
      if (userContent.includes('课表')) {
        return res.json({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    dayOfWeek: 1,
                    periodNumber: 1,
                    className: '高一(1)班',
                    subject: '信息科技',
                    timeSlot: '08:00-08:45',
                    location: '机房1',
                    teacherName: '张老师',
                  },
                ]),
              },
            },
          ],
        });
      }
      return res.json({
        choices: [{ message: { content: 'connected-from-ip-endpoint' } }],
      });
    });
    mockAiApp.post('/html-trap/chat/completions', (_req, res) => {
      res.status(200).type('text/html').send('<!doctype html><html><body>Login</body></html>');
    });

    mockAiServer = createServer(mockAiApp);
    await new Promise<void>((resolve) => mockAiServer.listen(0, '127.0.0.1', resolve));
    const mockPort = (mockAiServer.address() as AddressInfo).port;
    mockAiBaseUrl = `http://127.0.0.1:${mockPort}/v1`;

    app = express();
    app.use(express.json());
    const noopMiddleware: express.RequestHandler = (_req, _res, next) => next();
    const ctx = {
      app,
      io: { to: () => ({ emit: vi.fn() }), emit: vi.fn() },
      aiLimiter: noopMiddleware,
      loginLimiter: noopMiddleware,
      runOpenAIAgentChat,
    } as unknown as Parameters<typeof registerPluginsRoutes>[0] & Parameters<typeof registerOsRoutes>[0];
    registerPluginsRoutes(ctx);
    registerOsRoutes(ctx);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    kernelContainer.db.prepare("DELETE FROM ai_providers WHERE id LIKE 'prov_%'").run();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (mockAiServer) {
      await new Promise<void>((resolve) => mockAiServer.close(() => resolve()));
    }
  });

  it('真实 127.0.0.1 IP + 自定义端口 + /v1 路径：保存、连接测试、Agent 对话与课表 OCR 全链路一致通过', async () => {
    // 1. 保存
    const createRes = await originalFetch(`${baseUrl}/api/ai-providers`, {
      method: 'POST',
      headers: cookie,
      body: JSON.stringify({
        name: 'Local IP Ollama',
        api_url: mockAiBaseUrl,
        api_key: 'sk-local-ip-token',
        model_name: 'qwen2.5:7b',
        is_shared: 1,
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { success: boolean; id: string };
    expect(created.success).toBe(true);

    // 2. 连接测试（使用掩码密钥与已保存 id）
    const testRes = await originalFetch(`${baseUrl}/api/ai-providers/test`, {
      method: 'POST',
      headers: cookie,
      body: JSON.stringify({
        id: created.id,
        api_url: mockAiBaseUrl,
        api_key: 'sk-l****ken',
        model_name: 'qwen2.5:7b',
      }),
    });
    expect(testRes.status).toBe(200);
    const testBody = (await testRes.json()) as { success: boolean };
    expect(testBody.success).toBe(true);

    // 3. 实际 AI 对话调用
    const chatRes = await originalFetch(`${baseUrl}/api/agent/chat`, {
      method: 'POST',
      headers: cookie,
      body: JSON.stringify({
        message: 'Hello local IP model',
        providerId: created.id,
        lang: 'zh',
      }),
    });
    expect(chatRes.status).toBe(200);
    const chatBody = (await chatRes.json()) as { success: boolean; agentText: string };
    expect(chatBody.success).toBe(true);
    expect(chatBody.agentText).toBe('connected-from-ip-endpoint');

    // 4. 课表 OCR 调用（此前被 isSafeExternalUrl 误拦截）
    const scheduleService = new ScheduleService(kernelContainer.db);
    const ocrResult = await scheduleService.processTimetableOcr(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      { providerId: created.id, userId: adminId },
    );
    expect(ocrResult.entries).toHaveLength(1);
    expect(ocrResult.entries[0].className).toBe('高一(1)班');

    // 5. 学期 AI 评语调用（此前也被 isSafeExternalUrl 误拦截）
    const gradingService = new GradingService(kernelContainer.db);
    const evalText = await gradingService.generateSemesterAiEvaluation({
      classId: 'cls-ip-test',
      studentId: 'stu-ip-test',
      providerId: created.id,
      userId: adminId,
    });
    expect(evalText).toBe('connected-from-ip-endpoint');
  });

  it('内网私网 IP（192.168.x.x / 10.x.x.x / 172.16.x.x）与公网 IP 均可通过校验、保存与连接测试', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith(baseUrl)) {
        return originalFetch(input, init);
      }
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const supportedUrls = [
      'http://192.168.1.100:11434/v1',
      'http://10.0.0.8:8000/openai/v1/',
      'http://172.16.5.20:8080',
      'http://[::1]:11434/v1',
      'https://8.8.8.8:8443/v1',
    ];

    for (const apiUrl of supportedUrls) {
      const saveRes = await originalFetch(`${baseUrl}/api/ai-providers`, {
        method: 'POST',
        headers: cookie,
        body: JSON.stringify({
          name: `Test ${apiUrl}`,
          api_url: apiUrl,
          api_key: 'sk-test-ip',
          model_name: 'llama3',
        }),
      });
      expect(saveRes.status, `POST save should accept ${apiUrl}`).toBe(200);

      const testRes = await originalFetch(`${baseUrl}/api/ai-providers/test`, {
        method: 'POST',
        headers: cookie,
        body: JSON.stringify({
          api_url: apiUrl,
          api_key: 'sk-test-ip',
          model_name: 'llama3',
        }),
      });
      expect(testRes.status, `POST test should accept ${apiUrl}`).toBe(200);
    }
  });

  it('被安全策略禁止或格式不支持的 URL 在保存、编辑、测试与服务调用中保持一致拒绝并给出明确原因', async () => {
    const blockedUrls = [
      '192.168.1.100:11434/v1',
      'ftp://192.168.1.100/v1',
      'http://user:pass@192.168.1.100/v1',
      'http://169.254.169.254/latest/meta-data/',
      'http://[fe80::1]/v1',
      'http://metadata.google.internal/v1',
      'http://0.0.0.0:11434/v1',
    ];

    // 先插入一条合法记录供 PUT 校验测试
    const validSave = await originalFetch(`${baseUrl}/api/ai-providers`, {
      method: 'POST',
      headers: cookie,
      body: JSON.stringify({
        name: 'Valid Base',
        api_url: mockAiBaseUrl,
        api_key: 'sk-valid',
        model_name: 'qwen2.5',
      }),
    });
    const { id: validId } = (await validSave.json()) as { id: string };

    for (const badUrl of blockedUrls) {
      const postRes = await originalFetch(`${baseUrl}/api/ai-providers`, {
        method: 'POST',
        headers: cookie,
        body: JSON.stringify({
          name: 'Bad Provider',
          api_url: badUrl,
          api_key: 'sk-bad',
          model_name: 'gpt-4o',
        }),
      });
      expect(postRes.status, `POST should reject ${badUrl}`).toBe(400);

      const putRes = await originalFetch(`${baseUrl}/api/ai-providers/${validId}`, {
        method: 'PUT',
        headers: cookie,
        body: JSON.stringify({
          name: 'Bad Update',
          api_url: badUrl,
          model_name: 'gpt-4o',
        }),
      });
      expect(putRes.status, `PUT should reject ${badUrl}`).toBe(400);

      const testRes = await originalFetch(`${baseUrl}/api/ai-providers/test`, {
        method: 'POST',
        headers: cookie,
        body: JSON.stringify({
          api_url: badUrl,
          api_key: 'sk-bad',
          model_name: 'gpt-4o',
        }),
      });
      expect(testRes.status, `POST /test should reject ${badUrl}`).toBe(400);
      const testJson = (await testRes.json()) as { stage: string; error: string };
      expect(testJson.stage).toBe('url_validation');
      expect(testJson.error.length).toBeGreaterThan(0);
    }

    // 即便数据库存在历史遗留的危险地址，服务层也会同样阻断
    const db = kernelContainer.db;
    const now = Date.now();
    db.prepare(
      'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'prov_legacy_blocked',
      'Legacy Metadata',
      'http://169.254.169.254/v1',
      encryptApiKey('sk-x'),
      'm',
      adminId,
      0,
      now,
      now,
    );
    const gradingService = new GradingService(db);
    await expect(
      gradingService.generateSemesterAiEvaluation({
        classId: 'cls-ip-test',
        studentId: 'stu-ip-test',
        providerId: 'prov_legacy_blocked',
        userId: adminId,
      }),
    ).rejects.toThrow(/Unsafe AI Provider URL/);
  });

  it('部分检测失败时准确反馈具体失败阶段（401 鉴权失败、404 路径/模型缺失、HTML 响应格式异常、重定向阻断）', async () => {
    const authFailRes = await originalFetch(`${baseUrl}/api/ai-providers/test`, {
      method: 'POST',
      headers: cookie,
      body: JSON.stringify({
        api_url: mockAiBaseUrl,
        api_key: 'bad-key',
        model_name: 'qwen2.5:7b',
      }),
    });
    expect(authFailRes.status).toBe(401);
    const authJson = (await authFailRes.json()) as { stage: string; error: string };
    expect(authJson.stage).toBe('chat_completion');
    expect(authJson.error).toContain('authentication failed');

    const modelFailRes = await originalFetch(`${baseUrl}/api/ai-providers/test`, {
      method: 'POST',
      headers: cookie,
      body: JSON.stringify({
        api_url: mockAiBaseUrl,
        api_key: 'sk-ok',
        model_name: 'missing-model',
      }),
    });
    expect(modelFailRes.status).toBe(404);
    const modelJson = (await modelFailRes.json()) as { stage: string; error: string };
    expect(modelJson.stage).toBe('chat_completion');
    expect(modelJson.error).toContain('missing-model');

    const htmlTrapUrl = mockAiBaseUrl.replace('/v1', '/html-trap');
    const htmlFailRes = await originalFetch(`${baseUrl}/api/ai-providers/test`, {
      method: 'POST',
      headers: cookie,
      body: JSON.stringify({
        api_url: htmlTrapUrl,
        api_key: 'sk-ok',
        model_name: 'qwen2.5:7b',
      }),
    });
    expect(htmlFailRes.status).toBe(422);
    const htmlJson = (await htmlFailRes.json()) as { stage: string; error: string };
    expect(htmlJson.stage).toBe('response_format');
    expect(htmlJson.error).toContain('HTML');

    // 重定向防护：公网地址 302 跳往私网被阻断
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith(baseUrl)) {
        return originalFetch(input, init);
      }
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1:8080/internal' },
        }),
      );
    });

    const redirectFailRes = await originalFetch(`${baseUrl}/api/ai-providers/test`, {
      method: 'POST',
      headers: cookie,
      body: JSON.stringify({
        api_url: 'https://public-ai.example.com/v1',
        api_key: 'sk-ok',
        model_name: 'gpt-4o',
      }),
    });
    expect(redirectFailRes.status).toBe(400);
    const redirectJson = (await redirectFailRes.json()) as { stage: string; error: string };
    expect(redirectJson.stage).toBe('redirect_guard');
    expect(redirectJson.error).toContain('redirect blocked');
  });
});
