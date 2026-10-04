/**
 * sendSafeError 状态码透传的测试（2026-10-04）
 *
 * 背景：E3 服务抽离把 `return res.status(4xx).json({error})` 改成了 service 层
 * `err.status = 4xx` + 路由 `sendSafeError(res, e)`。但 `sendSafeError` 原实现
 * 忽略 `err.status`，一律用默认 500 —— **状态码在最后一跳被丢弃**，8 个端点受影响。
 *
 * 这里锁定：service 声明的业务状态码必须原样透出，且生产环境不能把 4xx 变成
 * "Internal server error"（否则前端无法区分「用户填错了」与「服务器坏了」）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { Response } from 'express';
import { sendSafeError } from '../utils/error-handler.js';

/** 最小 Response 替身，只实现 sendSafeError 用到的 status().json() 链。 */
function mockRes() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

function errWithStatus(status: number, message: string): Error & { status: number } {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

describe('sendSafeError · 状态码透传', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('service 声明 err.status 时原样透出，不再被吞成 500', () => {
    const { res, captured } = mockRes();
    sendSafeError(res, errWithStatus(404, 'Class not found'));
    expect(captured.status).toBe(404);
    expect(captured.body).toEqual({ success: false, error: 'Class not found' });
  });

  it('400 / 403 同样透出', () => {
    for (const s of [400, 403]) {
      const { res, captured } = mockRes();
      sendSafeError(res, errWithStatus(s, `msg ${s}`));
      expect(captured.status).toBe(s);
    }
  });

  it('err.status 缺失时回落到传入的 status（默认 500）', () => {
    const { res, captured } = mockRes();
    sendSafeError(res, new Error('boom'));
    expect(captured.status).toBe(500);
  });

  it('err.status 优先于显式传入的 status —— 44 处调用点显式传 500，不能让它压掉业务码', () => {
    const { res, captured } = mockRes();
    sendSafeError(res, errWithStatus(404, 'Class not found'), 500);
    expect(captured.status).toBe(404);
  });

  it('非法的 err.status（越界或非数字）被忽略，回落到 500', () => {
    for (const bad of [200, 302, 99, 600]) {
      const { res, captured } = mockRes();
      sendSafeError(res, errWithStatus(bad, 'x'));
      expect(captured.status, `err.status=${bad} 应被拒绝`).toBe(500);
    }
    const { res, captured } = mockRes();
    sendSafeError(res, Object.assign(new Error('x'), { status: '404' }));
    expect(captured.status).toBe(500);
  });

  it('非 Error 值也能安全处理', () => {
    const { res, captured } = mockRes();
    sendSafeError(res, 'plain string');
    expect(captured.status).toBe(500);
    expect((captured.body as { error: string }).error).toBe('plain string');
  });
});

describe('sendSafeError · 生产环境的暴露策略', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('生产环境：5xx 仍屏蔽为通用文案', () => {
    process.env.NODE_ENV = 'production';
    const { res, captured } = mockRes();
    sendSafeError(res, new Error('SQLITE_ERROR: no such table: users at /srv/app/x.ts'));
    expect(captured.status).toBe(500);
    expect((captured.body as { error: string }).error).toBe('Internal server error');
  });

  it('生产环境：4xx 保留业务文案（前端需要区分「班级不存在」与「服务器故障」）', () => {
    process.env.NODE_ENV = 'production';
    const { res, captured } = mockRes();
    sendSafeError(res, errWithStatus(404, 'Class not found'));
    expect(captured.status).toBe(404);
    expect((captured.body as { error: string }).error).toBe('Class not found');
  });

  it('非生产环境：4xx 保留原文案', () => {
    process.env.NODE_ENV = 'development';
    const { res, captured } = mockRes();
    sendSafeError(res, errWithStatus(400, 'Name is required'));
    expect((captured.body as { error: string }).error).toBe('Name is required');
  });
});
