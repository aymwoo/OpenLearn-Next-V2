/**
 * 路由数据范围声明与审计（Issue #140）。
 *
 * 背景：`server/routes/*.ts` 里大量路由用 `requireAuth()`（不限角色）只校验「已登录」，
 * 是否做了对象级数据范围判断全凭各 handler 自觉。历史缺口（#127/#128/#133/#139）
 * 都是这么漏出去的。
 *
 * 本模块提供三件事：
 * 1. **声明**：`requireScopedAuth(scope)` 在认证之外声明该路由的数据范围，
 *    并对 `admin` / `class-staff` 做中间件级角色下限拦截。
 * 2. **审计**：`collectAuthRoutes()` 遍历 Express 路由栈，找出「用了 requireAuth
 *    但没有声明 scope」的路由。
 * 3. **迁移期**：`auditRouteScopes()` 默认只告警并列出白名单；设置
 *    `ROUTE_SCOPE_ENFORCE=true` 时直接抛错（供 CI / 严格环境使用）。
 */

import type { Express } from 'express';

/**
 * 路由声明的数据范围。
 *
 * - `public`：无需登录（本模块不对其做认证，仅用于文档/审计标记）。
 * - `authenticated`：任意已登录用户；仅限全局目录/元数据，不含个人或班级归属数据。
 * - `self`：仅本人数据；handler 必须按 session 主体做归属校验。
 * - `class-member`：班级成员（管理员 / 班级 owner 教师 / 已选课学生）；
 *   handler 必须用 `authorizeClass(..., 'member')` 或等价逻辑校验。
 * - `class-staff`：班级管理者（管理员 / 班级 owner 教师）；中间件先做角色下限，
 *   handler 仍需校验班级归属。
 * - `admin`：仅管理员；中间件直接拦截。
 */
export type DataScope = 'public' | 'authenticated' | 'self' | 'class-member' | 'class-staff' | 'admin';

export const AUTH_MIDDLEWARE_MARKER = Symbol.for('openlearn.routeScope.authMiddleware');
export const DATA_SCOPE_MARKER = Symbol.for('openlearn.routeScope.dataScope');

export interface AuthMiddlewareMeta {
  /** requireAuth 声明的角色列表；空数组表示「不限角色」。 */
  roles: string[];
}

export interface AuthRouteInfo {
  method: string;
  path: string;
  scope?: DataScope;
  roles: string[];
}

export interface RouteScopeAudit {
  /** 已声明 scope 的路由。 */
  declared: AuthRouteInfo[];
  /** 仅声明了角色、未声明 scope 的路由（本 issue 的审计目标只针对 roles 为空的路由）。 */
  roleGated: AuthRouteInfo[];
  /** 用了 `requireAuth()`（不限角色）但既未声明 scope、也不在白名单里的路由。 */
  undeclared: AuthRouteInfo[];
}

export interface RouteScopeWhitelistEntry {
  method: string;
  path: string;
  reason: string;
}

/** 给认证中间件打标，供路由栈审计识别。 */
export function markAuthMiddleware<T extends (...args: any[]) => any>(middleware: T, roles: string[]): T {
  Object.defineProperty(middleware, AUTH_MIDDLEWARE_MARKER, {
    value: { roles: [...roles] } satisfies AuthMiddlewareMeta,
    enumerable: false,
    configurable: true,
  });
  return middleware;
}

/** 给数据范围中间件打标。 */
export function markDataScopeMiddleware<T extends (...args: any[]) => any>(middleware: T, scope: DataScope): T {
  Object.defineProperty(middleware, DATA_SCOPE_MARKER, {
    value: scope,
    enumerable: false,
    configurable: true,
  });
  return middleware;
}

function readMarker<T>(handle: unknown, marker: symbol): T | undefined {
  if (typeof handle !== 'function') return undefined;
  return (handle as any)[marker] as T | undefined;
}

/**
 * 遍历 Express 4 的路由栈，收集所有挂了认证中间件的路由。
 *
 * 说明：这里依赖 Express 4 的 `_router.stack` 内部结构。项目锁定 Express 4.x
 * （package.json），升级到 5 时需同步调整本函数；测试会锁住行为。
 */
