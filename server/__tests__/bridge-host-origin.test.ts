import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerBridgeRoutes } from '../routes/bridge.js';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';
import { injectLmsSdk, resolveRequestHostOrigin } from '../routes/shared.js';

/**
 * P0-2 回归：桥接 SDK 出站消息必须定向到宿主 origin，缺失时 fail-closed。
 *
 * 背景：早期实现 11 处出站 postMessage 均为 `window.__LMS_HOST_ORIGIN__ || "*"`，
 * 当反代剥掉 Host 头导致注入的 origin 为空串时，学生作答 / Hook 遥测会静默广播到
 * "*"。修复后统一走 `__lmsHostOrigin()`：缺失即抛错（除非显式 __LMS_ENFORCE_ORIGIN__=false）。
 */
describe('P0-2: 桥接出站 origin 守卫', () => {
  it('BRIDGE_SDK_CODE 不再把出站消息广播到 "*"', () => {
    expect(BRIDGE_SDK_CODE).not.toContain('__LMS_HOST_ORIGIN__ || "*"');
    expect(BRIDGE_SDK_CODE).toContain('function __lmsHostOrigin()');
    // 11 处出站调用 + 1 处函数定义
    expect([...BRIDGE_SDK_CODE.matchAll(/__lmsHostOrigin\(\)/g)].length).toBeGreaterThanOrEqual(11);
    // 入站校验（expectedHost）保留不变
    expect(BRIDGE_SDK_CODE).toContain('window.__LMS_HOST_ORIGIN__ || null');
    // fail-closed 语义：仅显式 false 才回退旧行为
    expect(BRIDGE_SDK_CODE).toContain('__LMS_ENFORCE_ORIGIN__ !== false');
  });

  it('resolveRequestHostOrigin 从 Host + X-Forwarded-Proto 推导 origin', () => {
    expect(
      resolveRequestHostOrigin({ headers: { host: 'lms.example.com', 'x-forwarded-proto': 'https' } }),
    ).toBe('https://lms.example.com');
    expect(resolveRequestHostOrigin({ headers: { host: 'localhost:9000' }, protocol: 'http' })).toBe(
      'http://localhost:9000',
    );
    // 多值 X-Forwarded-Proto 取首段
    expect(resolveRequestHostOrigin({ headers: { host: 'a.test', 'x-forwarded-proto': 'https, http' } })).toBe(
      'https://a.test',
    );
    // Host 缺失 → 空串，上层据此 fail-closed
    expect(resolveRequestHostOrigin({ headers: {} })).toBe('');
  });

  it('injectLmsSdk 注入宿主 origin 与 enforce 标志', () => {
    const html = injectLmsSdk(
      '<html><head></head><body></body></html>',
      { headers: { host: 'lms.example.com', 'x-forwarded-proto': 'https' } },
      { id: 'cw', name: 'n', uuid: 'u' },
    );
    expect(html).toContain('window.__LMS_HOST_ORIGIN__ = "https://lms.example.com"');
    expect(html).toContain('window.__LMS_ENFORCE_ORIGIN__ =');
  });

  describe('/bridge.js 路由（白板 srcDoc 路径）', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
      const app = express();
      registerBridgeRoutes({ app, io: { emit: () => {} } as any } as any);
      server = createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('前置注入宿主 origin + enforce，且早于 SDK 执行', async () => {
      const res = await fetch(`${baseUrl}/bridge.js?cw=lesson-1`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('window.__LMS_HOST_ORIGIN__ = "http://127.0.0.1:');
      expect(body).toContain('window.__LMS_ENFORCE_ORIGIN__ =');
      // 注入必须在 __lmsHostOrigin 定义之前，运行时才读得到
      expect(body.indexOf('window.__LMS_HOST_ORIGIN__')).toBeLessThan(body.indexOf('function __lmsHostOrigin()'));
    });
  });
});
