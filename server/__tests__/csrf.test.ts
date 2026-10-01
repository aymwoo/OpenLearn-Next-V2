/**
 * Phase B1: CSRF Sec-Fetch 门控测试。
 *
 * 判定表见 server/middleware/csrf.ts。核心断言：
 *   - cross-site 的写请求被 403（FORBIDDEN_CROSS_SITE）
 *   - same-origin / same-site / none 放行
 *   - 豁免路径（沙箱课件直连、登录）cross-site 放行
 *   - 无 Sec-Fetch 头（curl/API 客户端）放行
 *   - GET 不受门控影响
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { csrfGuard } from '../middleware/csrf.js';

let server: Server;
let baseUrl = '';

const post = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${path}`, { headers });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(csrfGuard);
  // 受控样本路由
  app.post('/api/sample/write', (_req, res) => res.json({ ok: true }));
  app.post('/api/courseware/attempts/att-1/submit', (_req, res) => res.json({ ok: true }));
  app.post('/api/courseware/attempts/att-1/log', (_req, res) => res.json({ ok: true }));
  app.post('/api/courseware/attempts/att-1/adopt', (_req, res) => res.json({ ok: true }));
  app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));
  app.get('/api/sample/read', (_req, res) => res.json({ ok: true }));

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('B1: CSRF Sec-Fetch 门控', () => {
  it('cross-site POST 被拒绝（403 FORBIDDEN_CROSS_SITE）', async () => {
    const res = await post('/api/sample/write', { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'empty' });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.code).toBe('FORBIDDEN_CROSS_SITE');
  });

  it.each(['same-origin', 'same-site', 'none'])('Sec-Fetch-Site: %s 放行', async (site) => {
    const res = await post('/api/sample/write', { 'Sec-Fetch-Site': site, 'Sec-Fetch-Dest': 'empty' });
    expect(res.status).toBe(200);
  });

  it('无 Sec-Fetch 头（curl/API 客户端）放行', async () => {
    const res = await post('/api/sample/write');
    expect(res.status).toBe(200);
  });

  it('豁免路径：沙箱课件 log/submit/adopt cross-site 放行', async () => {
    for (const p of [
      '/api/courseware/attempts/att-1/submit',
      '/api/courseware/attempts/att-1/log',
      '/api/courseware/attempts/att-1/adopt',
    ]) {
      const res = await post(p, { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'empty' });
      expect(res.status).toBe(200);
    }
  });

  it('豁免路径：/api/auth/login cross-site 放行', async () => {
    const res = await post('/api/auth/login', { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'empty' });
    expect(res.status).toBe(200);
  });

  it('GET 请求不受门控影响（含 cross-site）', async () => {
    const res = await get('/api/sample/read', { 'Sec-Fetch-Site': 'cross-site' });
    expect(res.status).toBe(200);
  });
});