export function collectAuthRoutes(app: Express): AuthRouteInfo[] {
  const router: any = (app as any)._router ?? (app as any).router;
  const stack: any[] = router?.stack ?? [];
  const result: AuthRouteInfo[] = [];

  for (const layer of stack) {
    const route = layer?.route;
    if (!route) continue;
    const handles: unknown[] = (route.stack ?? []).map((entry: any) => entry.handle);
    const authMeta = handles
      .map((handle) => readMarker<AuthMiddlewareMeta>(handle, AUTH_MIDDLEWARE_MARKER))
      .find(Boolean);
    if (!authMeta) continue;

    const scope = handles.map((handle) => readMarker<DataScope>(handle, DATA_SCOPE_MARKER)).find(Boolean);
    const methods = Object.keys(route.methods ?? {})
      .filter((method) => method !== '_all' && (route.methods as Record<string, boolean>)[method])
      .map((method) => method.toUpperCase());

    for (const method of methods) {
      result.push({
        method,
        path: String(route.path),
        scope,
        roles: [...authMeta.roles],
      });
    }
  }

  return result;
}

function isWhitelisted(route: AuthRouteInfo, whitelist: RouteScopeWhitelistEntry[]): boolean {
  return whitelist.some(
    (entry) => entry.method.toUpperCase() === route.method && normalizePath(entry.path) === normalizePath(route.path),
  );
}

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
}

/**
 * 审计路由数据范围声明。
 *
 * @param whitelist 允许暂缓声明的路由（每条必须带理由）。
 */
export function auditRouteScopes(app: Express, whitelist: RouteScopeWhitelistEntry[] = []): RouteScopeAudit {
  const declared: AuthRouteInfo[] = [];
  const roleGated: AuthRouteInfo[] = [];
  const undeclared: AuthRouteInfo[] = [];

  for (const route of collectAuthRoutes(app)) {
    if (route.scope) {
      declared.push(route);
      continue;
    }
    // 已声明具体角色的路由本轮不强制 scope：它们至少有粗粒度角色门禁。
    // 后续收紧时可把这里改成同样要求 scope。
    if (route.roles.length > 0) {
      roleGated.push(route);
      continue;
    }
    if (isWhitelisted(route, whitelist)) continue;
    undeclared.push(route);
  }

  return { declared, roleGated, undeclared };
}

export function formatRouteScopeViolation(route: AuthRouteInfo): string {
  return `${route.method} ${route.path}`;
}

export interface AuditOptions {
  whitelist?: RouteScopeWhitelistEntry[];
  /** true = 发现未声明路由时抛错；false/省略 = 仅告警。 */
  enforce?: boolean;
  logger?: Pick<Console, 'warn' | 'error' | 'info'>;
}

/**
 * 启动期审计入口：在全部路由注册完成后调用一次。
 *
 * 迁移期默认 warn；`ROUTE_SCOPE_ENFORCE=true` 时抛错，避免未声明路由继续流入。
 */
export function assertRouteDataScopes(app: Express, options: AuditOptions = {}): RouteScopeAudit {
  const logger = options.logger ?? console;
  const audit = auditRouteScopes(app, options.whitelist ?? []);

  if (audit.undeclared.length > 0) {
    const lines = audit.undeclared.map(formatRouteScopeViolation);
    const message =
      `[RouteScope] ${audit.undeclared.length} 个已认证路由未声明数据范围` +
      `（requireScopedAuth）：\n  - ${lines.join('\n  - ')}`;

    if (options.enforce) {
      logger.error(message);
      throw new Error(message);
    }
    logger.warn(message);
  }

  if (audit.declared.length > 0) {
    logger.info?.(
      `[RouteScope] 已声明数据范围 ${audit.declared.length} 条，角色门禁路由 ${audit.roleGated.length} 条，` +
        `未声明 ${audit.undeclared.length} 条（白名单 ${options.whitelist?.length ?? 0} 条）。`,
    );
  }

  return audit;
}
