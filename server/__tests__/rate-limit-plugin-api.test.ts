/**
 * 插件 API 通道的**会话级**限流分桶验证。
 *
 * 背景（真实课堂事故）：
 * 一间教室里的学生机共享同一个出口 IP。全站通用写限流按 IP 分桶
 * （生产 180 次/分），而插件前端普遍带 3s 级的定时轮询
 * （例：`@openlearn-ext/whiteboard-sticky-notes` 的 `setInterval(fetchNotes, 3000)`
 * → `POST /api/plugins/<id>/sandbox-command`）。
 * 于是「N 个学生端的插件轮询」把整间教室的写配额吃光，
 * 连带**教师端的白板保存**（演示文稿切页等）一起被 429 打断，
 * 而前端此前静默忽略失败响应 —— 表现为「白板不停闪动 + 429」。
 *
 * 实测（生产构建 + 真实插件）：14 个客户端每 3s 轮询一次，
 * 120s 内 574 次请求里有 142~188 次 429，**教师自己的浏览器也拿到了 11 次 429**。
 *
 * 修复：插件 API 通道改用**按会话分桶**的独立限流桶（未登录回落到 IP），
 * 客户端之间互不抢配额，且不再占用通用写桶。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

// 桩掉会话解析：测试只关心「分桶键」，不关心真实会话表
vi.mock('../middleware/auth.js', () => ({
  getCookieToken: (req: { headers: { cookie?: string } }) => {
    const rc = req.headers.cookie;
    if (!rc) return null;
    for (const part of rc.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith('edu_os_token=')) return trimmed.substring('edu_os_token='.length);
    }
    return null;
  },
  getValidSession: (token: string) => (token ? { userId: token, role: 'student' } : null),
}));

const { createSessionWriteLimiter, createWriteLimiter } = await import('../security/rate-limit.js');

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** 复刻 server.ts 的写限流拓扑：view-state / 插件 API / 通用写 三个独立桶 */
function buildApp(writeMax: number, pluginMax: number) {
  const app = express();
  app.use(express.json());
  const writeLimiter = createWriteLimiter(writeMax);
  const pluginApiLimiter = createSessionWriteLimiter(pluginMax);
  const viewStateLimiter = createWriteLimiter(99);

  app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      if (/^\/api\/classroom\/sessions\/[^/]+\/view-state\/?$/.test(req.path)) {
        return viewStateLimiter(req, res, next);
      }
      if (req.path.startsWith('/api/plugins/')) {
        return pluginApiLimiter(req, res, next);
      }
      return writeLimiter(req, res, next);
    }
    next();
  });

  app.post('/api/plugins/:id/sandbox-command', (_req, res) => res.json({ success: true }));
  app.put('/api/lessons/:id/whiteboard/:elementId', (_req, res) => res.json({ success: true }));
  app.post('/api/other-write', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('插件 API 通道的会话级限流', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('同一出口 IP 的不同会话互不抢配额（一个学生被限流不影响另一个学生）', async () => {
    const app = buildApp(100, 2);
    const { server, baseUrl } = await listen(app);
    try {
      const poll = (token: string) =>
        fetch(`${baseUrl}/api/plugins/p1/sandbox-command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `edu_os_token=${token}` },
          body: '{}',
        });

      // 学生 A 用完自己的 2 次配额
      expect((await poll('student-a')).status).toBe(200);
      expect((await poll('student-a')).status).toBe(200);
      expect((await poll('student-a')).status).toBe(429);

      // 学生 B（同一 IP，不同会话）不受影响
      expect((await poll('student-b')).status).toBe(200);
      expect((await poll('student-b')).status).toBe(200);
      expect((await poll('student-b')).status).toBe(429);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('插件轮询不再占用通用写桶：白板保存不会被插件流量挤掉', async () => {
    // 通用写桶上限 2 次；插件桶上限 3 次
    const app = buildApp(2, 3);
    const { server, baseUrl } = await listen(app);
    try {
      const poll = () =>
        fetch(`${baseUrl}/api/plugins/p1/sandbox-command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: 'edu_os_token=student-a' },
          body: '{}',
        });
      const save = () =>
        fetch(`${baseUrl}/api/lessons/l1/whiteboard/e1`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', cookie: 'edu_os_token=teacher' },
          body: '{}',
        });

      // 插件轮询打满自己的桶（3 次）
      expect((await poll()).status).toBe(200);
      expect((await poll()).status).toBe(200);
      expect((await poll()).status).toBe(200);
      expect((await poll()).status).toBe(429);

      // 教师的白板保存仍走通用写桶，未被插件流量占用配额
      expect((await save()).status).toBe(200);
      expect((await save()).status).toBe(200);
      expect((await save()).status).toBe(429);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('未登录请求回落到 IP 分桶（同一 IP 共享配额，防刷不被削弱）', async () => {
    const app = buildApp(100, 2);
    const { server, baseUrl } = await listen(app);
    try {
      const poll = () =>
        fetch(`${baseUrl}/api/plugins/p1/sandbox-command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });

      expect((await poll()).status).toBe(200);
      expect((await poll()).status).toBe(200);
      // 同一 IP（127.0.0.1）的匿名请求共享配额
      expect((await poll()).status).toBe(429);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
