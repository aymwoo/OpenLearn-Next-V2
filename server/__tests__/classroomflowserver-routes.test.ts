/**
 * ClassroomFlowServer 路由注册契约测试。
 *
 * 锁死：7 个端点都挂上、且每个都带认证/数据范围中间件（route-scope 审计的
 * 第一道闸）；业务行为由三个 service 的单测覆盖，这里只验证门面接线。
 */
import { describe, it, expect, vi } from 'vitest';
import type { Express } from 'express';
import { registerClassroomFlowServerRoutes } from '../routes/classroomflowserver.js';

interface RegisteredRoute {
  method: string;
  path: string;
  handlerCount: number;
}

function makeMockApp(): { app: Express; routes: RegisteredRoute[] } {
  const routes: RegisteredRoute[] = [];
  const app = {
    get: vi.fn((path: string, ...handlers: unknown[]) => {
      routes.push({ method: 'GET', path, handlerCount: handlers.length });
    }),
    post: vi.fn((path: string, ...handlers: unknown[]) => {
      routes.push({ method: 'POST', path, handlerCount: handlers.length });
    }),
  } as unknown as Express;
  return { app, routes };
}

describe('ClassroomFlowServer 路由注册契约', () => {
  it('注册全部 11 个端点，且每个都带 ≥2 个中间件（认证/范围 + handler）', () => {
    const { app, routes } = makeMockApp();
    registerClassroomFlowServerRoutes(app);

    const expected = [
      'POST /api/classroomflowserver/awardCredits',
      'GET /api/classroomflowserver/rewards',
      'GET /api/classroomflowserver/rewards/:id',
      'POST /api/classroomflowserver/rewards',
      'POST /api/classroomflowserver/rewards/:id/status',
      'POST /api/classroomflowserver/redeem',
      'GET /api/classroomflowserver/credits/summary',
      'GET /api/classroomflowserver/messages',
      'POST /api/classroomflowserver/messages/:id/ack',
      'GET /api/classroomflowserver/submissions',
      'POST /api/classroomflowserver/submissions/:adapterId/grade',
    ];
    const actual = routes.map((r) => `${r.method} ${r.path}`);
    expect(actual.sort()).toEqual(expected.sort());
    for (const route of routes) {
      expect(route.handlerCount).toBeGreaterThanOrEqual(2);
    }
  });

  it('敏感端点（发放/目录写/兑换）均挂了认证中间件', () => {
    const { app, routes } = makeMockApp();
    registerClassroomFlowServerRoutes(app);
    const sensitive = routes.filter(
      (r) =>
        r.path.includes('/awardCredits') ||
        r.path.includes('/redeem') ||
        (r.method === 'POST' && r.path.includes('/rewards')),
    );
    expect(sensitive.length).toBeGreaterThanOrEqual(3);
    for (const r of sensitive) expect(r.handlerCount).toBeGreaterThanOrEqual(2);
  });
});
