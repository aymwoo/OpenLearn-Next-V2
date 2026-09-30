import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerCoursewareRoutes } from '../routes/courseware.js';
import { registerBridgeRoutes } from '../routes/bridge.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { mintCoursewareToken, verifyCoursewareToken } from '../utils/courseware-access.js';

/**
 * 课件 HTML 访问 token（SEC-AUTH）：
 * `GET /api/courseware/:id` 是课件 iframe 的 src，而沙箱 iframe 不携带会话 cookie，
 * 无法 requireAuth。改为「已认证父页面铸造短时 HMAC token → iframe `?ct=` 携带 → 验签」。
 * 本测试锁死：无 token / 伪造 token / 过期 token / 绑定错课件 id 一律 401，
 * 且 401 必须发生在 courseware 行自动登记**之前**（不产生未认证写）。
 */

describe('courseware access token (SEC-AUTH)', () => {
  describe('mintCoursewareToken / verifyCoursewareToken', () => {
    it('合法 token 通过验证', () => {
      const token = mintCoursewareToken('cw-1');
      expect(verifyCoursewareToken('cw-1', token)).toBe(true);
    });

    it('token 与课件 id 绑定，换 id 即失效', () => {
      const token = mintCoursewareToken('cw-1');
      expect(verifyCoursewareToken('cw-2', token)).toBe(false);
    });

    it('过期 token 失效', () => {
      const token = mintCoursewareToken('cw-1', -1000);
      expect(verifyCoursewareToken('cw-1', token)).toBe(false);
    });

    it('篡改签名 / 缺失 / 畸形 token 失效', () => {
      const token = mintCoursewareToken('cw-1');
      const tampered = `${token.slice(0, token.indexOf('.'))}.${token.slice(token.indexOf('.') + 1)}x`;
      expect(verifyCoursewareToken('cw-1', tampered)).toBe(false);
      expect(verifyCoursewareToken('cw-1', undefined)).toBe(false);
      expect(verifyCoursewareToken('cw-1', null)).toBe(false);
      expect(verifyCoursewareToken('cw-1', '')).toBe(false);
      expect(verifyCoursewareToken('cw-1', 'not-a-token')).toBe(false);
    });
  });

  describe('route gating', () => {
    let app: express.Express;
    let server: Server;
    let baseUrl: string;

    const cwNodeId = 'vfs-cw-token-test';
    const studentId = 'usr-cw-token-student';
    const studentToken = 'tok-cw-token-student';
    const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}`, 'Content-Type': 'application/json' });

    beforeAll(async () => {
      const now = Date.now();
      kernelContainer.db
        .prepare(
          'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(studentId, 'cw_token_student', 'placeholder', 'student', 'Token 学生', now);
      kernelContainer.db
        .prepare(
          'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
        )
        .run(
          studentToken,
          JSON.stringify({ userId: studentId, role: 'student', username: 'cw_token_student' }),
          now,
          now + 60 * 60 * 1000,
        );
      kernelContainer.db
        .prepare(
          'INSERT OR REPLACE INTO vfs_nodes (id, name, type, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(cwNodeId, 'token-test.html', 'file', '<html><body>token test</body></html>', now, now);

      app = express();
      app.use(express.json());
      registerCoursewareRoutes({ app, io: { emit: () => {} } as any } as any);
      registerBridgeRoutes({ app, io: { emit: () => {} } as any } as any);
      server = createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      kernelContainer.db.prepare('DELETE FROM vfs_nodes WHERE id = ?').run(cwNodeId);
      kernelContainer.db.prepare('DELETE FROM courseware WHERE id = ?').run(cwNodeId);
      kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(studentToken);
      kernelContainer.db.prepare('DELETE FROM users WHERE id = ?').run(studentId);
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('无 token 直接访问 → 401，且不触发 courseware 行自动登记', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/${cwNodeId}`);
      expect(res.status).toBe(401);
      const row = kernelContainer.db.prepare('SELECT id FROM courseware WHERE id = ?').get(cwNodeId);
      expect(row).toBeUndefined();
    });

    it('伪造 token → 401', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/${cwNodeId}?ct=forged.token`);
      expect(res.status).toBe(401);
    });

    it('绑定其他课件 id 的 token → 401', async () => {
      const foreign = mintCoursewareToken('some-other-cw');
      const res = await fetch(`${baseUrl}/api/courseware/${cwNodeId}?ct=${encodeURIComponent(foreign)}`);
      expect(res.status).toBe(401);
    });

    it('未认证者无法铸造 token', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/${cwNodeId}/access-token`);
      expect(res.status).toBe(401);
    });

    it('完整链路：已认证父页面铸 token → 带 ct 访问拿到注入 SDK 的 HTML', async () => {
      const mintRes = await fetch(`${baseUrl}/api/courseware/${cwNodeId}/access-token`, {
        headers: cookie(studentToken),
      });
      expect(mintRes.status).toBe(200);
      const { token } = (await mintRes.json()) as { token: string };
      expect(typeof token).toBe('string');

      const res = await fetch(`${baseUrl}/api/courseware/${cwNodeId}?ct=${encodeURIComponent(token)}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('token test');
      expect(html).toContain('window.LMS'); // injectLmsSdk 已注入 Bridge SDK

      // SEC-NET-02: 课件 HTML 用自有宽松 CSP 覆盖 helmet 全局头（内联脚本不受
      // 全局收紧影响），且含 frame-ancestors 'self' 防外部站点嵌入
      const csp = res.headers.get('content-security-policy') || '';
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).toContain("script-src 'self' 'unsafe-inline'");

      // 副作用：首次成功访问登记了 courseware 行（登录用户触发，属预期）
      const row = kernelContainer.db.prepare('SELECT id FROM courseware WHERE id = ?').get(cwNodeId);
      expect(row).toBeDefined();
    });

    it('SEC-NET-02: POST /api/courseware/inline 幂等落库并返回稳定 uuid', async () => {
      const code = '<html><body><h1>inline test</h1><script>1+1</script></body></html>';
      const post = async () =>
        fetch(`${baseUrl}/api/courseware/inline`, {
          method: 'POST',
          headers: cookie(studentToken),
          body: JSON.stringify({ code }),
        });

      const res1 = await post();
      expect(res1.status).toBe(200);
      const { uuid: uuid1 } = (await res1.json()) as { uuid: string };
      expect(uuid1).toMatch(/^inline-[0-9a-f]{16}$/);

      // 内容相同 → 幂等（同一 uuid，不产生重复行）
      const res2 = await post();
      const { uuid: uuid2 } = (await res2.json()) as { uuid: string };
      expect(uuid2).toBe(uuid1);
      const count = kernelContainer.db
        .prepare('SELECT COUNT(*) AS n FROM system_resources WHERE id = ?')
        .get(uuid1) as any;
      expect(count.n).toBe(1);

      // 落库后可经 /runtime 加载（自有宽松 CSP + Bridge SDK；带 ct 通过 SEC-AUTH 门控）
      const runtimeRes = await fetch(
        `${baseUrl}/runtime/${uuid1}/?ct=${encodeURIComponent(mintCoursewareToken(uuid1))}`,
      );
      expect(runtimeRes.status).toBe(200);
      const runtimeHtml = await runtimeRes.text();
      expect(runtimeHtml).toContain('inline test');
      expect(runtimeRes.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");

      kernelContainer.db.prepare('DELETE FROM system_resources WHERE id = ?').run(uuid1);
    });

    it('SEC-NET-02: POST /api/courseware/inline 校验（未认证 401 / 空 code 400 / 超限 413）', async () => {
      const noAuth = await fetch(`${baseUrl}/api/courseware/inline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '<p>x</p>' }),
      });
      expect(noAuth.status).toBe(401);

      const empty = await fetch(`${baseUrl}/api/courseware/inline`, {
        method: 'POST',
        headers: cookie(studentToken),
        body: JSON.stringify({ code: '   ' }),
      });
      expect(empty.status).toBe(400);

      const tooBig = await fetch(`${baseUrl}/api/courseware/inline`, {
        method: 'POST',
        headers: cookie(studentToken),
        body: JSON.stringify({ code: 'x'.repeat(512 * 1024 + 1) }),
      });
      expect(tooBig.status).toBe(413);
    });
  });
});
