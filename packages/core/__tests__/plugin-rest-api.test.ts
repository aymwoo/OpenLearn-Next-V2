import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { PluginHttpRouter } from '../plugin-host/http-router.js';
import { PluginHost } from '../plugin-host/index.js';
import { WorkerManager } from '../worker-runtime/worker-manager.js';
import { ServiceRegistry } from '../di/service-registry.js';
import { EsmLoader } from '../esm-loader/esm-loader.js';
import { CapabilityGuard } from '../capability-system/index.js';
import Database from 'better-sqlite3';
import { pluginApiGatewayMiddleware } from '../../../server/routes/plugin-api-gateway.js';
import { kernelContainer } from '../kernel/index.js';
import type { Request, Response } from 'express';

import { Kernel } from '../kernel/index.js';

describe('Plugin RESTful API & Security Gateway Tests (V5.2)', () => {
  let kernel: Kernel;
  let db: Database.Database;
  let pluginHost: PluginHost;

  beforeEach(async () => {
    kernel = kernelContainer;
    await kernel.ready;
    pluginHost = kernel.pluginHost;
    db = kernel.db;

    // 清理可能残留的测试会话
    try {
      db.prepare("DELETE FROM client_sessions WHERE id LIKE 'session_%'").run();
      db.prepare("DELETE FROM plugins WHERE id LIKE 'uuid-worker-rest-%'").run();
    } catch {}
  });

  afterEach(async () => {
    try {
      const plugins = pluginHost.listPlugins();
      for (const p of plugins) {
        if (p.state === 'active' && !p.id.startsWith('@openlearn/')) {
          try {
            await pluginHost.deactivatePlugin(p.id);
          } catch {}
        }
      }
      await kernel.workerManager?.shutdownAll?.();
    } catch {}
  });

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

  // ── 1. PluginHttpRouter 基础路由匹配 ──────────────────────────────────
  describe('PluginHttpRouter (Unit)', () => {
    it('应该正确匹配路由并提取动态路径参数 (:param)', async () => {
      const router = new PluginHttpRouter();
      router.get('/students/:studentId/grades/:gradeId', async (req) => {
        return {
          status: 200,
          body: {
            studentId: req.params.studentId,
            gradeId: req.params.gradeId,
            echoQuery: req.query,
          },
        };
      });

      const res = await router.handle({
        method: 'GET',
        path: '/students/stu_1001/grades/grade_88',
        params: {},
        query: { term: '2026-spring' },
        headers: {},
        body: null,
        ip: '127.0.0.1',
        actor: { actorId: 'user:1', role: 'teacher' },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        studentId: 'stu_1001',
        gradeId: 'grade_88',
        echoQuery: { term: '2026-spring' },
      });
    });

    it('未命中路由应返回 404', async () => {
      const router = new PluginHttpRouter();
      router.post('/submit', async () => ({ success: true }));

      const res = await router.handle({
        method: 'GET',
        path: '/not-exists',
        params: {},
        query: {},
        headers: {},
        body: null,
        ip: '127.0.0.1',
        actor: { actorId: 'anon', role: 'anonymous' },
      });

      expect(res.status).toBe(404);
      expect((res.body as any)?.error).toContain('Cannot GET /not-exists');
    });

    it('Handler 直接返回普通对象时应自动包装为 200 OK', async () => {
      const router = new PluginHttpRouter();
      router.get('/hello', async () => {
        return { message: 'world' };
      });

      const res = await router.handle({
        method: 'GET',
        path: '/hello',
        params: {},
        query: {},
        headers: {},
        body: null,
        ip: '127.0.0.1',
        actor: { actorId: 'user:1', role: 'teacher' },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'world' });
    });
  });

  // ── 2. Inline 模式插件 RESTful API 派发 ──────────────────────────────
  describe('Inline Plugin RESTful Dispatch', () => {
    it('应该支持 Inline 模式插件在 activate 中注册端点并响应请求', async () => {
      const inlinePlugin = {
        manifest: {
          id: 'ext-inline-demo',
          name: 'Inline Demo Plugin',
          version: '1.0.0',
          main: 'index.js',
          engines: { openlearn: '>=0.2.5' },
        },
        activate: async (ctx: any) => {
          ctx.http.get('/info', async (req: any) => {
            return {
              plugin: ctx.pluginId,
              requester: req.actor.actorId,
            };
          });
          ctx.http.post('/items', async (req: any) => {
            return {
              status: 201,
              body: { created: true, item: req.body },
            };
          });
        },
      };

      pluginHost.registerPreloadedPlugin('ext-inline-demo', inlinePlugin);
      await pluginHost.activatePlugin('ext-inline-demo');

      // GET 测试
      const getRes = await pluginHost.dispatchHttpRequest('ext-inline-demo', {
        method: 'GET',
        path: '/info',
        params: {},
        query: {},
        headers: {},
        body: null,
        ip: '127.0.0.1',
        actor: { actorId: 'teacher-101', role: 'teacher' },
      });
      expect(getRes.status).toBe(200);
      expect(getRes.body).toEqual({ plugin: 'ext-inline-demo', requester: 'teacher-101' });

      // POST 测试
      const postRes = await pluginHost.dispatchHttpRequest('ext-inline-demo', {
        method: 'POST',
        path: '/items',
        params: {},
        query: {},
        headers: {},
        body: { title: 'Assignment 1' },
        ip: '127.0.0.1',
        actor: { actorId: 'teacher-101', role: 'teacher' },
      });
      expect(postRes.status).toBe(201);
      expect(postRes.body).toEqual({ created: true, item: { title: 'Assignment 1' } });
    });
  });

  // ── 3. Worker 隔离模式跨线程 RESTful API RPC 派发 ────────────────────
  describe('Worker Mode RESTful RPC Dispatch', () => {
    it('应该支持 Worker 隔离插件通过 RPC 接收 HTTP 请求并返回 DTO 响应', async () => {
      const manifest = {
        id: 'ext-worker-rest',
        name: 'Worker REST Plugin',
        version: '1.0.0',
        main: 'index.js',
        engines: { openlearn: '>=0.2.5' },
      };

      const workerCode = `
        export default {
          activate: async (ctx) => {
            ctx.http.get('/calc', async (req) => {
              const a = Number(req.query.a || 0);
              const b = Number(req.query.b || 0);
              return { sum: a + b };
            });

            ctx.http.post('/echo', async (req) => {
              return {
                status: 200,
                headers: { 'x-plugin-source': 'worker-thread' },
                body: { echoed: req.body, fromUser: req.actor.actorId }
              };
            });
          }
        };
      `;

      db.prepare(`
        INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'uuid-worker-rest-1',
        manifest.name,
        JSON.stringify(manifest),
        workerCode,
        null,
        'installed',
        Date.now(),
        'esm',
        'worker'
      );

      await pluginHost.activatePlugin('uuid-worker-rest-1', { mode: 'worker' });

      // 1. GET 计算接口
      const calcRes = await pluginHost.dispatchHttpRequest('ext-worker-rest', {
        method: 'GET',
        path: '/calc',
        params: {},
        query: { a: '40', b: '2' },
        headers: {},
        body: null,
        ip: '127.0.0.1',
        actor: { actorId: 'student-42', role: 'student' },
      });

      expect(calcRes.status).toBe(200);
      expect(calcRes.body).toEqual({ sum: 42 });

      // 2. POST 回显接口
      const echoRes = await pluginHost.dispatchHttpRequest('uuid-worker-rest-1', {
        method: 'POST',
        path: '/echo',
        params: {},
        query: {},
        headers: {},
        body: { score: 98.5 },
        ip: '127.0.0.1',
        actor: { actorId: 'teacher-admin', role: 'administrator' },
      });

      expect(echoRes.status).toBe(200);
      expect(echoRes.headers?.['x-plugin-source']).toBe('worker-thread');
      expect((echoRes.body as any)?.echoed).toEqual({ score: 98.5 });
      expect((echoRes.body as any)?.fromUser).toBe('teacher-admin');
    });
  });

  // ── 4. 安全网关前置防御与 RBAC 规则拦截 ─────────────────────────────
  describe('PluginApiGateway Security & RBAC', () => {
    it('未认证用户访问需要登录的路由应被拦截并返回 401', async () => {
      const manifest = {
        id: 'ext-secure-hub',
        name: 'Secure Hub',
        version: '1.0.0',
        main: 'index.js',
        api: {
          routes: [
            { method: 'GET', path: '/private-data', auth: true },
          ],
        },
      };
      pluginHost.registerPreloadedPlugin('ext-secure-hub', {
        manifest,
        activate: async () => {},
      });
      await pluginHost.activatePlugin('ext-secure-hub');

      // 模拟未经认证的 Express 请求
      const req: Partial<Request> = {
        params: { pluginId: 'ext-secure-hub', 0: 'private-data' } as any,
        method: 'GET',
        headers: {},
        query: {},
      };
      const res = createMockRes();

      await pluginApiGatewayMiddleware(req as Request, res as Response, () => {});

      expect(res.statusCode).toBe(401);
      expect(res.body?.error).toContain('Authentication required');
    });

    it('角色不匹配的用户访问 RBAC 受控端点应被拦截并返回 403', async () => {
      const manifest = {
        id: 'ext-grade-hub',
        name: 'Grade Hub',
        version: '1.0.0',
        main: 'index.js',
        api: {
          routes: [
            { method: 'POST', path: '/grade', auth: true, roles: ['teacher', 'administrator'] },
          ],
        },
      };
      pluginHost.registerPreloadedPlugin('ext-grade-hub', {
        manifest,
        activate: async () => {},
      });
      await pluginHost.activatePlugin('ext-grade-hub');

      // 模拟学生登录会话
      const studentToken = 'session_student_01';
      db.prepare(`
        INSERT INTO client_sessions (id, session_data, expires_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(
        studentToken,
        JSON.stringify({ userId: 'u_student_1', username: 'student1', role: 'student' }),
        Date.now() + 3600000,
        Date.now()
      );

      const req: Partial<Request> = {
        params: { pluginId: 'ext-grade-hub', 0: 'grade' } as any,
        method: 'POST',
        headers: { cookie: `edu_os_token=${studentToken}` },
        query: {},
      };
      const res = createMockRes();

      await pluginApiGatewayMiddleware(req as Request, res as Response, () => {});

      expect(res.statusCode).toBe(403);
      expect(res.body?.error).toContain('Forbidden');
    });

    it('显式声明 auth: false 的公共接口无需登录直接放行', async () => {
      const manifest = {
        id: 'ext-public-hub',
        name: 'Public Hub',
        version: '1.0.0',
        main: 'index.js',
        api: {
          routes: [
            { method: 'GET', path: '/public-status', auth: false },
          ],
        },
      };
      pluginHost.registerPreloadedPlugin('ext-public-hub', {
        manifest,
        activate: async (ctx: any) => {
          ctx.http.get('/public-status', async () => ({ online: true }));
        },
      });
      await pluginHost.activatePlugin('ext-public-hub');

      const req: Partial<Request> = {
        params: { pluginId: 'ext-public-hub', 0: 'public-status' } as any,
        method: 'GET',
        headers: {},
        query: {},
      };
      const res = createMockRes();

      await pluginApiGatewayMiddleware(req as Request, res as Response, () => {});

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ online: true });
    });

    it('探测路径遍历攻击 (../) 应被立即阻断并返回 400', async () => {
      const req: Partial<Request> = {
        params: { pluginId: 'ext-demo', 0: '../../etc/passwd' } as any,
        method: 'GET',
        headers: {},
        query: {},
      };
      const res = createMockRes();

      await pluginApiGatewayMiddleware(req as Request, res as Response, () => {});

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('Path traversal attempt detected');
    });

    it('安全网关必须强制过滤剥离插件试图注入的高危响应头 (Set-Cookie, CSP 等)', async () => {
      const manifest = {
        id: 'ext-sneaky-plugin',
        name: 'Sneaky Plugin',
        version: '1.0.0',
        main: 'index.js',
        api: {
          routes: [{ method: 'GET', path: '/set-cookie-hack', auth: false }],
        },
      };

      pluginHost.registerPreloadedPlugin('ext-sneaky-plugin', {
        manifest,
        activate: async (ctx: any) => {
          ctx.http.get('/set-cookie-hack', async () => {
            return {
              status: 200,
              headers: {
                'Set-Cookie': 'malicious_session=hijacked; Path=/',
                'Content-Security-Policy': 'default-src *',
                'X-Safe-Custom-Header': 'safe-value-123',
              },
              body: { ok: true },
            };
          });
        },
      });
      await pluginHost.activatePlugin('ext-sneaky-plugin');

      const req: Partial<Request> = {
        params: { pluginId: 'ext-sneaky-plugin', 0: 'set-cookie-hack' } as any,
        method: 'GET',
        headers: {},
        query: {},
      };
      const res = createMockRes();

      await pluginApiGatewayMiddleware(req as Request, res as Response, () => {});

      // 验证：高危头被清洗剥离，安全头成功放行
      expect(res.headers['Set-Cookie']).toBeUndefined();
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.headers['Content-Security-Policy']).toBeUndefined();
      expect(res.headers['X-Safe-Custom-Header']).toBe('safe-value-123');
    });
  });
});
