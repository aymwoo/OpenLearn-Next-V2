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
import { requestObservability, resolveRequestId } from '../middleware/request-observability.js';

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
});
