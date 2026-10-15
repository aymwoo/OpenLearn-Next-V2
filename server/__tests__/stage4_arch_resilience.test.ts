import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import {
  isOriginAllowed,
  createCorsMiddleware,
  createSocketIoCors,
  resolveConfiguredOrigins,
} from '../middleware/cors.js';
import { registerHealthRoutes } from '../routes/health.js';
import { getNetworkIps, formatTerminalHyperlink } from '../utils/host-network.js';
import { sendSafeError } from '../utils/error-handler.js';

describe('Stage 4 Server Architecture & Resilience Suite', () => {
  const activeServers: Server[] = [];

  const startTestApp = async (app: express.Express): Promise<string> => {
    return new Promise((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => {
        activeServers.push(server);
        const port = (server.address() as any).port;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  };

  afterAll(() => {
    for (const server of activeServers) {
      try {
        server.close();
      } catch {}
    }
  });

  describe('CORS and Origin Security (server/middleware/cors.ts)', () => {
    it('resolveConfiguredOrigins correctly parses comma-separated environments', () => {
      expect(resolveConfiguredOrigins('')).toEqual([]);
      expect(resolveConfiguredOrigins('https://example.com, https://app.openlearn.org ')).toEqual([
        'https://example.com',
        'https://app.openlearn.org',
      ]);
    });

    it('isOriginAllowed handles origins with multi-dimensional criteria', () => {
      // 1. 无 origin（如 curl 或同源导航）一律允许，包括生产
      expect(isOriginAllowed(undefined)).toBe(true);
      expect(isOriginAllowed('')).toBe(true);
      expect(isOriginAllowed(undefined, 'classroom.local:9000', { allowedOrigins: [], isProduction: true })).toBe(true);
      expect(isOriginAllowed('', 'classroom.local:9000', { allowedOrigins: [], isProduction: true })).toBe(true);

      // 2. 显式白名单匹配
      const opts = { allowedOrigins: ['https://trusted.org', 'https://school.edu'], isProduction: true };
      expect(isOriginAllowed('https://trusted.org', undefined, opts)).toBe(true);
      expect(isOriginAllowed('https://school.edu', 'other.internal:9000', opts)).toBe(true);
      expect(isOriginAllowed('https://evil.attacker.com', undefined, opts)).toBe(false);

      // 3. 通配符 * 放行
      expect(isOriginAllowed('https://any.site.io', undefined, { allowedOrigins: ['*'], isProduction: true })).toBe(
        true,
      );

      // 4. 生产环境不因 Host 与 Origin 主机相同而放行
      expect(isOriginAllowed('https://classroom.local:9000', 'classroom.local:9000', opts)).toBe(false);
      expect(isOriginAllowed('https://attacker.org:9000', 'classroom.local:9000', opts)).toBe(false);
      expect(
        isOriginAllowed('https://classroom.local:9000', 'classroom.local:9000', {
          allowedOrigins: [],
          isProduction: true,
        }),
      ).toBe(false);

      // 5. 生产环境拒绝本机回环，除非该来源写进 ALLOWED_ORIGINS
      const prodEmpty = { allowedOrigins: [], isProduction: true };
      expect(isOriginAllowed('http://localhost:5173', undefined, prodEmpty)).toBe(false);
      expect(isOriginAllowed('http://127.0.0.1:4173', undefined, prodEmpty)).toBe(false);
      expect(isOriginAllowed('http://[::1]:8080', undefined, prodEmpty)).toBe(false);
      expect(isOriginAllowed('http://0.0.0.0:9000', undefined, prodEmpty)).toBe(false);
      expect(isOriginAllowed('http://localhost:5173', 'localhost:9000', prodEmpty)).toBe(false);
      expect(
        isOriginAllowed('http://localhost:5173', undefined, {
          allowedOrigins: ['http://localhost:5173'],
          isProduction: true,
        }),
      ).toBe(true);

      // 6. 开发环境仍宽松：任意来源、回环、Host 反射
      const devEmpty = { allowedOrigins: [], isProduction: false };
      expect(isOriginAllowed('https://vite-dev.preview', undefined, devEmpty)).toBe(true);
      expect(isOriginAllowed('http://localhost:5173', undefined, devEmpty)).toBe(true);
      expect(isOriginAllowed('http://127.0.0.1:4173', undefined, devEmpty)).toBe(true);
      expect(isOriginAllowed('http://[::1]:8080', undefined, devEmpty)).toBe(true);
      expect(isOriginAllowed('https://classroom.local:9000', 'classroom.local:9000', devEmpty)).toBe(true);
    });

    it('createCorsMiddleware responds 204 to OPTIONS and configures headers properly', async () => {
      const app = express();
      app.use(createCorsMiddleware({ allowedOrigins: ['https://demo.openlearn.io'], isProduction: true }));
      app.get('/test', (_req, res) => res.json({ ok: true }));

      const baseUrl = await startTestApp(app);

      // OPTIONS preflight 请求返回 204
      const preflightRes = await fetch(`${baseUrl}/test`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://demo.openlearn.io',
          'Access-Control-Request-Method': 'POST',
        },
      });
      expect(preflightRes.status).toBe(204);
      expect(preflightRes.headers.get('access-control-allow-origin')).toBe('https://demo.openlearn.io');
      expect(preflightRes.headers.get('access-control-allow-credentials')).toBe('true');

      // 非白名单来源不写入 Allow-Origin
      const evilRes = await fetch(`${baseUrl}/test`, {
        headers: { Origin: 'https://malicious.com' },
      });
      expect(evilRes.status).toBe(200);
      expect(evilRes.headers.get('access-control-allow-origin')).toBeNull();
      expect(evilRes.headers.get('access-control-allow-credentials')).toBeNull();

      // 生产环境的本机来源同样不回写凭证头
      const loopbackRes = await fetch(`${baseUrl}/test`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(loopbackRes.status).toBe(200);
      expect(loopbackRes.headers.get('access-control-allow-origin')).toBeNull();
      expect(loopbackRes.headers.get('access-control-allow-credentials')).toBeNull();

      // 没有 Origin 的请求仍然放行，且不反射来源
      const noOriginRes = await fetch(`${baseUrl}/test`);
      expect(noOriginRes.status).toBe(200);
      expect(noOriginRes.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('createSocketIoCors invokes callback with exact authorization decisions', () => {
      const socketCors = createSocketIoCors({ allowedOrigins: ['https://trusted.net'], isProduction: true });

      let resAllowed: any = null;
      socketCors({ headers: { origin: 'https://trusted.net' } }, (_err, opts) => {
        resAllowed = opts;
      });
      expect(resAllowed.origin).toBe('https://trusted.net');
      expect(resAllowed.credentials).toBe(true);

      let resBlocked: any = null;
      socketCors({ headers: { origin: 'https://hacker.io' } }, (_err, opts) => {
        resBlocked = opts;
      });
      expect(resBlocked.origin).toBe(false);

      let resLoopback: any = null;
      socketCors({ headers: { origin: 'http://127.0.0.1:5173', host: '127.0.0.1:9000' } }, (_err, opts) => {
        resLoopback = opts;
      });
      expect(resLoopback.origin).toBe(false);
    });
  });

  describe('Health and Observability Routes (server/routes/health.ts)', () => {
    it('serves /health with uptime and platform version', async () => {
      const app = express();
      registerHealthRoutes(app, {
        platformVersion: '0.6.1-test',
        startTime: Date.now() - 5000,
      });

      const baseUrl = await startTestApp(app);
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.version).toBe('0.6.1-test');
      expect(data.uptime).toBeGreaterThanOrEqual(4);
    });

    it('serves /health/ready with 200 on healthy dependencies and 503 on database failure', async () => {
      const app = express();
      let dbHealthy = true;

      registerHealthRoutes(app, {
        pingDatabase: () => {
          if (!dbHealthy) throw new Error('Database locked or unreachable');
        },
      });

      const baseUrl = await startTestApp(app);

      // 正常场景
      const okRes = await fetch(`${baseUrl}/health/ready`);
      expect(okRes.status).toBe(200);
      const okData = await okRes.json();
      expect(okData.status).toBe('ready');

      // 数据库异常降级场景
      dbHealthy = false;
      const failRes = await fetch(`${baseUrl}/health/ready`);
      expect(failRes.status).toBe(503);
      const failData = await failRes.json();
      expect(failData.status).toBe('not_ready');
    });

    it('protects /metrics endpoint with Bearer token authentication', async () => {
      const app = express();
      registerHealthRoutes(app, { metricsToken: 'secret-token-2026' });

      const baseUrl = await startTestApp(app);

      // 未带 Token 匿名访问返回 401（由 requireAuth 拦截）
      const anonRes = await fetch(`${baseUrl}/metrics`);
      expect(anonRes.status).toBe(401);

      // 错误 Token 访问返回 401
      const badTokenRes = await fetch(`${baseUrl}/metrics`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(badTokenRes.status).toBe(401);

      // 正确 Token 访问返回 200 并携带 Prometheus 格式
      const validRes = await fetch(`${baseUrl}/metrics`, {
        headers: { Authorization: 'Bearer secret-token-2026' },
      });
      expect(validRes.status).toBe(200);
      expect(validRes.headers.get('content-type')).toContain('text/plain');
      const text = await validRes.text();
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    });
  });

  describe('Host Network and System Hygiene (server/utils/host-network.ts)', () => {
    it('getNetworkIps returns an array of non-loopback addresses', () => {
      const ips = getNetworkIps();
      expect(Array.isArray(ips)).toBe(true);
      for (const ip of ips) {
        expect(ip.startsWith('127.')).toBe(false);
      }
    });

    it('formatTerminalHyperlink degrades gracefully in non-TTY environment', () => {
      const url = 'http://localhost:9000';
      const formatted = formatTerminalHyperlink(url);
      expect(formatted).toBe(url);
    });
  });

  describe('Resilience and Error Handling Masking (server/utils/error-handler.ts)', () => {
    it('sendSafeError preserves 4xx client errors but masks 5xx in production', () => {
      const req: any = { method: 'POST', path: '/api/test' };
      const res: any = {
        req,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(payload: any) {
          this.payload = payload;
          return this;
        },
      };

      // 4xx 业务错误透传
      sendSafeError(res, new Error('Class name already exists'), 400);
      expect(res.statusCode).toBe(400);
      expect(res.payload.success).toBe(false);
      expect(res.payload.error).toBe('Class name already exists');

      // 5xx 系统异常在 production 下脱敏
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        sendSafeError(res, new Error('SQLITE_CORRUPT: disk I/O error at sector 0x9f1a'), 500);
        expect(res.statusCode).toBe(500);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error).toBe('Internal server error');
        expect(res.payload.error).not.toContain('SQLITE_CORRUPT');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
