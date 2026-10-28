/**
 * 课堂会话 view-state 端点专用限流与独立分桶验证。
 *
 * 背景：
 * view-state 属于高频会话快照（轻量原子回写 currentPage 与 activeSegmentId），
 * 若与全站通用破坏性写请求（创建/导入/删除等）共用限流桶，极易在课堂互动或多端测试时偶发 429。
 * 现已配置 viewStateLimiter 独立限流桶，确保二者配额互不挤占。
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { createWriteLimiter } from '../security/rate-limit.js';

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe('view-state 端点独立限流机制', () => {
  it('通用写请求打满被 429 时，view-state 依然可独立放行；超出自身配额后独立 429', async () => {
    const app = express();
    app.use(express.json());

    // 模拟 server.ts 限流路由拓扑：通用写请求桶上限 2 次，view-state 专用桶上限 3 次
    const writeLimiter = createWriteLimiter(2);
    const viewStateLimiter = createWriteLimiter(3);

    app.use((req, res, next) => {
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
        if (/^\/api\/classroom\/sessions\/[^/]+\/view-state\/?$/.test(req.path)) {
          return viewStateLimiter(req, res, next);
        }
        return writeLimiter(req, res, next);
      }
      next();
    });

    app.post('/api/other-write', (_req, res) => res.json({ ok: true }));
    app.post('/api/classroom/sessions/:lessonId/view-state', (_req, res) => res.json({ success: true }));

    const { server, baseUrl } = await listen(app);
    try {
      const postOther = () =>
        fetch(`${baseUrl}/api/other-write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      const postViewState = () =>
        fetch(`${baseUrl}/api/classroom/sessions/test-lesson/view-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPage: 1 }),
        });

      // 1. 通用写请求打满 2 次
      expect((await postOther()).status).toBe(200);
      expect((await postOther()).status).toBe(200);
      // 第 3 次触发通用限流 429
      expect((await postOther()).status).toBe(429);

      // 2. 此时 view-state 不应被通用限流波及，拥有独立的 3 次配额
      expect((await postViewState()).status).toBe(200);
      expect((await postViewState()).status).toBe(200);
      expect((await postViewState()).status).toBe(200);
      // 第 4 次超出自身专用配额，触发 429
      expect((await postViewState()).status).toBe(429);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
