/**
 * 伪造 X-Forwarded-For 不能拆开限流桶。
 * trust proxy 默认不信任转发头；登录桶按账号，写请求桶按连接地址。
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { createRequire } from 'node:module';
import { createLoginLimiter, createWriteLimiter } from '../security/rate-limit.js';
import { resolveTrustProxy } from '../security/trust-proxy.js';
import { resolveSeedCredential } from '../../packages/core/db/index.js';

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe('resolveTrustProxy', () => {
  it('默认与显式关闭都不信任，数字与主机名按配置生效', () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy(null)).toBe(false);
    expect(resolveTrustProxy('')).toBe(false);
    expect(resolveTrustProxy('false')).toBe(false);
    expect(resolveTrustProxy('0')).toBe(false);
    expect(resolveTrustProxy('true')).toBe(true);
    expect(resolveTrustProxy('1')).toBe(1);
    expect(resolveTrustProxy('loopback')).toBe('loopback');
  });
});

describe('伪造 X-Forwarded-For 不能绕过限流', () => {
  it('同一账号轮换 XFF 仍会计入登录桶，另一个账号不受影响', async () => {
    const app = express();
    app.set('trust proxy', resolveTrustProxy(undefined));
    app.use(express.json());
    app.post('/login', createLoginLimiter(3), (_req, res) => {
      res.json({ ok: true });
    });
    const { server, baseUrl } = await listen(app);
    try {
      const post = (xff: string, username: string) =>
        fetch(`${baseUrl}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
          body: JSON.stringify({ username }),
        });
      expect((await post('1.1.1.1', 'alice')).status).toBe(200);
      expect((await post('2.2.2.2', 'alice')).status).toBe(200);
      expect((await post('3.3.3.3', 'alice')).status).toBe(200);
      expect((await post('4.4.4.4', 'alice')).status).toBe(429);
      expect((await post('5.5.5.5', 'bob')).status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('写请求在不信任代理时不按伪造 XFF 分桶', async () => {
    const app = express();
    app.set('trust proxy', false);
    app.use(express.json());
    app.post('/write', createWriteLimiter(2), (_req, res) => {
      res.json({ ok: true });
    });
    const { server, baseUrl } = await listen(app);
    try {
      const post = (xff: string) =>
        fetch(`${baseUrl}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
          body: '{}',
        });
      expect((await post('8.8.8.8')).status).toBe(200);
      expect((await post('9.9.9.9')).status).toBe(200);
      expect((await post('10.10.10.10')).status).toBe(429);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('种子口令与 proxy-addr', () => {
  it('默认发放「口令 = 用户名」的初始口令，且必须改密', () => {
    // 语义变更：旧版默认随机生成并写入 bootstrap-credentials.txt，
    // 自托管用户常常拿不到口令。现在默认口令 = 用户名，靠强制改密门兜底。
    const fallback = resolveSeedCredential('admin', { mode: 'default' });
    expect(fallback.password).toBe('admin');
    expect(fallback.mustChange).toBe(true);
    expect(fallback.generated).toBe(false);
    expect(fallback.source).toBe('default');

    // 想要旧行为可显式选 random：随机口令 + 写文件
    const random = resolveSeedCredential('admin', { mode: 'random' });
    expect(random.password).not.toBe('admin');
    expect(random.mustChange).toBe(true);
    expect(random.generated).toBe(true);

    const fromEnv = resolveSeedCredential('teacher', { envValue: 'teacher' });
    expect(fromEnv.password).toBe('teacher');
    expect(fromEnv.mustChange).toBe(true);
    const wellKnown = resolveSeedCredential('admin', { allowWellKnown: true });
    expect(wellKnown.password).toBe('admin');
    expect(wellKnown.mustChange).toBe(false);
    const vitest = resolveSeedCredential('admin', { vitestFallback: true });
    expect(vitest.password).not.toBe('admin');
  });

  it('安装的 proxy-addr 不低于 2.0.8', () => {
    const require = createRequire(import.meta.url);
    const version = require('proxy-addr/package.json').version as string;
    const [major, minor, patch] = version.split('.').map((part) => Number(part));
    expect(major).toBeGreaterThanOrEqual(2);
    if (major === 2) {
      expect(minor).toBeGreaterThanOrEqual(0);
      if (minor === 0) expect(patch).toBeGreaterThanOrEqual(8);
    }
  });
});
