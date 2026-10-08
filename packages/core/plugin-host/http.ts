/**
 * PluginHost · http 层（L-2 阶段 2）。
 *
 * `PluginHostHttp` 继承 `PluginHostCore`。链序约束见 `base.ts` 的说明。
 */

import { PluginHostCore } from './core.js';
import path from 'path';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import { PluginState } from './types.js';
import type { PluginApiRequest, PluginApiResponse, PluginStreamResponse } from './types.js';
import { PluginHttpRouter, compileRoutePattern } from './http-router.js';

export abstract class PluginHostHttp extends PluginHostCore {
  /**
   * 向插件派发 HTTP 请求（自动路由到 Worker 隔离线程或 Inline 实例）
   */
  async dispatchHttpRequest(
    pluginIdOrManifestId: string,
    req: PluginApiRequest,
    timeoutMs: number = 5000,
  ): Promise<PluginApiResponse> {
    const resolvedId = this.resolvePluginUuid(pluginIdOrManifestId);
    const instance = this.pluginInstances.get(resolvedId) ?? this.pluginInstances.get(pluginIdOrManifestId);

    if (!instance) {
      const state = this.pluginStates.get(resolvedId) ?? this.pluginStates.get(pluginIdOrManifestId);
      if (state && state !== PluginState.ACTIVE) {
        return {
          status: 503,
          body: { error: `Plugin "${pluginIdOrManifestId}" is currently ${state}` },
        };
      }
      return {
        status: 404,
        body: { error: `Plugin "${pluginIdOrManifestId}" not found or not active` },
      };
    }

    // 1. Worker 模式派发
    if (instance.workerRef) {
      return instance.workerRef.serviceHost.dispatchHttpRequest(instance.workerRef.transport, req, timeoutMs);
    }

    // 2. Inline 模式派发
    if (instance.context?.http) {
      return (instance.context.http as PluginHttpRouter).handle(req);
    }

    return {
      status: 404,
      body: { error: `Plugin "${pluginIdOrManifestId}" has no HTTP router registered` },
    };
  }

  /**
   * 判断指定插件的某个请求路径是否为流式路由 (SSE)
   */
  isStreamRoute(pluginIdOrManifestId: string, method: string, path: string): boolean {
    const upperMethod = method.toUpperCase();
    const resolvedId = this.resolvePluginUuid(pluginIdOrManifestId);
    const instance = this.pluginInstances.get(resolvedId) ?? this.pluginInstances.get(pluginIdOrManifestId);

    // 1. 先检查 Manifest 中的静态路由规则是否有 streaming: true
    const manifest = this.getPluginManifest(pluginIdOrManifestId);
    if (manifest?.api?.routes) {
      for (const r of manifest.api.routes) {
        if (r.method.toUpperCase() === upperMethod && (r as any).streaming === true) {
          const compiled = compileRoutePattern(r.path);
          if (compiled.regex.test(path)) {
            return true;
          }
        }
      }
    }

    if (!instance) return false;

    // 2. Inline 模式检查
    if (instance.context?.http) {
      return (instance.context.http as PluginHttpRouter).isStream(upperMethod, path);
    }

    // 3. Worker 模式检查（根据 Worker 上报的路由表）
    if (instance.workerRef) {
      const routes = instance.workerRef.serviceHost.getRegisteredRoutes();
      for (const r of routes) {
        if (r.method === upperMethod && r.isStream) {
          const compiled = compileRoutePattern(r.pattern);
          if (compiled.regex.test(path)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * 向插件派发 HTTP SSE 流式传输请求（自动路由到 Worker 隔离线程或 Inline 实例）
   */
  async dispatchHttpStream(
    pluginIdOrManifestId: string,
    req: PluginApiRequest,
    stream: PluginStreamResponse,
    maxLifetimeMs: number = 300000,
  ): Promise<void> {
    const resolvedId = this.resolvePluginUuid(pluginIdOrManifestId);
    const instance = this.pluginInstances.get(resolvedId) ?? this.pluginInstances.get(pluginIdOrManifestId);

    if (!instance) {
      const state = this.pluginStates.get(resolvedId) ?? this.pluginStates.get(pluginIdOrManifestId);
      if (state && state !== PluginState.ACTIVE) {
        stream.error(new Error(`Plugin "${pluginIdOrManifestId}" is currently ${state}`));
        stream.end();
        return;
      }
      stream.error(new Error(`Plugin "${pluginIdOrManifestId}" not found or not active`));
      stream.end();
      return;
    }

    // 1. Worker 模式派发
    if (instance.workerRef) {
      return instance.workerRef.serviceHost.dispatchHttpStream(
        instance.workerRef.transport,
        req,
        stream,
        maxLifetimeMs,
      );
    }

    // 2. Inline 模式派发
    if (instance.context?.http) {
      return (instance.context.http as PluginHttpRouter).handleStream(req, stream);
    }

    stream.error(new Error(`Plugin "${pluginIdOrManifestId}" has no HTTP router registered`));
    stream.end();
  }
}
