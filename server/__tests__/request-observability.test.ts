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
import {
  isQuietRequest,
  requestObservability,
  resolveHttpAccessLogLevel,
  resolveHttpAccessLogMode,
  resolveHttpAccessLogIgnorePrefixes,
  resolveRequestId,
  resolveSlowRequestThresholdMs,
} from '../middleware/request-observability.js';
import { logger } from '../../packages/core/observability/logger.js';
import { vi } from 'vitest';

describe('请求观测', () => {
  let server: Server;
  const audits: AuditRecord[] = [];
  const errors: SanitizedErrorReport[] = [];

  afterEach(async () => {
    delete process.env.HTTP_ACCESS_LOG;
    delete process.env.HTTP_SLOW_MS;
    delete process.env.HTTP_ACCESS_LOG_IGNORE;
    delete process.env.LOG_LEVEL;
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
      expect(isQuietRequest('/.vite-cache/deps/react.js', 200, false)).toBe(true);

      // 异常状态码一律不静默
      expect(isQuietRequest('/src/main.tsx', 500, false)).toBe(false);

      // 生产环境下非通用白名单资源不静默
      expect(isQuietRequest('/src/main.tsx', 200, true)).toBe(false);
    });

    it('业务 API 请求默认不静默，但支持配置 HTTP_ACCESS_LOG_IGNORE 前缀名单', () => {
      expect(isQuietRequest('/api/lessons', 200)).toBe(false);
      expect(isQuietRequest('/api/classes', 200)).toBe(false);
      expect(isQuietRequest('/api/auth/login', 200)).toBe(false);
      expect(isQuietRequest('/api/lessons', 500)).toBe(false);

      // 指定忽略前缀时，正常响应被静默
      expect(isQuietRequest('/api/vfs/read', 200, true, ['/api/vfs'])).toBe(true);
      // 但异常响应绝不静默
      expect(isQuietRequest('/api/vfs/read', 404, true, ['/api/vfs'])).toBe(false);
      expect(isQuietRequest('/api/vfs/read', 500, true, ['/api/vfs'])).toBe(false);
    });
  });

  describe('访问日志配置与分级判定辅助函数', () => {
    it('resolveHttpAccessLogMode 正确解析配置与 LOG_LEVEL 回退', () => {
      expect(resolveHttpAccessLogMode('off')).toBe('off');
      expect(resolveHttpAccessLogMode('errors')).toBe('errors');
      expect(resolveHttpAccessLogMode('all')).toBe('all');
      expect(resolveHttpAccessLogMode('  ALL  ')).toBe('all');
      // 未设置时，若 LOG_LEVEL 为 debug / trace 则自动设为 all
      expect(resolveHttpAccessLogMode(undefined, 'debug')).toBe('all');
      expect(resolveHttpAccessLogMode(undefined, 'trace')).toBe('all');
      // 默认回退为 errors
      expect(resolveHttpAccessLogMode(undefined, 'info')).toBe('errors');
      expect(resolveHttpAccessLogMode(undefined, undefined)).toBe('errors');
    });

    it('resolveSlowRequestThresholdMs 正确解析慢请求阈值', () => {
      expect(resolveSlowRequestThresholdMs('500')).toBe(500);
      expect(resolveSlowRequestThresholdMs(undefined)).toBe(1000);
      expect(resolveSlowRequestThresholdMs('invalid')).toBe(1000);
      expect(resolveSlowRequestThresholdMs('-10')).toBe(1000);
    });

    it('resolveHttpAccessLogIgnorePrefixes 正确解析逗号分隔前缀', () => {
      expect(resolveHttpAccessLogIgnorePrefixes('/api/vfs, /api/classroom/sessions/')).toEqual([
        '/api/vfs',
        '/api/classroom/sessions/',
      ]);
      expect(resolveHttpAccessLogIgnorePrefixes('')).toEqual([]);
      expect(resolveHttpAccessLogIgnorePrefixes(undefined)).toEqual([]);
    });

    it('resolveHttpAccessLogLevel 按状态与耗时准确分级', () => {
      // mode = off
      expect(resolveHttpAccessLogLevel(500, 10, 'off')).toBeNull();
      expect(resolveHttpAccessLogLevel(200, 10, 'off')).toBeNull();

      // mode = errors (默认)
      expect(resolveHttpAccessLogLevel(500, 10, 'errors')).toBe('error');
      expect(resolveHttpAccessLogLevel(502, 10, 'errors')).toBe('error');
      expect(resolveHttpAccessLogLevel(400, 10, 'errors')).toBe('warn');
      expect(resolveHttpAccessLogLevel(404, 10, 'errors')).toBe('warn');
      expect(resolveHttpAccessLogLevel(200, 1500, 'errors', 1000)).toBe('warn'); // 慢请求
      expect(resolveHttpAccessLogLevel(200, 50, 'errors', 1000)).toBeNull(); // 正常成功请求静默
      expect(resolveHttpAccessLogLevel(304, 5, 'errors', 1000)).toBeNull(); // 304 缓存命中静默

      // mode = all
      expect(resolveHttpAccessLogLevel(500, 10, 'all')).toBe('error');
      expect(resolveHttpAccessLogLevel(404, 10, 'all')).toBe('warn');
      expect(resolveHttpAccessLogLevel(200, 1500, 'all', 1000)).toBe('warn');
      expect(resolveHttpAccessLogLevel(200, 50, 'all', 1000)).toBe('debug');
      expect(resolveHttpAccessLogLevel(304, 5, 'all', 1000)).toBe('debug');
    });
  });

  describe('真实 HTTP 请求日志行为', () => {
    it('默认配置下：正常的 200/304 请求不再触发 http.request 日志，而异常与慢请求正常触发', async () => {
      const errorSpy = vi.spyOn(logger, 'error');
      const warnSpy = vi.spyOn(logger, 'warn');
      const infoSpy = vi.spyOn(logger, 'info');
      const debugSpy = vi.spyOn(logger, 'debug');

      const app = express();
      app.use(requestObservability());
      app.get('/api/ok', (_req, res) => {
        res.status(200).json({ ok: true });
      });
      app.get('/api/not-modified', (_req, res) => {
        res.status(304).end();
      });
      app.get('/api/not-found', (_req, res) => {
        res.status(404).json({ error: 'not found' });
      });
      app.get('/api/server-error', (_req, res) => {
        res.status(500).json({ error: 'fail' });
      });
      app.get('/api/slow', async (_req, res) => {
        await new Promise((r) => setTimeout(r, 60));
        res.status(200).json({ slow: true });
      });
      const base = await listen(app);

      // 1. 正常 200 与 304 请求，全部静默
      await fetch(`${base}/api/ok`);
      await fetch(`${base}/api/not-modified`);
      const hasOkLog = [
        ...errorSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...infoSpy.mock.calls,
        ...debugSpy.mock.calls,
      ].some(
        (call) =>
          call[1] === 'http.request' &&
          ((call[0] as any)?.path === '/api/ok' || (call[0] as any)?.path === '/api/not-modified'),
      );
      expect(hasOkLog).toBe(false);

      // 2. 404 响应触发 logger.warn
      await fetch(`${base}/api/not-found`);
      const notFoundCall = warnSpy.mock.calls.find(
        (call) => call[1] === 'http.request' && (call[0] as any)?.path === '/api/not-found',
      );
      expect(notFoundCall).toBeDefined();
      expect((notFoundCall?.[0] as any)?.status).toBe(404);
      expect((notFoundCall?.[0] as any)?.requestId).toBeDefined();

      // 3. 500 响应触发 logger.error
      await fetch(`${base}/api/server-error`);
      const serverErrorCall = errorSpy.mock.calls.find(
        (call) => call[1] === 'http.request' && (call[0] as any)?.path === '/api/server-error',
      );
      expect(serverErrorCall).toBeDefined();
      expect((serverErrorCall?.[0] as any)?.status).toBe(500);

      // 4. 耗时超过 HTTP_SLOW_MS 阈值的慢请求触发 logger.warn
      process.env.HTTP_SLOW_MS = '50';
      await fetch(`${base}/api/slow`);
      const slowCall = warnSpy.mock.calls.find(
        (call) => call[1] === 'http.request' && (call[0] as any)?.path === '/api/slow',
      );
      expect(slowCall).toBeDefined();
      expect((slowCall?.[0] as any)?.status).toBe(200);
      expect((slowCall?.[0] as any)?.durationMs).toBeGreaterThanOrEqual(50);

      errorSpy.mockRestore();
      warnSpy.mockRestore();
      infoSpy.mockRestore();
      debugSpy.mockRestore();
    });

    it('开发环境 Vite 依赖预打包缓存（/.vite-cache/）即使超过慢请求阈值也不写访问日志', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const infoSpy = vi.spyOn(logger, 'info');
      const debugSpy = vi.spyOn(logger, 'debug');

      const app = express();
      app.use(requestObservability());
      app.get('/.vite-cache/deps/react.js', async (_req, res) => {
        await new Promise((r) => setTimeout(r, 40));
        res.status(200).type('application/javascript').send('export default {}');
      });
      const base = await listen(app);

      process.env.HTTP_SLOW_MS = '1';
      await fetch(`${base}/.vite-cache/deps/react.js`);

      const hit = [...warnSpy.mock.calls, ...infoSpy.mock.calls, ...debugSpy.mock.calls].find(
        (call) =>
          call[1] === 'http.request' && (call[0] as Record<string, unknown>)?.path === '/.vite-cache/deps/react.js',
      );
      expect(hit).toBeUndefined();

      warnSpy.mockRestore();
      infoSpy.mockRestore();
      debugSpy.mockRestore();
    });

    it('设 HTTP_ACCESS_LOG=all 时，正常成功请求记录为 debug 日志', async () => {
      process.env.HTTP_ACCESS_LOG = 'all';
      const debugSpy = vi.spyOn(logger, 'debug');
      const infoSpy = vi.spyOn(logger, 'info');

      const app = express();
      app.use(requestObservability());
      app.get('/api/test-all', (_req, res) => {
        res.status(200).json({ ok: true });
      });
      const base = await listen(app);

      await fetch(`${base}/api/test-all`);
      const allLog = [...debugSpy.mock.calls, ...infoSpy.mock.calls].find(
        (call) => call[1] === 'http.request' && (call[0] as any)?.path === '/api/test-all',
      );
      expect(allLog).toBeDefined();
      expect((allLog?.[0] as any)?.status).toBe(200);

      debugSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it('设 HTTP_ACCESS_LOG=off 时，不记录任何 http.request 访问日志', async () => {
      process.env.HTTP_ACCESS_LOG = 'off';
      const errorSpy = vi.spyOn(logger, 'error');
      const warnSpy = vi.spyOn(logger, 'warn');

      const app = express();
      app.use(requestObservability());
      app.get('/api/test-off', (_req, res) => {
        res.status(500).json({ error: 'err' });
      });
      const base = await listen(app);

      await fetch(`${base}/api/test-off`);
      const offLog = [...errorSpy.mock.calls, ...warnSpy.mock.calls].find(
        (call) => call[1] === 'http.request' && (call[0] as any)?.path === '/api/test-off',
      );
      expect(offLog).toBeUndefined();

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
