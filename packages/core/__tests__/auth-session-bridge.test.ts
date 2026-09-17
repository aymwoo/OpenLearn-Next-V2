import { describe, it, expect, beforeEach } from 'vitest';
import { kernelContainer } from '../kernel/index.js';
import { IAuthSessionBridgeToken } from '../di/interfaces.js';
import { getValidSession } from '../../../server/middleware/auth.js';
import { pluginApiGatewayMiddleware } from '../../../server/routes/plugin-api-gateway.js';
import type { Request, Response } from 'express';

describe('AuthSessionBridgeService & Gateway SSO Tests (LTI 1.3)', () => {
  beforeEach(async () => {
    await kernelContainer.ready;
  });

  describe('AuthSessionBridgeService (DI & Database)', () => {
    it('应该能从 DI 容器中解析 IAuthSessionBridgeToken 服务', async () => {
      const authBridge = await kernelContainer.serviceRegistry.resolve(IAuthSessionBridgeToken);
      expect(authBridge).toBeDefined();
      expect(typeof authBridge.createSession).toBe('function');
    });

    it('为学生创建会话并自动同步学生记录', async () => {
      const authBridge = await kernelContainer.serviceRegistry.resolve(IAuthSessionBridgeToken);
      const testStudentId = `lti_stud_${Date.now()}`;
      const res = await authBridge.createSession({
        userId: testStudentId,
        username: `stud_${Date.now()}`,
        role: 'student',
        name: 'LTI 测试学生',
        email: 'lti_student@school.edu',
      });

      expect(res.token).toMatch(/^token_[0-9a-f]{32}$/);
      expect(res.maxAge).toBe(604800);

      // 验证 students 表记录存在
      const student = kernelContainer.db.prepare('SELECT * FROM students WHERE id = ?').get(testStudentId) as any;
      expect(student).toBeDefined();
      expect(student.name).toBe('LTI 测试学生');
      expect(student.email).toBe('lti_student@school.edu');

      // 验证 client_sessions 会话有效
      const session = getValidSession(res.token);
      expect(session).toBeDefined();
      expect(session.userId).toBe(testStudentId);
      expect(session.role).toBe('student');
      expect(session.name).toBe('LTI 测试学生');
    });

    it('为教师创建会话并自动同步用户记录', async () => {
      const authBridge = await kernelContainer.serviceRegistry.resolve(IAuthSessionBridgeToken);
      const testTeacherId = `lti_teach_${Date.now()}`;
      const res = await authBridge.createSession({
        userId: testTeacherId,
        username: `teach_${Date.now()}`,
        role: 'teacher',
        name: 'LTI 授课教师',
        email: 'lti_teacher@school.edu',
      });

      expect(res.token).toMatch(/^token_[0-9a-f]{32}$/);

      // 验证 users 表记录存在
      const user = kernelContainer.db.prepare('SELECT * FROM users WHERE id = ?').get(testTeacherId) as any;
      expect(user).toBeDefined();
      expect(user.role).toBe('teacher');
      expect(user.name).toBe('LTI 授课教师');

      // 验证 client_sessions 会话有效
      const session = getValidSession(res.token);
      expect(session).toBeDefined();
      expect(session.userId).toBe(testTeacherId);
      expect(session.role).toBe('teacher');
    });

    it('参数不合法时抛出清晰异常', async () => {
      const authBridge = await kernelContainer.serviceRegistry.resolve(IAuthSessionBridgeToken);
      await expect(authBridge.createSession({} as any)).rejects.toThrow('userId and role are required');
    });
  });

  describe('PluginApiGateway Session Cookie (Integration)', () => {
    function createMockRes() {
      const res: any = {
        statusCode: 200,
        body: null,
        headers: {} as Record<string, string>,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(data: any) {
          this.body = data;
          return this;
        },
        send(data: any) {
          this.body = data;
          return this;
        },
        setHeader(k: string, v: any) {
          this.headers[k] = v;
          return this;
        },
        getHeader(k: string) {
          return this.headers[k];
        },
      };
      return res;
    }

    it('当插件响应包含 sessionToken 时，网关应安全下发 SameSite 授权 Cookie', async () => {
      const pluginHost = kernelContainer.pluginHost;
      const testPluginId = 'test-lti-sso';

      const manifest = {
        id: testPluginId,
        name: 'Test LTI SSO',
        version: '1.0.0',
        main: 'index.js',
        requires: ['@openlearn/core:IAuthSessionBridgeService@^1.0.0'],
        api: {
          routes: [
            { method: 'POST', path: '/launch', auth: false },
          ],
        },
      };

      kernelContainer.db.prepare(`
        INSERT OR REPLACE INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        testPluginId,
        manifest.name,
        JSON.stringify(manifest),
        '',
        null,
        'active',
        Date.now(),
        'esm',
        'inline',
      );

      // 模拟插件端点返回 sessionToken 与 302 重定向
      const dummyToken = 'token_' + 'a'.repeat(32);
      const originalDispatch = pluginHost.dispatchHttpRequest.bind(pluginHost);
      pluginHost.dispatchHttpRequest = async () => ({
        status: 302,
        headers: {
          Location: '/#/lesson/101',
        },
        body: '',
        sessionToken: dummyToken,
      });

      const req: any = {
        method: 'POST',
        params: { pluginId: testPluginId, 0: 'launch' },
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: { id_token: 'dummy.jwt.token' },
        query: {},
        ip: '127.0.0.1',
      };
      const res = createMockRes();

      try {
        await pluginApiGatewayMiddleware(req as Request, res as Response, () => {});

        expect(res.statusCode).toBe(302);
        expect(res.getHeader('Location')).toBe('/#/lesson/101');
        const cookie = res.getHeader('Set-Cookie');
        expect(cookie).toBeDefined();
        expect(cookie).toContain(`edu_os_token=${dummyToken}`);
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=');
      } finally {
        pluginHost.dispatchHttpRequest = originalDispatch;
        kernelContainer.db.prepare('DELETE FROM plugins WHERE id = ?').run(testPluginId);
      }
    });

    it('未声明 IAuthSessionBridgeService 特权的普通插件若返回 sessionToken，网关应拒绝下发 Cookie', async () => {
      const pluginHost = kernelContainer.pluginHost;
      const unauthPluginId = 'test-unauthorized-sso';

      const manifest = {
        id: unauthPluginId,
        name: 'Test Unauthorized SSO',
        version: '1.0.0',
        main: 'index.js',
        // 未声明 requires: ['@openlearn/core:IAuthSessionBridgeService@^1.0.0']
        api: {
          routes: [
            { method: 'POST', path: '/malicious-login', auth: false },
          ],
        },
      };

      kernelContainer.db.prepare(`
        INSERT OR REPLACE INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        unauthPluginId,
        manifest.name,
        JSON.stringify(manifest),
        '',
        null,
        'active',
        Date.now(),
        'esm',
        'inline',
      );

      const dummyToken = 'token_' + 'b'.repeat(32);
      const originalDispatch = pluginHost.dispatchHttpRequest.bind(pluginHost);
      pluginHost.dispatchHttpRequest = async () => ({
        status: 200,
        headers: {},
        body: { ok: true },
        sessionToken: dummyToken,
      });

      const req: any = {
        method: 'POST',
        params: { pluginId: unauthPluginId, 0: 'malicious-login' },
        headers: {},
        body: {},
        query: {},
        ip: '127.0.0.1',
      };
      const res = createMockRes();

      try {
        await pluginApiGatewayMiddleware(req as Request, res as Response, () => {});

        expect(res.statusCode).toBe(200);
        // 未声明特权的插件，其 sessionToken 必须被网关阻断，不得注入 Set-Cookie
        expect(res.getHeader('Set-Cookie')).toBeUndefined();
      } finally {
        pluginHost.dispatchHttpRequest = originalDispatch;
        kernelContainer.db.prepare('DELETE FROM plugins WHERE id = ?').run(unauthPluginId);
      }
    });

    it('非授权的任意 Set-Cookie 仍然被安全网关严格清洗剥离', async () => {
      const pluginHost = kernelContainer.pluginHost;
      const testPluginId = 'test-lti-sso-strip';

      const manifest = {
        id: testPluginId,
        name: 'Test LTI SSO Strip',
        version: '1.0.0',
        main: 'index.js',
        api: {
          routes: [
            { method: 'GET', path: '/test', auth: false },
          ],
        },
      };

      kernelContainer.db.prepare(`
        INSERT OR REPLACE INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        testPluginId,
        manifest.name,
        JSON.stringify(manifest),
        '',
        null,
        'active',
        Date.now(),
        'esm',
        'inline',
      );

      const originalDispatch = pluginHost.dispatchHttpRequest.bind(pluginHost);
      pluginHost.dispatchHttpRequest = async () => ({
        status: 200,
        headers: {
          'Set-Cookie': 'malicious_cookie=hacked',
          'X-Custom-Safe': 'safe-value',
        },
        body: { ok: true },
      });

      const req: any = {
        method: 'GET',
        params: { pluginId: testPluginId, 0: 'test' },
        headers: {},
        body: {},
        query: {},
        ip: '127.0.0.1',
      };
      const res = createMockRes();

      try {
        await pluginApiGatewayMiddleware(req as Request, res as Response, () => {});

        expect(res.statusCode).toBe(200);
        // Set-Cookie 必须被彻底剥离
        expect(res.getHeader('Set-Cookie')).toBeUndefined();
        // 白名单安全 Header 允许通过
        expect(res.getHeader('X-Custom-Safe')).toBe('safe-value');
      } finally {
        pluginHost.dispatchHttpRequest = originalDispatch;
        kernelContainer.db.prepare('DELETE FROM plugins WHERE id = ?').run(testPluginId);
      }
    });
  });
});
