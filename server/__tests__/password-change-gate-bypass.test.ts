/**
 * Issue #197：开发环境跳过强制改密门（`SEC-AUTH-06` 开发者体验优化）。
 *
 * 三件事必须同时成立：
 * 1. 非生产环境 + 开关打开 → 登录不再打 `mustChangePassword` 标记，写操作不被 403；
 * 2. 生产环境 + 开关打开 → **严格忽略**并输出告警（一个误配的环境变量不能变成线上后门）；
 * 3. 开关关闭（默认）→ 行为与此前完全一致（回归保护：别忘了关开关时本来就该强制改密）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import bcrypt from 'bcryptjs';
import { registerRosterRoutes } from '../routes/roster.js';
import { enforcePasswordChanged } from '../middleware/auth.js';
import {
  isPasswordChangeGateSkipped,
  resetPasswordGateWarningForTests,
  PASSWORD_GATE_SKIP_ENV,
  PASSWORD_GATE_SKIP_ENV_ALIAS,
} from '../utils/password-gate.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('强制改密门的开发豁免开关（Issue #197）', () => {
  describe('isPasswordChangeGateSkipped 判定矩阵', () => {
    beforeEach(() => resetPasswordGateWarningForTests());

    it('未设置时为 false', () => {
      expect(isPasswordChangeGateSkipped({} as NodeJS.ProcessEnv)).toBe(false);
    });

    it('非生产环境：规范名与别名都生效，接受 1/true（大小写与空白容错）', () => {
      expect(isPasswordChangeGateSkipped({ [PASSWORD_GATE_SKIP_ENV]: 'true' } as NodeJS.ProcessEnv)).toBe(true);
      expect(isPasswordChangeGateSkipped({ [PASSWORD_GATE_SKIP_ENV]: '1' } as NodeJS.ProcessEnv)).toBe(true);
      expect(isPasswordChangeGateSkipped({ [PASSWORD_GATE_SKIP_ENV_ALIAS]: ' TRUE ' } as NodeJS.ProcessEnv)).toBe(true);
      expect(isPasswordChangeGateSkipped({ [PASSWORD_GATE_SKIP_ENV]: 'true', NODE_ENV: 'test' } as any)).toBe(true);
    });

    it('非生产环境：false / 0 / 任意其它值都不生效', () => {
      for (const value of ['false', '0', 'no', 'yes', '']) {
        expect(isPasswordChangeGateSkipped({ [PASSWORD_GATE_SKIP_ENV]: value } as NodeJS.ProcessEnv)).toBe(false);
      }
    });

    it('生产环境：即便配了开关也严格忽略，并输出告警（且只告警一次）', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const env = { [PASSWORD_GATE_SKIP_ENV]: 'true', NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv;
        expect(isPasswordChangeGateSkipped(env)).toBe(false);
        expect(isPasswordChangeGateSkipped(env)).toBe(false);
        const gateWarnings = warn.mock.calls.filter((call) => String(call[0]).includes('严格忽略该开关'));
        expect(gateWarnings).toHaveLength(1);
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('登录与拦截链路', () => {
    let server: Server;
    let baseUrl: string;

    const userId = 'usr-gate-bypass';
    const username = 'gate_bypass_admin'; // 密码将等于用户名（种子默认口令特征）
    const savedEnv: Record<string, string | undefined> = {};

    const ENV_KEYS = [PASSWORD_GATE_SKIP_ENV, PASSWORD_GATE_SKIP_ENV_ALIAS, 'NODE_ENV'] as const;

    const login = async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entrance: 'teacher', username, password: username }),
      });
      const body: any = await res.json();
      const token = (res.headers.get('set-cookie') || '').split(';')[0].split('=')[1];
      return { res, body, token };
    };

    const write = (token: string) =>
      fetch(`${baseUrl}/api/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `edu_os_token=${token}` },
        body: JSON.stringify({}),
      });

    beforeAll(async () => {
      const app = express();
      app.use(express.json());
      app.use(enforcePasswordChanged);
      registerRosterRoutes({
        app,
        io: undefined,
        loginLimiter: (_req: any, _res: any, next: () => void) => next(),
      } as any);
      app.post('/api/lessons', (_req, res) => res.json({ ok: true }));

      server = createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      kernelContainer.db
        .prepare(
          'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(userId, username, bcrypt.hashSync(username, 10), 'administrator', '开发豁免管理员', Date.now());
    });

    beforeEach(() => {
      for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
      delete process.env[PASSWORD_GATE_SKIP_ENV];
      delete process.env[PASSWORD_GATE_SKIP_ENV_ALIAS];
      process.env.NODE_ENV = 'test';
      resetPasswordGateWarningForTests();
    });

    afterEach(() => {
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
    });

    afterAll(async () => {
      kernelContainer.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      kernelContainer.db.prepare('DELETE FROM client_sessions WHERE session_data LIKE ?').run(`%${userId}%`);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('默认（开关未开）：默认口令登录仍强制改密，写操作 403（回归保护）', async () => {
      const { res, body, token } = await login();
      expect(res.status).toBe(200);
      expect(body.session?.mustChangePassword).toBe(true);

      const blocked = await write(token);
      expect(blocked.status).toBe(403);
      expect((await blocked.json()).code).toBe('FORBIDDEN_DEFAULT_PASSWORD');
    });

    it('非生产环境 + 开关打开：不再打标记，写操作直接放行', async () => {
      process.env[PASSWORD_GATE_SKIP_ENV] = 'true';

      const { res, body, token } = await login();
      expect(res.status).toBe(200);
      expect(body.session?.mustChangePassword).toBeUndefined();

      const allowed = await write(token);
      expect(allowed.status).toBe(200);
    });

    it('别名 DEV_BYPASS_PASSWORD_CHANGE_GATE 同样生效', async () => {
      process.env[PASSWORD_GATE_SKIP_ENV_ALIAS] = 'true';

      const { body, token } = await login();
      expect(body.session?.mustChangePassword).toBeUndefined();
      expect((await write(token)).status).toBe(200);
    });

    it('NODE_ENV=production 时开关被忽略：仍然打标记并拦截写操作', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        process.env.NODE_ENV = 'production';
        process.env[PASSWORD_GATE_SKIP_ENV] = 'true';

        const { body, token } = await login();
        expect(body.session?.mustChangePassword).toBe(true);

        const blocked = await write(token);
        expect(blocked.status).toBe(403);
        expect((await blocked.json()).code).toBe('FORBIDDEN_DEFAULT_PASSWORD');
        expect(warn.mock.calls.some((call) => String(call[0]).includes('严格忽略该开关'))).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });

    it('已带标记的老会话：开启开关后无需重新登录即被放行', async () => {
      // 先在未开开关时登录，拿到带标记的会话
      const stale = await login();
      expect((await write(stale.token)).status).toBe(403);

      // 打开开关（模拟开发者改 .env 后重启无感）—— 同一 token 立刻可用
      process.env[PASSWORD_GATE_SKIP_ENV] = 'true';
      expect((await write(stale.token)).status).toBe(200);
    });
  });
});
