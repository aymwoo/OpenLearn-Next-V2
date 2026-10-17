/**
 * @vitest-environment node
 */
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { setAuditSinkForTests, type AuditRecord } from '../../packages/core/observability/audit-log.js';
import {
  setErrorCaptureSinkForTests,
  type SanitizedErrorReport,
} from '../../packages/core/observability/error-reporter.js';
import { isQuietRequest, requestObservability, resolveRequestId } from '../middleware/request-observability.js';
import { logger } from '../../packages/core/observability/logger.js';
import { vi } from 'vitest';

describe('请求观测', () => {
  let server: Server;
  const audits: AuditRecord[] = [];
  const errors: SanitizedErrorReport[] = [];

  afterEach(async () => {
    setAuditSinkForTests(null);
    setErrorCaptureSinkForTests(null);
    audits.length = 0;
    errors.length = 0;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function listen(app: express.Express): Promise<string> {
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}`;
  }

  it('回写请求 ID，并把 403 / 429 记入审计且不带查询串', async () => {
    setAuditSinkForTests((record) => audits.push(record));
    const app = express();
    app.use(requestObservability());
    app.get('/secret', (_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
    });
    app.post('/api/auth/login', (_req, res) => {
      res.status(429).json({ error: 'slow down' });
    });
    const base = await listen(app);

    const forbidden = await fetch(`${base}/secret?password=hunter2`, {
      headers: { 'x-request-id': 'req-1234abcd' },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get('x-request-id')).toBe('req-1234abcd');
    expect(audits.some((row) => row.event === 'auth.forbidden' && row.path === '/secret')).toBe(true);
    expect(JSON.stringify(audits)).not.toContain('hunter2');

    const limited = await fetch(`${base}/api/auth/login`, { method: 'POST' });
    expect(limited.status).toBe(429);
    expect(audits.some((row) => row.event === 'rate_limit.triggered' && row.path === '/api/auth/login')).toBe(true);
    expect(resolveRequestId('bad id')).not.toBe('bad id');
  });

  it('未标记的 5xx 会进入错误收集，响应体不进上报', async () => {
    setErrorCaptureSinkForTests((report) => errors.push(report));
    const app = express();
    app.use(requestObservability());
    app.get('/boom', (_req, res) => {
      res.status(500).json({ error: 'student answer leaked', password: 'secret' });
    });
    const base = await listen(app);
    const res = await fetch(`${base}/boom`);
    expect(res.status).toBe(500);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('/boom');
    expect(errors[0].message).not.toContain('leaked');
    expect(errors[0].message).not.toContain('secret');
  });

  describe('isQuietRequest 静默判定', () => {
    it('常规探活与公共静态入口在正常状态 (<400) 下静默', () => {
      expect(isQuietRequest('/health', 200)).toBe(true);
      expect(isQuietRequest('/health/ready', 200)).toBe(true);
      expect(isQuietRequest('/', 200)).toBe(true);
      expect(isQuietRequest('/index.html', 200)).toBe(true);
      expect(isQuietRequest('/favicon.ico', 200)).toBe(true);
      expect(isQuietRequest('/robots.txt', 200)).toBe(true);
    });

    it('常规静态入口在异常状态 (>=400) 下绝不静默', () => {
      expect(isQuietRequest('/index.html', 404)).toBe(false);
      expect(isQuietRequest('/index.html', 500)).toBe(false);
      expect(isQuietRequest('/health', 503)).toBe(false);
    });

    it('开发环境下 Vite 内部资源与源码在正常状态下静默，异常时不静默', () => {
      // isProduction = false
      expect(isQuietRequest('/@vite/client', 200, false)).toBe(true);
      expect(isQuietRequest('/src/main.tsx', 200, false)).toBe(true);
      expect(isQuietRequest('/node_modules/react/index.js', 200, false)).toBe(true);
      expect(isQuietRequest('/@fs/some/path', 200, false)).toBe(true);

      // 异常状态码一律不静默
      expect(isQuietRequest('/src/main.tsx', 500, false)).toBe(false);

      // 生产环境下非通用白名单资源不静默
      expect(isQuietRequest('/src/main.tsx', 200, true)).toBe(false);
    });

    it('业务 API 请求在任何状态下都不静默', () => {
      expect(isQuietRequest('/api/lessons', 200)).toBe(false);
      expect(isQuietRequest('/api/classes', 200)).toBe(false);
      expect(isQuietRequest('/api/auth/login', 200)).toBe(false);
      expect(isQuietRequest('/api/lessons', 500)).toBe(false);
    });
  });

  it('真实 HTTP 请求：访问 /index.html 正常响应时不触发 http.request 日志，而业务 API 正常触发', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    const app = express();
    app.use(requestObservability());
    app.get('/index.html', (_req, res) => {
      res.status(200).send('<html></html>');
    });
    app.get('/api/test-endpoint', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    const base = await listen(app);

    // 访问 /index.html 200
    await fetch(`${base}/index.html`);
    // logger.info 不应该有 'http.request' 且 path 为 '/index.html'
    const indexHtmlLog = infoSpy.mock.calls.find(
      (call) => call[1] === 'http.request' && (call[0] as any)?.path === '/index.html',
    );
    expect(indexHtmlLog).toBeUndefined();

    // 访问 /api/test-endpoint 200
    await fetch(`${base}/api/test-endpoint`);
    const apiLog = infoSpy.mock.calls.find(
      (call) => call[1] === 'http.request' && (call[0] as any)?.path === '/api/test-endpoint',
    );
    expect(apiLog).toBeDefined();
    expect((apiLog?.[0] as any)?.status).toBe(200);

    infoSpy.mockRestore();
  });
});

