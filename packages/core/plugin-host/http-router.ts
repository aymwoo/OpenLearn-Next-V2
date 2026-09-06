/**
 * PluginHttpRouter — 插件轻量级 RESTful 路由注册与派发器。
 *
 * 既可在宿主主线程供 Inline 插件使用，也可在 Worker 隔离沙箱内运行。
 * 支持标准动词 (GET/POST/PUT/PATCH/DELETE)、动态路径参数 (:id) 与通配符 (*)。
 *
 * @module
 */

import type {
  IPluginHttpRouter,
  PluginApiHandler,
  PluginApiRequest,
  PluginApiResponse,
} from './types.js';

interface RouteEntry {
  method: string;
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  handler: PluginApiHandler;
}

/**
 * 将带参数的路由模板（如 /students/:id 或 /assets/*）转换为正则表达式
 */
export function compileRoutePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const normalized = pattern.startsWith('/') ? pattern : '/' + pattern;
  const paramNames: string[] = [];

  // 将 :param 替换为命名捕获组，将 * 替换为通配捕获组
  const regexStr = normalized
    .replace(/:([a-zA-Z0-9_]+)/g, (_match, paramName) => {
      paramNames.push(paramName);
      return '([^/]+)';
    })
    .replace(/\*/g, () => {
      paramNames.push('wildcard');
      return '(.*)';
    });

  return {
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

export class PluginHttpRouter implements IPluginHttpRouter {
  private routes: RouteEntry[] = [];

  /**
   * 注册指定动词与路径的 Handler
   */
  route<TBody = unknown, TRes = unknown>(
    method: string,
    path: string,
    handler: PluginApiHandler<TBody, TRes>,
  ): void {
    const upperMethod = method.toUpperCase();
    const normalized = path.startsWith('/') ? path : '/' + path;
    const { regex, paramNames } = compileRoutePattern(normalized);
    this.routes.push({
      method: upperMethod,
      pattern: normalized,
      regex,
      paramNames,
      handler: handler as PluginApiHandler,
    });
  }

  get<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>): void {
    this.route('GET', path, handler);
  }

  post<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void {
    this.route('POST', path, handler);
  }

  put<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void {
    this.route('PUT', path, handler);
  }

  patch<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void {
    this.route('PATCH', path, handler);
  }

  delete<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>): void {
    this.route('DELETE', path, handler);
  }

  /**
   * 匹配路由并提取路由参数
   */
  match(
    method: string,
    path: string,
  ): { handler: PluginApiHandler; params: Record<string, string> } | null {
    const upperMethod = method.toUpperCase();
    const normalized = path.startsWith('/') ? path : '/' + path;

    for (const entry of this.routes) {
      if (entry.method !== upperMethod) continue;
      const match = normalized.match(entry.regex);
      if (match) {
        const params: Record<string, string> = {};
        for (let i = 0; i < entry.paramNames.length; i++) {
          params[entry.paramNames[i]] = decodeURIComponent(match[i + 1] || '');
        }
        return {
          handler: entry.handler,
          params,
        };
      }
    }
    return null;
  }

  /**
   * 执行请求
   */
  async handle(req: PluginApiRequest): Promise<PluginApiResponse> {
    const matched = this.match(req.method, req.path);
    if (!matched) {
      return {
        status: 404,
        body: { error: `Cannot ${req.method} ${req.path}` },
      };
    }

    const requestWithParams: PluginApiRequest = {
      ...req,
      params: { ...req.params, ...matched.params },
    };

    const rawResult = await matched.handler(requestWithParams);

    // 如果 Handler 直接返回了带有 status/body 的结构
    if (
      rawResult !== null &&
      typeof rawResult === 'object' &&
      'body' in (rawResult as any) &&
      (typeof (rawResult as any).status === 'number' || (rawResult as any).status === undefined)
    ) {
      const resp = rawResult as PluginApiResponse;
      return {
        status: resp.status ?? 200,
        headers: resp.headers,
        body: resp.body,
      };
    }

    // 默认包装为 200 OK
    return {
      status: 200,
      body: rawResult,
    };
  }

  /**
   * 获取所有已注册的路由元数据（用于调试或内省）
   */
  getRegisteredRoutes(): Array<{ method: string; pattern: string }> {
    return this.routes.map((r) => ({ method: r.method, pattern: r.pattern }));
  }

  /**
   * 清空所有路由
   */
  clear(): void {
    this.routes = [];
  }
}
