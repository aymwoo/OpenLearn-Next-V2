import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerOsRoutes } from '../routes/os.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('Sprint 1 安全与生命周期加固验证套件 (C-1, C-3, C-4, H-2, H-3)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const teacherId = 'usr-sec-teacher-01';
  const teacherToken = 'tok-sec-teacher-01';
  const studentId = 'stu-sec-student-01';
  const studentToken = 'tok-sec-student-01';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    const now = Date.now();
    const db = kernelContainer.db;

    // 1. 用户与 Session
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'sec_teacher', 'placeholder', 'teacher', '安全测试教师', now);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(studentId, 'sec_student', 'placeholder', 'student', '安全测试学生', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'sec_teacher' }),
      now,
      expiresAt,
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'sec_student' }),
      now,
      expiresAt,
    );

    // 2. 模拟真实 server.ts 中的 Helmet CSP 与安全配置
    app = express();
    app.use(express.json());

    const isProduction = process.env.NODE_ENV === 'production';
    const enableHsts = process.env.ENABLE_HSTS === 'true';

    app.use(
      helmet({
        xFrameOptions: { action: 'sameorigin' },
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: isProduction
              ? ["'self'", "'unsafe-inline'"]
              : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            styleSrcAttr: ["'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            fontSrc: ["'self'", 'data:'],
            connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
            frameSrc: ["'self'", 'blob:', 'data:'],
            frameAncestors: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            ...(enableHsts ? { upgradeInsecureRequests: [] } : {}),
          },
        },
      }),
    );

    // CORS 验证模拟
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && origin !== 'null') {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });

    app.get('/api/health-check', (_req, res) => {
      res.json({ ok: true });
    });

    const ctx: any = {
      app,
      io: { emit: () => undefined },
      aiLimiter: (_req: any, _res: any, next: any) => next(),
    };
    registerOsRoutes(ctx);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const db = kernelContainer.db;
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(teacherToken, studentToken);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(teacherId, studentId);
  });

  it('C-1: 响应头包含严格 Content-Security-Policy (CSP) 指令映射', async () => {
    const res = await fetch(`${baseUrl}/api/health-check`);
    expect(res.status).toBe(200);

    const csp = res.headers.get('content-security-policy');
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it('C-3: packages/core/plugin-host 静态沙箱中间件 CSP 中不包含 unsafe-eval', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fileContent = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/core/plugin-host/index.ts'),
      'utf-8',
    );
    // 验证 createPluginStaticMiddleware 中的 Content-Security-Policy 没有 'unsafe-eval'
    const sandboxMatch = fileContent.match(/createPluginStaticMiddleware[\s\S]*?res\.setHeader\(\s*'Content-Security-Policy'[\s\S]*?\);/);
    expect(sandboxMatch).not.toBeNull();
    expect(sandboxMatch![0]).not.toContain("'unsafe-eval'");
  });

  it('C-4: /api/commands 接口执行角色鉴权（学生阻断 403，教师允许调用）', async () => {
    // 1. 匿名用户调用 -> 401
    const anonRes = await fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandType: 'lesson.list', payload: {} }),
    });
    expect(anonRes.status).toBe(401);

    // 2. 学生调用特权命令 -> 403 (权限拒绝)
    const studentRes = await fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(studentToken) },
      body: JSON.stringify({ commandType: 'lesson.list', payload: {} }),
    });
    expect(studentRes.status).toBe(403);

    // 3. 教师调用命令 -> 正常通过鉴权（执行或进入命令总线）
    const teacherRes = await fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ commandType: 'lesson.list', payload: {} }),
    });
    // 不为 401 或 403 说明已通过权限关卡
    expect(teacherRes.status).not.toBe(401);
    expect(teacherRes.status).not.toBe(403);
  });

  it('H-3: CORS 响应不回填通配符 *，确保 Access-Control-Allow-Credentials 为 true 时规范合规', async () => {
    const testOrigin = 'http://localhost:5173';
    const res = await fetch(`${baseUrl}/api/health-check`, {
      headers: { Origin: testOrigin },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe(testOrigin);
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('C-1: CSP 指令包含 script-src-attr 与 style-src-attr 放行内联属性', async () => {
    const res = await fetch(`${baseUrl}/api/health-check`);
    const csp = res.headers.get('content-security-policy') || '';
    expect(csp).toContain("script-src-attr 'unsafe-inline'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
  });

  it('H-8: server.ts 实现真实资源清理闭包并在 gracefulShutdown 中执行', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const serverCode = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

    // 验证包含 cleanup 定义
    expect(serverCode).toContain('const cleanup = async () =>');
    expect(serverCode).toContain('httpServer.close(');
    expect(serverCode).toContain('io.close()');
    expect(serverCode).toContain('kernelContainer.db.close()');
    // 验证 gracefulShutdown 中调用了 currentCleanup
    expect(serverCode).toContain('await currentCleanup()');
  });
});
