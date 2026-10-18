/**
 * 数据范围中间件（Issue #140）。
 *
 * `requireScopedAuth(scope)` = `requireAuth()` + 数据范围声明 + 角色下限拦截：
 * - `admin`：仅管理员；
 * - `class-staff`：管理员或教师（班级归属仍由 handler 用 authorizeClass 校验）；
 * - `self` / `class-member` / `authenticated`：只要求已登录，对象级校验由 handler 负责。
 *
 * 门禁的职责是「不允许存在未声明的已认证路由」，而不是替代 handler 的对象级校验。
 */

import type { NextFunction, Request, Response } from 'express';
import { requireAuth } from './auth.js';
import { markAuthMiddleware, markDataScopeMiddleware, type DataScope } from '../security/route-scope.js';
import { isAdministrator, isTeacher } from '../services/class-access.js';

/** 各 scope 在中间件层可执行的粗粒度角色下限。 */
const SCOPE_ROLE_FLOOR: Record<DataScope, string[]> = {
  public: [],
  authenticated: [],
  self: [],
  'class-member': [],
  'class-staff': ['teacher', 'administrator'],
  admin: ['administrator'],
};

export function requireScopedAuth(scope: DataScope, ...explicitRoles: string[]) {
  if (scope === 'public') {
    throw new Error('[RouteScope] public 路由不应使用 requireScopedAuth；请直接注册为匿名路由');
  }

  const roles = explicitRoles.length > 0 ? explicitRoles : SCOPE_ROLE_FLOOR[scope];
  const auth = requireAuth(...roles);

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    auth(req, res, () => {
      const session = (req as any).session;

      if (scope === 'admin' && !isAdministrator(session)) {
        return res.status(403).json({ success: false, error: 'Forbidden: administrator only' });
      }
      if (scope === 'class-staff' && !isAdministrator(session) && !isTeacher(session)) {
        return res.status(403).json({ success: false, error: 'Forbidden: class staff only' });
      }

      (req as any).dataScope = scope;
      next();
    });
  };

  markAuthMiddleware(middleware, roles);
  markDataScopeMiddleware(middleware, scope);
  return middleware;
}

/**
 * 为已有认证中间件的路由补充数据范围声明（不改变认证/角色行为）。
 * 供后续把 `requireAuth('teacher')` 一类路由纳入 scope 体系时使用。
 */
export function declareDataScope(scope: DataScope) {
  const middleware = (_req: Request, _res: Response, next: NextFunction) => next();
  return markDataScopeMiddleware(middleware, scope);
}

/** 读取当前请求声明的数据范围（调试/审计用）。 */
export function getRequestDataScope(req: Request): DataScope | undefined {
  return (req as any).dataScope as DataScope | undefined;
}
