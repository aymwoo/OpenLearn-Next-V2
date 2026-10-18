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
  PluginStreamHandler,
  PluginStreamResponse,
} from './types.js';

interface RouteEntry {
  method: string;
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  handler?: PluginApiHandler;
  streamHandler?: PluginStreamHandler;
  isStream?: boolean;
  /** 数据范围声明（Issue #140，迁移期可选）。 */
  scope?: PluginRouteScope;
}

/** 插件路由数据范围声明（Issue #140）。 */
export type PluginRouteScope = 'authenticated' | 'self' | 'class-member' | 'class-staff' | 'admin';

export interface PluginRouteOptions {
  /**
   * 声明该路由访问的数据范围。未声明时宿主在迁移期仅打印告警、不拒绝请求，
   * 下一大版本再默认拒绝。
   */
  scope?: PluginRouteScope;
}

export interface PluginHttpRouterOptions {
  pluginId?: string;
  /** 注册了未声明 scope 的路由时回调；默认打印告警。 */
  onUnscopedRoute?: (info: { pluginId?: string; method: string; pattern: string }) => void;
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

  constructor(private readonly options: PluginHttpRouterOptions = {}) {}

  /**
   * 注册指定动词与路径的 Handler
   */
  route<TBody = unknown, TRes = unknown>(
    method: string,
    path: string,
    handler: PluginApiHandler<TBody, TRes>,
    options: PluginRouteOptions = {},
  ): void {
    const upperMethod = method.toUpperCase();
    const normalized = path.startsWith('/') ? path : '/' + path;
    const { regex, paramNames } = compileRoutePattern(normalized);
    this.warnIfUnscoped(upperMethod, normalized, options);
    this.routes.push({
      method: upperMethod,
      pattern: normalized,
      regex,
      paramNames,
      handler: handler as PluginApiHandler,
      isStream: false,
      scope: options.scope,
    });
  }

  get<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>, options?: PluginRouteOptions): void {
    this.route('GET', path, handler, options);
  }

  post<TBody = unknown, TRes = unknown>(
    path: string,
    handler: PluginApiHandler<TBody, TRes>,
    options?: PluginRouteOptions,
  ): void {
    this.route('POST', path, handler, options);
  }

  put<TBody = unknown, TRes = unknown>(
    path: string,
    handler: PluginApiHandler<TBody, TRes>,
    options?: PluginRouteOptions,
  ): void {
    this.route('PUT', path, handler, options);
  }

  patch<TBody = unknown, TRes = unknown>(
    path: string,
    handler: PluginApiHandler<TBody, TRes>,
    options?: PluginRouteOptions,
  ): void {
    this.route('PATCH', path, handler, options);
  }

  delete<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>, options?: PluginRouteOptions): void {
    this.route('DELETE', path, handler, options);
  }

  private warnIfUnscoped(method: string, pattern: string, options: PluginRouteOptions): void {
    if (options.scope) return;
    const info = { pluginId: this.options.pluginId, method, pattern };
    if (this.options.onUnscopedRoute) {
      this.options.onUnscopedRoute(info);
      return;
    }
    console.warn(
      `[RouteScope] 插件${this.options.pluginId ? ` ${this.options.pluginId}` : ''} 路由 ${method} ${pattern} ` +
        `未声明数据范围（迁移期仅告警）`,
    );
  }

  /**
   * 注册 Server-Sent Events (SSE) 流式响应端点
   */
  stream<TBody = unknown>(path: string, handler: PluginStreamHandler<TBody>): void;
  stream<TBody = unknown>(method: string, path: string, handler: PluginStreamHandler<TBody>): void;
  stream<TBody = unknown>(
    methodOrPath: string,
    pathOrHandler: string | PluginStreamHandler<TBody>,
    maybeHandler?: PluginStreamHandler<TBody>,
  ): void {
    if (typeof pathOrHandler === 'function') {
      const path = methodOrPath;
      const handler = pathOrHandler;
      this.registerStream('GET', path, handler);
      this.registerStream('POST', path, handler);
    } else {
      const method = methodOrPath.toUpperCase();
      const path = pathOrHandler;
      const handler = maybeHandler as PluginStreamHandler<TBody>;
      this.registerStream(method, path, handler);
    }
  }

  private registerStream<TBody = unknown>(method: string, path: string, handler: PluginStreamHandler<TBody>): void {
    const normalized = path.startsWith('/') ? path : '/' + path;
    const { regex, paramNames } = compileRoutePattern(normalized);
    this.routes.push({
      method: method.toUpperCase(),
      pattern: normalized,
      regex,
      paramNames,
      streamHandler: handler as PluginStreamHandler,
      isStream: true,
    });
  }

  /**
   * 检查指定动词与路径是否为流式路由
   */
  isStream(method: string, path: string): boolean {
    const upperMethod = method.toUpperCase();
    const normalized = path.startsWith('/') ? path : '/' + path;
    for (const entry of this.routes) {
      if (entry.method !== upperMethod) continue;
      if (entry.regex.test(normalized)) {
        return entry.isStream === true;
      }
    }
    return false;
  }

  /**
   * 匹配路由并提取路由参数
   */
  match(
    method: string,
    path: string,
  ): {
    handler?: PluginApiHandler;
    streamHandler?: PluginStreamHandler;
    isStream?: boolean;
    params: Record<string, string>;
  } | null {
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
          streamHandler: entry.streamHandler,
          isStream: entry.isStream,
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

    if (matched.isStream) {
      return {
        status: 400,
        body: { error: `${req.path} is a streaming route, please use SSE or ctx.http.stream` },
      };
    }

    if (!matched.handler) {
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
   * 执行流式请求
   */
  async handleStream(req: PluginApiRequest, stream: PluginStreamResponse): Promise<void> {
    const matched = this.match(req.method, req.path);
    if (!matched || !matched.streamHandler) {
      stream.error(new Error(`Cannot ${req.method} ${req.path} (Stream route not found)`));
      stream.end();
      return;
    }

    const requestWithParams: PluginApiRequest = {
      ...req,
      params: { ...req.params, ...matched.params },
    };

    try {
      await matched.streamHandler(requestWithParams, stream);
    } catch (err: any) {
      if (!stream.isClosed) {
        stream.error(err instanceof Error ? err : new Error(String(err)));
        stream.end();
      }
    }
  }

  /**
   * 获取所有已注册的路由元数据（用于调试或内省）
   */
  getRegisteredRoutes(): Array<{ method: string; pattern: string; isStream?: boolean; scope?: PluginRouteScope }> {
    return this.routes.map((r) => ({
      method: r.method,
      pattern: r.pattern,
      isStream: r.isStream,
      scope: r.scope,
    }));
  }

  /** 列出尚未声明数据范围的已注册路由（Issue #140 迁移期巡检用）。 */
  getUnscopedRoutes(): Array<{ method: string; pattern: string }> {
    return this.routes.filter((r) => !r.scope).map((r) => ({ method: r.method, pattern: r.pattern }));
  }

  /**
   * 清空所有路由
   */
  clear(): void {
    this.routes = [];
  }
}
