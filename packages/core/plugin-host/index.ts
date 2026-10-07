/**
 * PluginHost — 插件生命周期管理器。
 *
 * D-02: 构造函数接收 ServiceRegistry + EsmLoader + Database
 * D-03: 7 状态 PluginState 枚举 + VALID_TRANSITIONS 查找表
 *
 * 完整生命周期方法（Plan 03）：
 * - installPlugin(sourceCode) — 安装插件到 DB
 * - activatePlugin(pluginId) — 激活插件（含超时 + 回滚）
 * - deactivatePlugin(pluginId) — 停用插件（含超时 + 强制清理）
 * - uninstallPlugin(pluginId) — 卸载并删除
 * - installPluginFromZip(zipBuffer) — ZIP 插件包安装
 * - restoreActivePlugins() — 从 DB 恢复 active 插件
 */

import { v7 as uuidv7 } from 'uuid';
import type { Database } from 'better-sqlite3';
import fs from 'fs';
import JSZip from 'jszip';
import path from 'path';
import express from 'express';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { ServiceRegistry } from '../di/service-registry.js';
import { EsmLoader } from '../esm-loader/esm-loader.js';
import type { PluginModule } from '../esm-loader/esm-loader.js';
import { EsmLoadTimeoutError, EsmActivationError } from '../esm-loader/errors.js';
import { manifestSchema } from '../esm-loader/manifest-schema.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import { validateAndBundleZip } from '../esm-loader/install-utils.js';
import { ResourceTracker } from './resource-tracker.js';
import { buildContext } from './context-builder.js';
import { ContributionRegistry } from './contribution-registry.js';
import type { ContributionSummary, ClassroomToolConfig } from './contribution-registry.js';
import { ConfigService } from './config-service.js';
import { installPluginDependencies, parsePluginDependencies } from './dependency-install.js';
import {
  checkMissingDeps,
  topologicalSort,
  buildDepGraph,
  parseServiceRequirement,
  CrossPluginServiceCheck,
} from './dependency-resolver.js';
import semver from 'semver';
import { parseRequiresEntry } from '../esm-loader/manifest-utils.js';
import { compose } from './middleware.js';
import { PluginState } from './types.js';
import type { Disposable } from './types.js';
import type {
  PluginContext,
  PluginInfo,
  LifecyclePhase,
  Middleware,
  MiddlewareContext,
  PluginApiRequest,
  PluginApiResponse,
  PluginStreamResponse,
} from './types.js';
import { PluginHttpRouter, compileRoutePattern } from './http-router.js';
import {
  IllegalStateTransitionError,
  PluginActivateError,
  PluginDeactivateTimeoutError,
  SemverMismatchError,
  HotReloadError,
  HotReloadActivationError,
} from './errors.js';
import {
  ICapabilityServiceToken,
  IEventBusServiceToken,
  IStageGuardServiceToken,
  IProcessServiceToken,
} from '../di/interfaces.js';
import type { IProcessService } from '../di/interfaces.js';
import type { ICapabilityService, IEventBusService } from '../di/interfaces.js';
import { WorkerManager } from '../worker-runtime/worker-manager.js';
import type { IWorkerTransport } from '../worker-runtime/types.js';
import type { ServiceHost } from '../worker-runtime/service-host.js';

// ── VALID_TRANSITIONS ──────────────────────────────────────────────────────

/**
 * 插件状态机合法转换表（D-03）。
 *
 * 来源：04-RESEARCH.md lines 326-334
 */
const VALID_TRANSITIONS: Record<PluginState, PluginState[]> = {
  [PluginState.INSTALLED]: [PluginState.ACTIVATING, PluginState.UNINSTALLED],
  [PluginState.ACTIVATING]: [PluginState.ACTIVE, PluginState.ERROR],
  [PluginState.ACTIVE]: [PluginState.DEACTIVATING],
  [PluginState.DEACTIVATING]: [PluginState.INACTIVE],
  [PluginState.INACTIVE]: [PluginState.ACTIVATING, PluginState.UNINSTALLED],
  [PluginState.ERROR]: [PluginState.ACTIVATING, PluginState.UNINSTALLED],
  [PluginState.UNINSTALLED]: [],
};

/**
 * 纯函数：验证插件状态转换是否合法。
 *
 * 从 PluginHost 的 validateTransition 提取，使其可独立测试。
 * 使用 VALID_TRANSITIONS 查找表，非法转换时抛出 IllegalStateTransitionError。
 *
 * @param currentState - 当前插件状态
 * @param nextState - 目标状态
 * @param pluginId - 插件标识符（用于错误消息）
 * @throws IllegalStateTransitionError 当转换不合法时
 */
export function validatePluginStateTransition(
  currentState: PluginState,
  nextState: PluginState,
  pluginId: string,
): void {
  const allowed = VALID_TRANSITIONS[currentState];
  if (!allowed?.includes(nextState)) {
    throw new IllegalStateTransitionError(pluginId, currentState, nextState);
  }
}

// ── Constants ──────────────────────────────────────────────────────────────

/** 激活/停用超时阈值（毫秒） */
const ACTIVATION_TIMEOUT_MS = 5000;
const DEACTIVATION_TIMEOUT_MS = 5000;

/** 平台版本号 — 用于 engines.openlearn 兼容性检查，统一从 version.js 引入并导出 */
import { OPENLEARN_VERSION } from '../version.js';
export { OPENLEARN_VERSION };

/** 插件静态资源安全沙箱中间件 */
function createPluginStaticMiddleware(absDir: string) {
  return [
    (_req: any, res: any, next: any) => {
      // SEC-SANDBOX: 强制沙箱隔离，禁止访问宿主 Cookie、localStorage 及发起同源特权请求，放行内联事件属性（移除 unsafe-eval）
      res.setHeader(
        'Content-Security-Policy',
        "sandbox allow-scripts allow-forms allow-downloads; default-src 'self' 'unsafe-inline' blob: data:; script-src 'self' 'unsafe-inline' blob: data:; script-src-attr 'unsafe-inline'; style-src-attr 'unsafe-inline';",
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    },
    express.static(absDir),
  ];
}

/**
 * 定位宿主自身安装的 @openlearn/plugin-sdk 目录。
 *
 * 插件打包时 SDK 被标记为 external，运行时由宿主提供；但宿主可能以 npx 缓存、
 * 全局安装等方式运行，其 node_modules 并不在插件目录的祖先链上。
 */
function resolveHostSdkDir(): string | null {
  const bases: string[] = [];
  // CJS 产物（dist/server.cjs）
  if (typeof __dirname !== 'undefined') bases.push(__dirname);
  try {
    // ESM / tsx 直接运行 TS 源码
    bases.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* CJS 产物中 import.meta 不可用 */
  }
  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, '__openlearn_resolve__.js'));
      return path.dirname(req.resolve('@openlearn/plugin-sdk/package.json'));
    } catch {
      /* 换下一个基准目录 */
    }
  }
  return null;
}

// ── PluginHost ─────────────────────────────────────────────────────────────

/**
 * 活跃插件实例的形状。
 *
 * 提取为命名类型（原先是 pluginInstances 声明处的内联字面量），便于
 * `disposeSnapshot` / `rollbackReload` 等方法在签名里引用，避免重复书写。
 */
interface PluginInstance {
  manifest: Manifest;
  activate: ((ctx: PluginContext) => Promise<void>) | undefined;
  deactivate?: (() => Promise<void>) | undefined;
  workerRef?: { transport: IWorkerTransport; serviceHost: ServiceHost };
  context?: PluginContext;
}

export class PluginHost {
  // D-03: 插件状态追踪
  private pluginStates = new Map<string, PluginState>();

  // D-07: 资源追踪器 — 按 pluginId 管理 Disposable 资源
  private resourceTracker = new ResourceTracker();

  // V3.0: 贡献注册表 — 声明式 UI 贡献点存储
  private contributionRegistry = new ContributionRegistry();

  /**
   * 贡献注册表的**只读**访问器。
   *
   * ## 为什么需要暴露
   *
   * H-2 的教训：注册用的键是 `manifest.id`，而 DB 行主键是 UUID，两者不一致。
   * 这个不一致此前**没有任何测试能覆盖** —— 因为唯一的调用点断言的是「卸载后为 0」，
   * 无论键匹不匹配都通过。要写能真正区分的测试，就必须能**在注册侧建立前提**，
   * 而三条注册路径（`installPlugin` / `installPluginFromZip` / `updatePluginFromZip`）
   * 都要求完整的打包产物，在单测里搭建成本远高于被测行为本身。
   *
   * 故提供只读入口：让「键约定」这个**不变量**本身可被断言。
   * 用 `as any` 绕过 `private` 也能做到，但那样测试就断言不了「这是有意的公开契约」，
   * 且会掩盖将来把它改成 `private` 的破坏性变更。
   *
   * 只读：返回的是 registry 实例本身，调用方仍应只调用 `summary` / `allSummaries` /
   * `getByPlugin` 等读方法。真正的写入口仍是三条 install 路径。
   */
  get contributions(): ContributionRegistry {
    return this.contributionRegistry;
  }

  // Phase 7: 中间件注册表 — 按生命周期阶段分组
  private middlewareRegistry = new Map<LifecyclePhase, Middleware[]>();

  // Preloaded plugins map for built-in plugins running in inline mode (Phase 8)
  private preloadedPlugins = new Map<
    string,
    {
      manifest: any;
      activate: (ctx: PluginContext) => Promise<void>;
      deactivate?: () => Promise<void>;
    }
  >();

  // 活跃插件实例引用（manifest + activate/deactivate 函数）
  private pluginInstances = new Map<string, PluginInstance>();

  /** Coalesce concurrent activate/deactivate calls per plugin (prevents activating→activating). */
  private inflightActivate = new Map<string, Promise<void>>();
  private inflightDeactivate = new Map<string, Promise<void>>();

  /**
   * Register a preloaded built-in plugin directly into memory (Phase 8).
   */
  registerPreloadedPlugin(
    pluginId: string,
    plugin: { manifest: any; activate: (ctx: PluginContext) => Promise<void>; deactivate?: () => Promise<void> },
  ): void {
    this.preloadedPlugins.set(pluginId, plugin);
  }

  /**
   * D-02: 构造函数 — 接收 3 个核心依赖。
   *
   * @param serviceRegistry - DI 容器
   * @param esmLoader - ESM 动态加载器（Node.js / 浏览器实现）
   * @param db - SQLite 数据库实例
   */
  /** 插件文件系统存储目录 */
  private pluginsDir: string;
  private expressApp: any = null;
  private _registeredRoutes = new Map<string, string>();

  /**
   * 静态路由的**归一化形式**，用于冲突检测与保留前缀比对（G-4b）。
   *
   * ## 为什么必须归一化
   *
   * Express 把 `/foo` 与 `/foo/` 当成**同一个** mount point（先挂载者生效，
   * 后者静默遮蔽），但字符串比较认为它们不同。原先只做 `toLowerCase()`，
   * 于是两个插件分别声明 `/assets` 与 `/assets/` 时：
   *   · 冲突检测放行
   *   · Express 静默让先挂载的赢
   *   · 后挂载插件的静态资源**永远 404，且没有任何日志或报错**
   *
   * 这类故障的排查成本极高：现象是「资源 404」，病因在两个插件的 manifest 里。
   *
   * ## 归一化规则
   *
   *   1. 转小写 —— URL 路径大小写不敏感（与既有 toLowerCase 行为一致）
   *   2. 压缩重复斜杠 —— `//a` ≡ `/a`
   *   3. 去掉末尾斜杠 —— `/a/` ≡ `/a`；根路径 `/` 例外，保留
   *   4. 补前导斜杠 —— 使 `a/b` 与 `/a/b` 也等价
   *
   * 规则 1 沿用既有实现而非新引入：改动它会扩大影响面，而它本身不是缺陷。
   */
  private static normalizeStaticRoute(route: string): string {
    const lowered = route.trim().toLowerCase();
    const collapsed = lowered.replace(/\/{2,}/g, '/');
    const withLeading = collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
    // 根路径 '/' 不能被削成 '' —— 它是合法的（虽然本处拒绝把 '/' 注册给插件，
    // 见 SEC-ROUTE-02，但归一化函数本身应保持幂等与正确）
    const withoutTrailing = withLeading.length > 1 ? withLeading.replace(/\/+$/, '') : withLeading;
    return withoutTrailing || '/';
  }
  private _socketIO: any = null;

  constructor(
    private serviceRegistry: ServiceRegistry,
    private esmLoader: EsmLoader,
    private db: Database,
    pluginsDir?: string,
  ) {
    this.pluginsDir = pluginsDir ?? path.resolve(process.cwd(), 'plugins');
  }

  setExpressApp(app: any): void {
    this.expressApp = app;
    // Restore static routes from installed plugins (survives server restart)
    const allPlugins = this.db.prepare('SELECT id, manifest, status FROM plugins').all() as Array<{
      id: string;
      manifest: string;
      status: string;
    }>;
    for (const p of allPlugins) {
      try {
        // 审计 D-3 / M-4：只为**活跃**插件挂载静态资源路由。
        //
        // 修复前对所有已安装插件（含 disabled / error / inactive）挂载，
        // 导致停用插件的静态资源仍可下载。
        //
        // 为什么在挂载时过滤、而不是在停用时摘除路由：
        //  1. `uninstallPlugin` 的摘除实现是遍历 `express._router.stack` 做 splice，
        //     只能命中一个 layer，而 `expressApp.use()` 挂载的是多层中间件；
        //  2. 本方法在**每次重启**都会重跑，任何运行时摘除都会被覆盖回去。
        // 在挂载时过滤则保证重启与运行时行为一致，且不依赖脆弱的 stack 手术。
        if (p.status !== 'active') continue;
        const m = JSON.parse(p.manifest);
        if (m.deploy?.staticRoute && m.deploy?.staticDir) {
          const pluginDir = this.getPluginDir(p.id);
          const absDir = path.join(pluginDir, m.deploy.staticDir);
          if (fs.existsSync(absDir)) {
            // 归一化 + 冲突检测（G-4b）。
            //
            // 恢复路径原先**两者都没做**：存原始路由，且完全不查冲突。
            // 后果是安装时检出（或未检出）的冲突在重启后被完全绕过 ——
            // 两个等价路由同时挂载，先到先得，另一方的资源永久 404 且无任何日志。
            const normalized = PluginHost.normalizeStaticRoute(m.deploy.staticRoute);
            let conflictWith: string | undefined;
            for (const [ownerId, existingRoute] of this._registeredRoutes.entries()) {
              if (ownerId !== m.id && PluginHost.normalizeStaticRoute(existingRoute) === normalized) {
                conflictWith = ownerId;
                break;
              }
            }
            if (conflictWith) {
              // 不抛错：重启路径不宜因一个插件的路由冲突而整体失败。
              // 但必须显式告警 —— 否则就是「静默遮蔽」，正是本项要消除的现象。
              console.error(
                `[PluginHost] Static route conflict on restore: "${m.deploy.staticRoute}" ` +
                  `(normalized: "${normalized}") for plugin "${m.id}" is already registered by ` +
                  `"${conflictWith}". 后者被遮蔽，其静态资源将 404。`,
              );
              continue;
            }
            this.expressApp.use(m.deploy.staticRoute, ...createPluginStaticMiddleware(absDir));
            this._registeredRoutes.set(m.id, normalized);
            console.log(`[PluginHost] Restored static route "${m.deploy.staticRoute}" for plugin "${m.id}"`);
          }
        }
      } catch {
        /* skip malformed */
      }
    }
  }

  setSocketIO(io: any): void {
    this._socketIO = io;
  }

  /**
   * P7-A2 Stage 2: 暴露声明式 UI 贡献点存储，供插件组合层接入。
   */
  public getContributionRegistry(): ContributionRegistry {
    return this.contributionRegistry;
  }

  private emitProgress(manifestId: string, step: string, detail?: string) {
    if (this._socketIO) {
      this._socketIO.emit('plugin:install:progress', {
        pluginId: manifestId,
        step,
        detail: detail || '',
        timestamp: Date.now(),
      });
    }
  }

  // ── 文件系统路径辅助方法 ──────────────────────────────────────────

  /** 获取插件的文件系统目录路径 */
  getPluginDir(pluginId: string): string {
    return path.join(this.pluginsDir, pluginId);
  }

  /**
   * 本宿主实例实际使用的插件根目录。
   *
   * 供 `Kernel` 等调用方读取，避免它们各自重新推导 `cwd/plugins` ——
   * 那正是 H-1 残留缺陷的成因：`Kernel` 构造器支持注入 `pluginsDir`，
   * 但迁移函数绕过它、自己又算了一遍，测试的重定向因此失效。
   *
   * 读取宿主的真实值而不是复制推导逻辑，两个来源就不可能分叉。
   */
  getPluginsDir(): string {
    return this.pluginsDir;
  }

  /** 获取插件入口 JS 文件路径 */
  getPluginFilePath(pluginId: string): string {
    return path.join(this.getPluginDir(pluginId), 'index.js');
  }

  /** 获取插件 manifest.json 文件路径 */
  getPluginManifestPath(pluginId: string): string {
    return path.join(this.getPluginDir(pluginId), 'manifest.json');
  }

  /**
   * 确保宿主的 @openlearn/plugin-sdk 能被插件解析到。
   *
   * 插件 index.js 位于 `<pluginsDir>/<id>/`，Node 只从该文件所在目录向上查找
   * node_modules。宿主的 node_modules（npx 缓存、仓库目录等）通常不在其祖先链上，
   * 于是 external 的 `@openlearn/plugin-sdk` 会抛 ERR_MODULE_NOT_FOUND。
   * 这里在 `<pluginsDir>/node_modules/@openlearn/plugin-sdk` 建立指向宿主 SDK 的
   * 链接，使该目录下所有插件共享宿主的同一份 SDK。
   */
  private ensureHostSdkResolution(): void {
    const linkPath = path.join(this.pluginsDir, 'node_modules', '@openlearn', 'plugin-sdk');
    if (fs.existsSync(linkPath)) return;
    const sdkDir = resolveHostSdkDir();
    if (!sdkDir) {
      console.warn('[PluginHost] 未能定位宿主的 @openlearn/plugin-sdk，插件加载可能因缺少运行时依赖而失败');
      return;
    }
    try {
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      // junction：Windows 下无需提权即可创建目录链接，POSIX 下等价为普通软链
      fs.symlinkSync(sdkDir, linkPath, 'junction');
      console.log(`[PluginHost] Linked host @openlearn/plugin-sdk: ${linkPath} -> ${sdkDir}`);
    } catch (err) {
      console.warn('[PluginHost] 建立 @openlearn/plugin-sdk 链接失败:', err);
    }
  }

  // ── V5.2: RESTful API Gateway Dispatcher ───────────────────────────────

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

  /**
   * 获取指定插件的 Manifest（支持已激活或 DB 中的插件）
   */
  getPluginManifest(pluginIdOrManifestId: string): Manifest | null {
    const resolvedId = this.resolvePluginUuid(pluginIdOrManifestId);
    const instance = this.pluginInstances.get(resolvedId) ?? this.pluginInstances.get(pluginIdOrManifestId);
    if (instance?.manifest) return instance.manifest;

    const preloaded = this.preloadedPlugins.get(resolvedId) ?? this.preloadedPlugins.get(pluginIdOrManifestId);
    if (preloaded?.manifest) return preloaded.manifest;

    try {
      const row = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(resolvedId) as
        { manifest: string } | undefined;
      if (row?.manifest) {
        return JSON.parse(row.manifest);
      }
    } catch {}
    return null;
  }

  // ── Phase 5: WorkerManager wiring (circular dependency fix) ────────────

  private _workerManager: WorkerManager | null = null;

  /**
   * Set the WorkerManager instance (Phase 5).
   * Called by Kernel after both PluginHost and WorkerManager are constructed,
   * avoiding circular dependency between the two.
   */
  setWorkerManager(wm: WorkerManager): void {
    this._workerManager = wm;
  }

  /** Internal getter — throws if WorkerManager was not set. */
  private get workerManager(): WorkerManager {
    if (!this._workerManager) {
      throw new Error(
        '[PluginHost] WorkerManager not set — call setWorkerManager before activating worker-mode plugins',
      );
    }
    return this._workerManager;
  }

  // ── Phase 7: Middleware Registration ─────────────────────────────────────

  /**
   * Phase 7: 注册生命周期中间件。
   *
   * 中间件在下次 activate/deactivate 时生效，不影响已激活插件。
   * 按注册顺序执行（洋葱模型）。
   *
   * @param phase - 挂载的生命周期阶段
   * @param middleware - 中间件函数
   */
  registerMiddleware(phase: LifecyclePhase, middleware: Middleware): void {
    const list = this.middlewareRegistry.get(phase);
    if (list) {
      list.push(middleware);
    } else {
      this.middlewareRegistry.set(phase, [middleware]);
    }
  }

  /**
   * 注销所有中间件（用于测试清理和热重载重置）。
   */
  clearMiddleware(): void {
    this.middlewareRegistry.clear();
  }

  /**
   * 获取指定阶段的中间件数组副本。
   */
  getMiddleware(phase: LifecyclePhase): Middleware[] {
    return [...(this.middlewareRegistry.get(phase) ?? [])];
  }

  /**
   * Read execution_mode from DB (added in Phase 5 for Worker isolation).
   * Returns 'inline' as default for backward compatibility.
   */
  private getExecutionMode(pluginId: string): string {
    try {
      const row = this.db.prepare('SELECT execution_mode FROM plugins WHERE id = ?').get(pluginId) as
        { execution_mode: string } | undefined;
      return row?.execution_mode ?? 'inline';
    } catch {
      // Column may not exist yet in test databases — fall back to 'inline'
      return 'inline';
    }
  }

  // ── Phase 6: SemVer compatibility check ─────────────────────────────────

  /**
   * Phase 6: 检查 manifest 中声明的 Token 版本兼容性。
   *
   * 供 installPlugin() 和 activatePlugin() 双重调用。
   *
   * - manifest.requires 中 Token 版本不兼容 -> 抛出 SemverMismatchError
   * - manifest.optional 中 Token 版本不兼容 -> console.warn + 收集到返回 Set
   * - 未注册的 Token -> 视为不兼容（requires 抛错，optional 收集到 Set）
   *
   * @returns Set<string> — 不兼容的 optional 依赖 tokenName 集合。
   *   激活时调用方将此集合传给 buildContext() 以设置 ctx.services[key] = null。
   *   安装时调用方可忽略返回值。
   * @param manifest - 插件 manifest（已通过 manifestSchema.parse）
   * @param pluginId - 插件 DB id
   * @param phase - 检查阶段标识（'install' 或 'activate'），仅用于日志
   */

  /**
   * V3.0: 检查插件的 pluginDependencies 是否全部已安装且处于 ACTIVE 状态。
   *
   * 返回 null 表示所有依赖满足；返回错误消息字符串表示依赖缺失或不可用。
   * 遵循 VS Code 模型：仅 ID 匹配，无版本范围约束。
   */
  private checkPluginDependencies(manifest: Manifest): string | null {
    const deps = manifest.pluginDependencies;
    if (!deps || deps.length === 0) return null;

    const activePluginIds = new Set<string>();
    for (const [id, state] of this.pluginStates) {
      if (state === PluginState.ACTIVE) {
        // Resolve to manifest.id
        const row = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(id) as
          { manifest: string } | undefined;
        if (row) {
          try {
            const m = JSON.parse(row.manifest);
            activePluginIds.add(m.id ?? id);
          } catch {
            activePluginIds.add(id);
          }
        }
      }
    }

    const missing: string[] = [];
    for (const dep of deps) {
      if (!activePluginIds.has(dep)) {
        // Check if installed at all
        const allInstalled = new Set(this.listInstalledPluginIds());
        if (!allInstalled.has(dep)) {
          missing.push(`${dep} (not installed)`);
        } else {
          missing.push(`${dep} (installed but not active)`);
        }
      }
    }

    if (missing.length > 0) {
      return `Plugin "${manifest.id}" requires: ${missing.join(', ')}`;
    }
    return null;
  }

  /**
   * V3.2: 检查 manifest.requires 中的跨插件服务需求是否能在提供方 manifest.provides 中找到声明。
   *
   * 安装时调用（warn），激活时调用（block）。
   *
   * @returns 未满足的跨插件服务需求列表，空数组表示全部满足
   */
  private checkCrossPluginServices(manifest: Manifest): CrossPluginServiceCheck | null {
    const reqs = manifest.requires;
    if (!reqs || reqs.length === 0) return null;

    const unsatisfied: Array<{ required: string; providerId: string }> = [];

    for (const req of reqs) {
      const parsed = parseServiceRequirement(req);
      if (!parsed) continue;

      const providerRow = this.db
        .prepare('SELECT id FROM plugins WHERE manifest LIKE ?')
        .get(`%"id":"${parsed.pluginId}"%`) as { id: string } | undefined;
      if (!providerRow) {
        unsatisfied.push({ required: req, providerId: parsed.pluginId });
        continue;
      }

      const mRow = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(providerRow.id) as
        { manifest: string } | undefined;
      if (!mRow) {
        unsatisfied.push({ required: req, providerId: parsed.pluginId });
        continue;
      }

      try {
        const providerManifest = JSON.parse(mRow.manifest);
        const provides: string[] = providerManifest.provides ?? [];
        if (!provides.includes(parsed.tokenName)) {
          unsatisfied.push({ required: req, providerId: parsed.pluginId });
        }
      } catch {
        unsatisfied.push({ required: req, providerId: parsed.pluginId });
      }
    }

    return unsatisfied.length > 0 ? { consumerId: manifest.id, unsatisfied } : null;
  }

  private checkSemVerCompatibility(
    manifest: { id?: string; name?: string; requires?: string[]; optional?: string[] },
    pluginId: string,
    phase: 'install' | 'activate',
  ): Set<string> {
    const pluginName = manifest.name ?? pluginId;
    const requiresList = manifest.requires ?? [];
    const optionalList = manifest.optional ?? [];
    const incompatibleOptionalTokens = new Set<string>();

    // -- Required dependencies -------------------------------------------------
    for (const req of requiresList) {
      const { tokenName, versionRange } = parseRequiresEntry(req);
      const actualVersion = this.serviceRegistry.getVersion(tokenName);

      if (!actualVersion) {
        throw new SemverMismatchError(pluginId, pluginName, tokenName, versionRange ?? '*', 'unregistered');
      }

      if (!versionRange) continue; // No version range = accept any version

      try {
        if (!semver.satisfies(actualVersion, versionRange)) {
          throw new SemverMismatchError(pluginId, pluginName, tokenName, versionRange, actualVersion);
        }
      } catch (semverErr) {
        if (semverErr instanceof SemverMismatchError) throw semverErr;
        // Invalid version range string — wrap in SemverMismatchError
        throw new SemverMismatchError(pluginId, pluginName, tokenName, versionRange, actualVersion);
      }
    }

    // -- Optional dependencies (D-12: collect, don't throw) --------------------
    for (const opt of optionalList) {
      const { tokenName, versionRange } = parseRequiresEntry(opt);
      const actualVersion = this.serviceRegistry.getVersion(tokenName);

      if (!actualVersion || (versionRange && !semver.satisfies(actualVersion, versionRange))) {
        console.warn(
          `[PluginHost] Optional dependency ${tokenName}${versionRange ? '@' + versionRange : ''} not satisfied ` +
            `(host: ${actualVersion ?? 'unregistered'}) — skipping injection for plugin "${pluginId}" (${phase})`,
        );
        incompatibleOptionalTokens.add(tokenName);
        continue;
      }
    }

    return incompatibleOptionalTokens;
  }

  // ── 状态机 ──────────────────────────────────────────────────────────────

  /**
   * 验证插件状态转换的合法性（D-03）。
   *
   * 使用 VALID_TRANSITIONS 查找表，非法转换时抛出 IllegalStateTransitionError。
   *
   * @param pluginId - 插件标识符
   * @param currentState - 当前状态
   * @param nextState - 目标状态
   * @throws IllegalStateTransitionError 当转换不合法时
   */
  private validateTransition(pluginId: string, currentState: PluginState, nextState: PluginState): void {
    validatePluginStateTransition(currentState, nextState, pluginId);
  }

  // ── 内省方法 ────────────────────────────────────────────────────────────

  /**
   * 查询数据库中所有已安装的插件，返回基本信息列表。
   *
   * 返回 id、name、version（从 JSON 解析的 manifest 中提取）、状态。
   * 若 DB 中无记录，返回空数组。
   */
  listPlugins(): PluginInfo[] {
    const rows = this.db
      .prepare('SELECT id, manifest, execution_mode, status, loader_version, created_at FROM plugins')
      .all() as Array<{
      id: string;
      manifest: string;
      execution_mode: string;
      status: string;
      loader_version: string;
      created_at: number;
    }>;

    return rows.map((row) => {
      let parsed: { name?: string; version?: string } = {};
      try {
        parsed = JSON.parse(row.manifest);
      } catch {
        // 解析失败时使用默认值
      }

      // Prefer live state machine; fall back to DB status when not yet tracked in memory
      let state = this.pluginStates.get(row.id);
      if (!state) {
        if (row.status === 'active') state = PluginState.ACTIVE;
        else if (row.status === 'error') state = PluginState.ERROR;
        else if (row.status === 'disabled' || row.status === 'inactive') state = PluginState.INACTIVE;
        else state = PluginState.INSTALLED;
      }
      const pluginDir = this.getPluginDir(row.id);
      const has_frontend = fs.existsSync(path.join(pluginDir, 'frontend.js'));

      const status =
        state === PluginState.ACTIVE
          ? 'active'
          : state === PluginState.ERROR
            ? 'error'
            : state === PluginState.ACTIVATING
              ? 'activating'
              : 'disabled';

      return {
        id: row.id,
        name: parsed.name ?? row.id,
        version: parsed.version ?? 'unknown',
        state,
        status,
        execution_mode: row.loader_version === 'vm' ? 'legacy' : 'esm',
        manifest: row.manifest,
        created_at: row.created_at,
        has_frontend,
      };
    });
  }

  /**
   * 获取插件的当前状态。
   *
   * 若插件未被追踪，返回 undefined。
   */
  getPluginState(pluginId: string): PluginState | undefined {
    pluginId = this.resolvePluginUuid(pluginId);
    return this.pluginStates.get(pluginId);
  }

  /**
   * V3.0: 查询插件声明的贡献点摘要。
   *
   * 无需激活插件即可枚举。用于管理后台预览插件将添加哪些 UI 元素。
   * 若未指定 pluginId，返回所有插件的贡献摘要。
   *
   * ## 关于参数形态（H-2）
   *
   * 本方法的两种输入形态（DB UUID 与 manifest.id）**都必须支持**，因为调用方
   * 天然会有两种：HTTP 层拿到的多为 DB 主键，而依赖解析、命令行等内部路径
   * 手上只有 manifest.id。
   *
   * 之所以要显式做双向映射：`contributionRegistry` 的两级索引是以
   * **`manifest.id`** 为键的（见 `register()` 的 `@param pluginId`，以及
   * contribution-registry.ts 的两级 Map），而 `getByPlugin()` 是纯
   * `Map.get()`，**不做任何反向解析**。因此原实现两条路都错：
   *
   *   · 只传原样输入 → 传 UUID 时落空
   *   · 只传 `resolvePluginUuid()` 的结果 → 把 manifest.id 主动改成了 UUID，落空
   *
   * 后者尤其隐蔽：**唯一语义正确的输入反而被改成了查不到的形式**。
   * 而全仓唯一调用点（canary.step5）断言的是「卸载后为 0」，
   * 无论命中空集合还是查错键落空，结果都是 0 —— 该缺陷因此长期未被察觉。
   *
   * 这里对所有候选键取并集（而非「先试原样、落空再回退」）：不依赖查询顺序，
   * 也不在两个键恰好都注册过时产生歧义。并集按 slot 去重，
   * 语义稳定为「该插件的全部贡献」。
   */
  listContributions(
    pluginId?: string,
  ): ContributionSummary[] | Array<{ pluginId: string; contributions: ContributionSummary[] }> {
    if (pluginId) {
      // registry 的键是 manifest.id，入参可能是 UUID 或 manifest.id，两种都要覆盖
      const candidates = new Set<string>([pluginId]);

      const uuid = this.resolvePluginUuid(pluginId);
      if (uuid) candidates.add(uuid);

      // UUID → manifest.id 的反向解析：resolvePluginUuid 是单向的，缺这一步 UUID 入参永远查不到
      const manifestId = this.resolveManifestId(pluginId);
      if (manifestId) candidates.add(manifestId);

      const merged = new Map<string, ContributionSummary>();
      for (const key of candidates) {
        for (const summary of this.contributionRegistry.summary(key)) {
          // 按 slot 去重（候选集本身已去重，故不会重复计数）
          if (!merged.has(summary.slot)) merged.set(summary.slot, summary);
        }
      }
      return [...merged.values()];
    }
    return this.contributionRegistry.allSummaries();
  }

  /**
   * 返回所有已安装插件的 manifest.id 列表。
   * V3.0: 用于插件依赖解析。
   */
  listInstalledPluginIds(): string[] {
    const rows = this.db.prepare('SELECT manifest FROM plugins').all() as Array<{ manifest: string }>;
    return rows
      .map((row) => {
        try {
          const m = JSON.parse(row.manifest);
          return m.id as string;
        } catch {
          return '';
        }
      })
      .filter(Boolean);
  }

  /**
   * V3.1: 读取插件的配置值（供 REST API 使用）。
   * 创建临时 ConfigService 实例加载 schema + DB 值，不保持内存引用。
   */
  getPluginConfig(pluginId: string, manifest?: Record<string, any>): Record<string, unknown> {
    let m = manifest;
    if (!m) {
      const row = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(pluginId) as
        { manifest: string } | undefined;
      if (!row) return {};
      m = JSON.parse(row.manifest);
    }
    const svc = new ConfigService(this.db, m as any);
    svc.loadFromDB();
    return svc.getAll();
  }

  /**
   * V3.1: 更新插件的配置值（供 REST API 使用）。
   * 逐个调用 set()，schema 校验由 ConfigService 内部完成。
   */
  setPluginConfig(pluginId: string, manifest: Record<string, any>, updates: Record<string, unknown>): void {
    const svc = new ConfigService(this.db, manifest as any);
    svc.loadFromDB();
    for (const [key, value] of Object.entries(updates)) {
      svc.setSync(key, value);
    }
  }

  // ── 私有辅助方法 ────────────────────────────────────────────────────────

  /**
   * 将插件的标识符（可以是数据库 UUID 也可以是 manifest.id 别名）解析为数据库真实 UUID。
   * 优先直接匹配 DB 主键（O(1)），其次通过 SQLite json_extract 直接查询 manifest.id 列（O(1) 索引友好）。
   */
  /** @public 将插件标识符（DB UUID 或 manifest.id 别名）解析为数据库真实 UUID。供外部命令处理器使用。 */
  resolvePluginUuid(idOrManifestId: string): string {
    try {
      // 1. 优先：直接作为 DB 主键查找（最常见路径）
      const byId = this.db.prepare('SELECT id FROM plugins WHERE id = ?').get(idOrManifestId) as
        { id: string } | undefined;
      if (byId) return byId.id;

      // 2. 回退：通过 SQLite json_extract 匹配 manifest.id 别名（无需全表 JSON 解析）
      const byManifestId = this.db
        .prepare("SELECT id FROM plugins WHERE json_extract(manifest, '$.id') = ?")
        .get(idOrManifestId) as { id: string } | undefined;
      if (byManifestId) return byManifestId.id;
    } catch {}

    // 3. 原样返回，让调用方自行处理"找不到"
    return idOrManifestId;
  }

  /**
   * `resolvePluginUuid()` 的**反向**：把 DB 主键（或已是 manifest.id 的入参）解析为 manifest.id。
   *
   * ## 为什么需要它
   *
   * 宿主内部存在两套「插件标识符」命名空间，而两个方向的解析此前**只存在一个**：
   *
   * | 命名空间 | 典型值 | 谁在用 |
   * |---|---|---|
   * | DB 主键（UUID） | `11111111-…` | HTTP 路由参数、DB 行 |
   * | manifest.id（别名） | `ext-canary` | `contributionRegistry` 的索引键、依赖解析 |
   *
   * `resolvePluginUuid()` 只做了「别名 → UUID」。而 `contributionRegistry` 的键
   * 是 **manifest.id**，其 `getByPlugin()` 又是纯 `Map.get()`、不接受 UUID。
   * 于是「查 registry」必须有「UUID → 别名」这一步，此前**不存在** —— 这就是 H-2：
   * `listContributions()` 无论收到哪种输入都返回空。
   *
   * @param idOrManifestId - DB 主键或 manifest.id
   * @returns manifest.id；查不到时返回空串（调用方据此跳过，不污染候选键集合）
   */
  resolveManifestId(idOrManifestId: string): string {
    try {
      // 1. 优先按主键查（O(1)，最常见路径）
      const byId = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(idOrManifestId) as
        { manifest: string } | undefined;
      const fromPrimary = this.extractManifestId(byId?.manifest);
      if (fromPrimary) return fromPrimary;

      // 2. 回退：入参本身就是 manifest.id 别名
      const byAlias = this.db
        .prepare("SELECT manifest FROM plugins WHERE json_extract(manifest, '$.id') = ?")
        .get(idOrManifestId) as { manifest: string } | undefined;
      const fromAliasId = this.extractManifestId(byAlias?.manifest);
      if (fromAliasId) return fromAliasId;
    } catch {
      // 表不存在 / SQL 不可用 —— 一律按「查不到」处理，不向上抛
    }
    return '';
  }

  /** 从 plugins.manifest 的 JSON 文本里取 `id` 字段；缺失或非法 JSON 返回空串 */
  private extractManifestId(manifestJson: string | undefined): string {
    if (!manifestJson) return '';
    try {
      const id = (JSON.parse(manifestJson) as { id?: unknown }).id;
      return typeof id === 'string' ? id : '';
    } catch {
      return '';
    }
  }

  /**
   * 检查 manifest id 唯一性，防止重复注册。
   *
   * 直接迁移自 PluginRuntime lines 192-203，将 this.kernel.db 替换为 this.db。
   *
   * @param manifestId - 要检查的 manifest.id
   * @throws Error 如果 manifest id 已存在
   */
  private ensureUniqueManifestId(manifestId: string): void {
    const existing = this.db.prepare('SELECT id, manifest FROM plugins').all() as Array<{
      id: string;
      manifest: string;
    }>;
    for (const plugin of existing) {
      try {
        const manifest = JSON.parse(plugin.manifest);
        if (manifest.id === manifestId) {
          throw new Error(`Plugin manifest id "${manifestId}" is already installed.`);
        }
      } catch (err: any) {
        if (err.message?.includes('already installed')) throw err;
      }
    }
  }

  /**
   * 从插件源代码中微加载提取 manifest。
   *
   * 用于 installPlugin 在 DB 插入前获取 manifest.id 进行唯一性检查。
   * 使用 EsmLoader.load() 加载源码，从模块导出中提取 manifest。
   *
   * @param sourceCode - 插件源代码
   * @returns 解析出的 manifest
   */
  private async extractManifest(sourceCode: string): Promise<Manifest> {
    const mod = await this.esmLoader.load(sourceCode);
    const plugin = mod.default ?? mod;
    const rawManifest = plugin.manifest ?? (mod as any).manifest;

    if (!rawManifest) {
      throw new Error('[PluginHost] Plugin source code has no manifest export');
    }

    // 内联安装补全默认值：main 字段在 ZIP 安装时必需，内联安装默认 index.js
    const withDefaults = {
      main: 'index.js',
      ...rawManifest,
    };

    return manifestSchema.parse(withDefaults);
  }

  // ── 生命周期方法 ────────────────────────────────────────────────────────

  /**
   * 安装插件到数据库。
   *
   * 方法 1: installPlugin(sourceCode: string): Promise<Manifest>
   *
   * 从 PluginRuntime lines 45-59 迁移，适配 PluginHost 架构：
   * - 先通过 EsmLoader 微加载提取 manifest
   * - 调用 ensureUniqueManifestId 检查唯一性
   * - 生成 uuidv7() 作为 pluginId
   * - INSERT 到 DB（loader_version = 'esm', status = 'installed'）
   * - 设置状态为 INSTALLED
   * - 失败时回滚 DB 条目和状态
   *
   * @param sourceCode - 插件源代码字符串
   * @returns 解析后的 manifest
   */
  async installPlugin(sourceCode: string): Promise<Manifest> {
    // 1. 微加载提取 manifest（用于唯一性检查和 name 字段）
    const rawManifest = await this.extractManifest(sourceCode);

    // 1a. 内联安装补充默认 main（manifest Schema 要求 main 字段）
    const manifest: Manifest = {
      ...rawManifest,
      main: rawManifest.main ?? 'index.js',
    };

    // 2. 唯一性检查
    this.ensureUniqueManifestId(manifest.id);

    // 2a. Phase 6: install-time SemVer pre-check
    this.checkSemVerCompatibility(manifest, '(pending)', 'install');
    // Return value discarded: no buildContext at install time

    // 2b. engines.openlearn 平台版本兼容性检查
    if (manifest.engines?.openlearn) {
      if (!semver.satisfies(OPENLEARN_VERSION, manifest.engines.openlearn)) {
        throw new Error(
          `[PluginHost] Plugin "${manifest.id}" requires OpenLearn ${manifest.engines.openlearn}, ` +
            `but host is running ${OPENLEARN_VERSION}.`,
        );
      }
    }

    // 2c. V3.0: 注册声明式贡献点（classroomTools → contributes 自动桥接）
    if (manifest.contributes) {
      this.contributionRegistry.register(manifest.id, manifest.contributes);
    } else if (manifest.classroomTools && manifest.classroomTools.length > 0) {
      this.contributionRegistry.registerClassroomTools(manifest.id, manifest.classroomTools as ClassroomToolConfig[]);
    }

    // 2d. V3.0: 检查插件依赖是否已安装（仅警告，不阻止安装）
    if (manifest.pluginDependencies && manifest.pluginDependencies.length > 0) {
      const installedIds = new Set(this.listInstalledPluginIds());
      const missing = checkMissingDeps(manifest.pluginDependencies, installedIds);
      if (missing.length > 0) {
        console.warn(
          `[PluginHost] Plugin "${manifest.id}" depends on: ${missing.join(', ')}, ` +
            `which are not installed. The plugin will fail to activate until dependencies are satisfied.`,
        );
      }
    }

    // 2e. V3.2: 检查跨插件服务依赖（warn，不阻塞安装）
    const serviceCheck = this.checkCrossPluginServices(manifest);
    if (serviceCheck) {
      for (const u of serviceCheck.unsatisfied) {
        console.warn(
          `[PluginHost] Plugin "${manifest.id}" requires service "${u.required}" from "${u.providerId}", ` +
            `but the provider has not declared it in manifest.provides. The plugin will fail to activate.`,
        );
      }
    }
    // 3. 生成 pluginId
    const pluginId = uuidv7();
    const pluginDir = this.getPluginDir(pluginId);
    const filePath = this.getPluginFilePath(pluginId);
    const manifestPath = this.getPluginManifestPath(pluginId);

    try {
      // 4a. 词法静态门（A-1 / C-1 / C-6）
      //
      // 放在 bundlePlugin() **之前**，这样拒绝理由是明确的 PluginSecurity 错误，
      // 而不是在 esbuild 报错里看到 `openlearn-token-enforcer`（那是 ZIP 路径的消息）。
      // 两层门职责不同：词法门拦计算式 import / eval / 动态 require，
      // esbuild enforcer 拦裸 specifier 与绝对路径。
      const { assertPluginCodeSafe } = await import('../esm-loader/install-utils.js');
      assertPluginCodeSafe(sourceCode);

      // 4b. esbuild token enforcer + 绝对路径拦截
      //
      // 此前本方法把 `sourceCode` **原样落盘**，完全不经过 bundlePlugin() 与
      // openlearn-token-enforcer —— 于是 `plugin.install`（源码安装）路径的静态防线
      // 等于不存在，而 `plugin.install_zip` 路径却有一整套。两条安装路径强度严重不对称：
      // 经审批的管理员用前者装插件，可直接 `import fs from 'node:fs'`。
      //
      // 现在两条路径共用同一组门。bundlePlugin 在此**只做校验、不落盘其产物**：
      // inline 安装传入的是单文件源码字符串，本就不存在相对导入需要内联
      // （多文件场景走 installPluginFromZip，那里落盘的才是 bundle）。
      // 因此落盘的仍是原始 sourceCode —— 既拿到与 ZIP 路径一致的防线强度，
      // 又不改变 activatePlugin 的读盘与 loader 既有契约。
      const { bundlePlugin } = await import('../esm-loader/install-utils.js');
      await bundlePlugin(sourceCode, pluginDir); // 抛错即拒绝安装

      // 5. 写入文件系统
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(filePath, sourceCode, 'utf-8');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      // 6. INSERT 到 DB（source_code 留空，源码已迁移到文件系统）
      // version 列是 H-3 新增的**加速索引**（真源仍是 manifest JSON），
      // 漏写不会造成功能回归，但会让版本筛选查不到该行 —— 故此处同步写入。
      const stmt = this.db.prepare(
        'INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      stmt.run(
        pluginId,
        manifest.name,
        JSON.stringify(manifest),
        '',
        filePath,
        'installed',
        Date.now(),
        'esm',
        manifest.version,
      );

      // 7. 设置状态为 INSTALLED（上方 INSERT 已写入 status='installed'，此处只同步内存）
      this.setPluginState(pluginId, PluginState.INSTALLED);

      console.log(`[PluginHost] Plugin "${manifest.id}" installed to ${filePath} (${pluginId})`);
      return manifest;
    } catch (err) {
      // 回滚：删除 DB 条目 + 清理文件系统 + 状态
      try {
        this.db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
      } catch {
        // 静默清理
      }
      try {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      } catch {
        // 静默清理
      }
      this.pluginStates.delete(pluginId);
      throw err;
    }
  }

  /**
   * 激活插件。
   *
   * 方法 2: activatePlugin(pluginId: string): Promise<void>
   *
   * D-10, D-11, D-12：完整激活流程，含超时保护和失败回滚。
   *
   * 遵循 RESEARCH.md lines 446-514 的精确数据流：
   * 1. 验证状态转换 INSTALLED/INACTIVE/ERROR → ACTIVATING
   * 2. 设置状态为 ACTIVATING
   * 3. 从 DB 加载插件源码
   * 4. EsmLoader.load() 获取模块导出
   * 5. 提取 manifest、activate（支持 default export 和具名导出）
   * 6. manifestSchema.parse() 校验 schema
   * 7. buildContext() 构建 PluginContext
   * 8. capabilityService.grant() 授予能力
   * 9. Promise.race([activate(ctx), timeout]) 5 秒超时
   * 10. 成功：状态 → ACTIVE，存储实例，DB UPDATE
   * 11. 失败（D-12）：状态 → ERROR，disposeAll 回滚，revokeAll 撤销能力，重新抛出错误
   *
   * @param pluginId - 插件标识符
   * @throws PluginActivateError / EsmActivationError / IllegalStateTransitionError
   */
  async activatePlugin(pluginId: string, options?: { mode?: 'inline' | 'worker' }): Promise<void> {
    pluginId = this.resolvePluginUuid(pluginId);

    // Join in-flight activation instead of throwing activating → activating
    const inflight = this.inflightActivate.get(pluginId);
    if (inflight) return inflight;

    const task = this.activatePluginExclusive(pluginId, options);
    this.inflightActivate.set(pluginId, task);
    try {
      await task;
    } finally {
      if (this.inflightActivate.get(pluginId) === task) {
        this.inflightActivate.delete(pluginId);
      }
    }
  }

  private async activatePluginExclusive(pluginId: string, options?: { mode?: 'inline' | 'worker' }): Promise<void> {
    // 进入新的生命周期：清除 ResourceTracker 的「已关闭」标记（审计 H-3）。
    //
    // 必须在此处（而非仅首次安装）调用 —— 上一次 activate 若因 5s 超时被 disposeAll，
    // 该标记会保留；若不重置，本次 activate 注册的所有资源都会被立即 dispose，
    // 插件将永远无法正常启动。
    this.resourceTracker.reopen(pluginId);

    // Recover orphaned transient state left by a crashed/aborted previous attempt
    if (this.pluginStates.get(pluginId) === PluginState.ACTIVATING) {
      console.warn(`[PluginHost] Recovering stuck ACTIVATING state for "${pluginId}" → ERROR before retry`);
      this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
    }

    // Phase 5: Dual-mode activation — check if worker mode is requested
    const mode = options?.mode ?? this.getExecutionMode(pluginId) ?? 'inline';
    if (mode === 'worker') {
      return this.activateWorker(pluginId);
    }

    // 1. 获取当前状态并验证转换
    const currentState = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;
    this.validateTransition(pluginId, currentState, PluginState.ACTIVATING);

    // 2. 设置状态为 ACTIVATING
    this.setPluginState(pluginId, PluginState.ACTIVATING);

    // Phase 8: Check if this is a preloaded inline plugin
    const preloaded = this.preloadedPlugins.get(pluginId);
    if (preloaded) {
      const manifest = preloaded.manifest;
      const activate = preloaded.activate;
      const deactivate = preloaded.deactivate;
      const actorId = `plugin:${manifest.id}`;

      try {
        manifestSchema.parse(manifest);

        // V3.0: 检查插件依赖是否满足（缺失 → ERROR）
        const depCheck = this.checkPluginDependencies(manifest);
        if (depCheck) {
          throw new PluginActivateError(pluginId, depCheck);
        }

        // V3.2: 检查跨插件服务依赖（阻塞激活）
        const serviceCheck = this.checkCrossPluginServices(manifest);
        if (serviceCheck) {
          const items = serviceCheck.unsatisfied.map((u) => `"${u.required}" from ${u.providerId}`).join(', ');
          throw new PluginActivateError(
            pluginId,
            `Plugin "${manifest.id}" requires cross-plugin services: ${items} (not provided)`,
          );
        }
        const skipTokens = this.checkSemVerCompatibility(manifest, pluginId, 'activate');
        // B-5：在构建上下文**之前**声明进程归属，否则本插件 spawn 的任务会被
        // 记到上一个声明者名下（归属列/内存 Map 都是同步写入，见 setPluginOwner 注释）。
        await this.declareProcessOwnership(pluginId);
        const ctx = await buildContext(
          this.serviceRegistry,
          this.resourceTracker,
          pluginId,
          manifest,
          this.db,
          skipTokens,
          this.contributionRegistry,
        );

        const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
        const caps = manifest.capabilitiesProposed ?? [];
        for (const cap of caps) {
          await capService.grant(actorId, cap);
        }

        const middlewareCtx: MiddlewareContext = {
          pluginId,
          manifest,
          phase: 'beforeActivate',
          timestamp: Date.now(),
        };

        const before = this.getMiddleware('beforeActivate');
        const after = this.getMiddleware('afterActivate');

        const activatePipeline = compose([
          ...before,
          async (_ctx, next) => {
            await next(); // 执行实际激活
            const afterCtx: MiddlewareContext = { ...middlewareCtx, phase: 'afterActivate' };
            const afterPipeline = compose(after);
            await afterPipeline(afterCtx, async () => {});
          },
        ]);

        await activatePipeline(middlewareCtx, async () => {
          // 激活带 5 秒超时
          await Promise.race([
            activate(ctx),
            new Promise<never>((_, reject) =>
              setTimeout(() => {
                reject(new EsmLoadTimeoutError(ACTIVATION_TIMEOUT_MS));
              }, ACTIVATION_TIMEOUT_MS),
            ),
          ]);
        });

        this.pluginInstances.set(pluginId, { manifest, activate, deactivate, context: ctx });
        this.setPluginState(pluginId, PluginState.ACTIVE, { persistDb: true });
      } catch (err: any) {
        console.error('[PluginHost] Preloaded plugin activation error stack:', err.stack);
        this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
        this.resourceTracker.disposeAll(pluginId);
        try {
          const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
          await capService.revokeAll(actorId);
        } catch {
          // ignore
        }
        throw new EsmActivationError(pluginId, err.message);
      }
      return;
    }

    // 3. 从 DB 加载插件
    const row = this.db.prepare('SELECT file_path, source_code, manifest FROM plugins WHERE id = ?').get(pluginId) as
      { file_path?: string; source_code: string; manifest: string } | undefined;
    if (!row) {
      this.setPluginState(pluginId, currentState);
      throw new PluginActivateError(pluginId, 'plugin not found in database');
    }

    // 解析已存储的 manifest（用于 actorId 和能力撤销）
    let storedManifest: Manifest;
    try {
      storedManifest = JSON.parse(row.manifest);
    } catch {
      this.setPluginState(pluginId, currentState);
      throw new PluginActivateError(pluginId, 'invalid manifest JSON in database');
    }

    const actorId = `plugin:${storedManifest.id}`;

    try {
      // 4. 加载源码 — 优先从文件系统 file:// URL 导入（使 Node.js 能解析 @openlearn/* 等裸模块），
      //    fallback 到 DB source_code 的 data: URL 加载（向后兼容旧格式插件）
      let mod: PluginModule;
      if (process.env.NODE_ENV !== 'test' && row.file_path && fs.existsSync(row.file_path)) {
        // 使用 file:// URL 直接导入，Node.js 会基于文件所在目录解析裸模块 specifier
        // 附加 ?t= 查询参数绕过 ESM 缓存，确保重新激活时加载最新代码
        // 宿主以 external 方式提供 SDK，先确保插件目录能解析到它
        this.ensureHostSdkResolution();
        const fileUrl = pathToFileURL(row.file_path);
        mod = await import(`${fileUrl.href}?t=${Date.now()}`);
      } else {
        let sourceCode: string = '';
        if (row.file_path && fs.existsSync(row.file_path)) {
          sourceCode = fs.readFileSync(row.file_path, 'utf-8');
        } else if (row.source_code) {
          sourceCode = row.source_code;
        } else {
          throw new PluginActivateError(pluginId, 'no source code available (file_path or source_code required)');
        }
        mod = await this.esmLoader.load(sourceCode);
      }

      // 5. 提取 manifest 和 activate（支持两种导出格式）
      const plugin = mod.default ?? mod;
      const manifest = plugin.manifest ?? (mod as any).manifest;
      const activate = plugin.activate ?? (mod as any).activate;
      const deactivate = plugin.deactivate ?? (mod as any).deactivate;

      if (!manifest || !activate) {
        throw new EsmActivationError(pluginId, 'missing manifest or activate function');
      }

      if (typeof activate !== 'function') {
        throw new EsmActivationError(pluginId, 'activate must be a function');
      }

      // Merge stored package manifest (from DB) with code-level manifest to ensure all required fields (e.g. main, requires) are present
      const mergedManifest = {
        ...storedManifest,
        ...manifest,
      };

      // 6. 校验 manifest schema
      manifestSchema.parse(mergedManifest);

      // V3.0: 检查插件依赖是否满足（缺失 → ERROR）
      const depCheck = this.checkPluginDependencies(mergedManifest);
      if (depCheck) {
        this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
        throw new PluginActivateError(pluginId, depCheck);
      }

      // 6a. Phase 6: Token version compatibility check (D-05, D-12)

      // V3.2: 检查跨插件服务依赖（阻塞激活）
      const serviceCheck = this.checkCrossPluginServices(mergedManifest);
      if (serviceCheck) {
        const items = serviceCheck.unsatisfied.map((u) => `"${u.required}" from ${u.providerId}`).join(', ');
        throw new PluginActivateError(
          pluginId,
          `Plugin "${mergedManifest.id}" requires cross-plugin services: ${items} (not provided)`,
        );
      }
      const skipTokens = this.checkSemVerCompatibility(mergedManifest, pluginId, 'activate');

      // 7. 构建安全的 PluginContext — skipTokens 中指定的可选服务 key 将被设为 null（D-12）
      const ctx = await buildContext(
        this.serviceRegistry,
        this.resourceTracker,
        pluginId,
        mergedManifest,
        this.db,
        skipTokens, // NEW: Phase 6 — incompatible optional token names
        this.contributionRegistry,
      );

      // 8. 授予能力（T-04-19: 仅授予 manifest.capabilitiesProposed 中声明的能力）
      try {
        const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
        const caps = mergedManifest.capabilitiesProposed ?? [];
        for (const cap of caps) {
          await capService.grant(actorId, cap);
        }
      } catch (capErr) {
        console.error(`[PluginHost] Failed to grant capabilities for "${pluginId}":`, capErr);
        throw capErr;
      }

      // 9. Phase 7: 中间件管道包裹激活（洋葱模型: beforeActivate → activate → afterActivate）
      const middlewareCtx: MiddlewareContext = {
        pluginId,
        manifest: mergedManifest,
        phase: 'beforeActivate',
        timestamp: Date.now(),
      };
      const before = this.getMiddleware('beforeActivate');
      const after = this.getMiddleware('afterActivate');

      const activatePipeline = compose([
        ...before,
        async (_ctx, next) => {
          await next(); // 执行实际激活
          // 激活成功后执行 afterActivate 中间件
          const afterCtx: MiddlewareContext = { ...middlewareCtx, phase: 'afterActivate' };
          const afterPipeline = compose(after);
          await afterPipeline(afterCtx, async () => {});
        },
      ]);

      await activatePipeline(middlewareCtx, async () => {
        // 10. 激活带 5 秒超时（D-11, T-04-17）
        await Promise.race([
          activate(ctx),
          new Promise<never>((_, reject) =>
            setTimeout(() => {
              reject(new EsmLoadTimeoutError(ACTIVATION_TIMEOUT_MS));
            }, ACTIVATION_TIMEOUT_MS),
          ),
        ]);

        // 11. 成功
        this.pluginInstances.set(pluginId, {
          manifest: mergedManifest,
          activate,
          deactivate: typeof deactivate === 'function' ? deactivate : undefined,
          context: ctx,
        });
        this.setPluginState(pluginId, PluginState.ACTIVE, { persistDb: true });

        // 热重载接线：注册到 FileWatcher
        if (this._hotReloadController) {
          const filePath = this.getPluginFilePath(pluginId);
          if (fs.existsSync(filePath)) {
            this._hotReloadController.registerPlugin(pluginId, filePath);
            console.log(`[PluginHost] Hot reload registered for "${pluginId}"`);
          }
        }

        console.log(`[PluginHost] Plugin "${mergedManifest.id}" activated (${pluginId})`);
      });
    } catch (err) {
      // 11. D-12: 失败回滚
      this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
      this.resourceTracker.disposeAll(pluginId);
      this.pluginInstances.delete(pluginId);

      // 撤销能力（T-04-19: 即使激活失败也撤销）
      try {
        const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
        await capService.revokeAll(actorId);
      } catch {
        // revokeAll 静默失败
      }

      console.error(`[PluginHost] Plugin "${pluginId}" activate failed:`, err);
      throw err;
    }
  }

  // ── Phase 5: Worker-mode activation ─────────────────────────────────────

  /**
   * Worker 模式激活插件。
   *
   * 通过 WorkerManager.createWorker() 创建一个隔离的 Worker 线程，
   * 在 Worker 中加载并激活插件。激活失败时回滚状态。
   */
  private async activateWorker(pluginId: string): Promise<void> {
    const currentState = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;
    this.validateTransition(pluginId, currentState, PluginState.ACTIVATING);
    this.setPluginState(pluginId, PluginState.ACTIVATING);

    const row = this.db.prepare('SELECT file_path, source_code, manifest FROM plugins WHERE id = ?').get(pluginId) as
      { file_path?: string; source_code: string; manifest: string } | undefined;
    if (!row) {
      this.setPluginState(pluginId, currentState);
      throw new PluginActivateError(pluginId, 'plugin not found in database');
    }

    // 读取源码 — 优先文件系统，fallback DB
    const sourceCode: string =
      row.file_path && fs.existsSync(row.file_path) ? fs.readFileSync(row.file_path, 'utf-8') : row.source_code;

    const manifest: Manifest = JSON.parse(row.manifest);
    const actorId = `plugin:${manifest.id}`;

    try {
      // Grant capabilities (same as inline mode activation)
      const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
      const caps = manifest.capabilitiesProposed ?? [];
      for (const cap of caps) {
        await capService.grant(actorId, cap);
      }

      // Resolve EventBus for event forwarding to Worker
      const eventBus = (await this.serviceRegistry.resolve<IEventBusService>(
        IEventBusServiceToken,
      )) as unknown as import('../event-bus/index.js').EventBus;

      const { transport, serviceHost } = await this.workerManager.createWorker(
        pluginId,
        manifest,
        sourceCode,
        (await import('../worker-runtime/worker-manager.js')).ALL_SERVICE_TOKENS,
        eventBus,
        this.getPluginDir(pluginId),
      );

      this.pluginInstances.set(pluginId, {
        manifest,
        activate: undefined,
        deactivate: undefined,
        workerRef: { transport, serviceHost },
      });
      this.setPluginState(pluginId, PluginState.ACTIVE, { persistDb: true });
      console.log(`[PluginHost] Plugin "${manifest.id}" activated in WORKER mode (${pluginId})`);
    } catch (err) {
      this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
      this.resourceTracker.disposeAll(pluginId);
      this.pluginInstances.delete(pluginId);
      try {
        const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
        await capService.revokeAll(actorId);
      } catch {
        // revokeAll 静默失败
      }
      throw err;
    }
  }

  /**
   * 停用插件。
   * 停用插件。
   *
   * 方法 3: deactivatePlugin(pluginId: string): Promise<void>
   *
   * D-09, D-11：带超时保护的停用流程，无论成功或失败均强制清理资源。
   *
   * 遵循 RESEARCH.md lines 522-548 的精确数据流：
   * 1. 如果 UNINSTALLED 或未找到，静默返回
   * 2. 验证状态转换 ACTIVE → DEACTIVATING
   * 3. 设置状态为 DEACTIVATING
   * 4. 获取 plugin 实例
   * 5. 如果有 deactivate 函数：Promise.race([deactivate(), timeout])
   * 6. finally 块（D-09）：无论成功/超时/错误 — 始终执行：
   *    - resourceTracker.disposeAll(pluginId)
   *    - 状态 → INACTIVE
   *    - DB UPDATE status='inactive'
   *    - capabilityService.revokeAll 撤销能力
   *
   * @param pluginId - 插件标识符
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    pluginId = this.resolvePluginUuid(pluginId);

    const inflight = this.inflightDeactivate.get(pluginId);
    if (inflight) return inflight;

    const task = this.deactivatePluginExclusive(pluginId);
    this.inflightDeactivate.set(pluginId, task);
    try {
      await task;
    } finally {
      if (this.inflightDeactivate.get(pluginId) === task) {
        this.inflightDeactivate.delete(pluginId);
      }
    }
  }

  /**
   * 等待指定插件当前在飞的生命周期操作（activate / deactivate）结束（审计 H-2）。
   *
   * 只等待、不改变状态。用于 reloadPlugin 这类**不参与 inflight 合并**的入口，
   * 使其与其它入口串行，避免双方各自 `disposeAll` 互相踩踏。
   *
   * 有界等待：单个操作本身已有 5s 超时保护，故这里不会无限挂起；
   * 仍加超时兜底，防止将来新增的入口引入无界 promise 时把 reload 拖死。
   */
  private async waitForLifecycleIdle(pluginId: string, timeoutMs = 10_000): Promise<void> {
    for (let i = 0; i < 2; i++) {
      const inflight =
        (i === 0 ? this.inflightActivate.get(pluginId) : this.inflightDeactivate.get(pluginId)) ?? undefined;
      if (!inflight) continue;
      await Promise.race([
        inflight.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }
  }

  private async deactivatePluginExclusive(pluginId: string): Promise<void> {
    // Heal orphaned DEACTIVATING
    if (this.pluginStates.get(pluginId) === PluginState.DEACTIVATING) {
      console.warn(`[PluginHost] Recovering stuck DEACTIVATING state for "${pluginId}" → INACTIVE before retry`);
      this.setPluginState(pluginId, PluginState.INACTIVE, { persistDb: true });
      return;
    }

    // ── 1. 停用请求到达时插件仍在 ACTIVATING：等它跑完再停（审计 H-2）──────────
    //
    // 修复前此处直接落到下面的「非 ACTIVE 静默 return」，导致用户的停用意图被丢弃：
    // 用户点「停用」，插件随后仍变成 ACTIVE。
    //
    // 真实危害场景是卸载竞态：`uninstallPlugin` 发现状态是 ACTIVATING（非 ACTIVE）
    // 就跳过停用、直接 DELETE DB 行，而在飞的 activate 随后完成 → **已删除的插件
    // 仍在 commandBus 上留着一批 handler**。
    //
    // 正确做法是**等**：activate 完成后状态变为 ACTIVE，此时再执行正常停用流程。
    // 这样无论 activate 成功还是失败，下面的状态检查都会给出正确处置。
    const pendingActivate = this.inflightActivate.get(pluginId);
    if (pendingActivate && this.pluginStates.get(pluginId) === PluginState.ACTIVATING) {
      try {
        await pendingActivate;
      } catch {
        /* activate 失败 → 状态已是 ERROR/INSTALLED，下面会按状态正确处置 */
      }
    }

    // 2. 获取当前状态 — UNINSTALLED、未找到、或非 ACTIVE 状态时静默返回
    //
    // 注意：此处「非 ACTIVE 静默 return」在修复后只剩两种正当场景 ——
    // 插件本来就没激活（重复停用，幂等），或已卸载。不再有「掩盖竞态」的作用。
    const currentState = this.pluginStates.get(pluginId);
    if (!currentState || currentState === PluginState.UNINSTALLED || currentState !== PluginState.ACTIVE) {
      return;
    }

    // 2. 验证状态转换
    this.validateTransition(pluginId, currentState, PluginState.DEACTIVATING);

    // 3. 设置状态为 DEACTIVATING
    this.setPluginState(pluginId, PluginState.DEACTIVATING);

    // Phase 5: Check if this is a worker-mode plugin
    const mode = this.getExecutionMode(pluginId);
    if (mode === 'worker') {
      return this.deactivateWorker(pluginId);
    }

    // 4. 获取实例
    const instance = this.pluginInstances.get(pluginId);

    // 获取 actorId 用于能力撤销
    let actorId: string | undefined;
    if (instance) {
      actorId = `plugin:${instance.manifest.id}`;
    }

    // Phase 7: 中间件管道包裹停用（洋葱模型: beforeDeactivate → deactivate → afterDeactivate）
    const deactManifest = instance?.manifest ?? { id: pluginId, name: pluginId, version: '0.0.0' };
    const deactMiddlewareCtx: MiddlewareContext = {
      pluginId,
      manifest: deactManifest as Manifest,
      phase: 'beforeDeactivate',
      timestamp: Date.now(),
    };
    const beforeDeact = this.getMiddleware('beforeDeactivate');
    const afterDeact = this.getMiddleware('afterDeactivate');

    const deactivatePipeline = compose([
      ...beforeDeact,
      async (_ctx, next) => {
        await next(); // 执行实际停用
        const afterCtx: MiddlewareContext = { ...deactMiddlewareCtx, phase: 'afterDeactivate' };
        const afterPipeline = compose(afterDeact);
        await afterPipeline(afterCtx, async () => {});
      },
    ]);

    try {
      await deactivatePipeline(deactMiddlewareCtx, async () => {
        try {
          // 5. 如果有 deactivate，带超时调用
          if (instance?.deactivate) {
            try {
              await Promise.race([
                instance.deactivate(),
                new Promise<never>((_, reject) =>
                  setTimeout(() => {
                    reject(new PluginDeactivateTimeoutError(pluginId, DEACTIVATION_TIMEOUT_MS));
                  }, DEACTIVATION_TIMEOUT_MS),
                ),
              ]);
            } catch (deactivateErr) {
              // D-11: deactivate 超时或错误 — 记录警告，不重新抛出
              console.error(
                `[PluginHost] Plugin "${pluginId}" deactivate error (continuing forced cleanup):`,
                deactivateErr,
              );
            }
          }
        } finally {
          // 6. D-09: finally 块 — 无论成功/失败/超时，强制清理 (T-04-18)
          this.resourceTracker.disposeAll(pluginId);
          this.pluginInstances.delete(pluginId);
          this.setPluginState(pluginId, PluginState.INACTIVE, { persistDb: true });

          // 热重载注销
          if (this._hotReloadController) {
            this._hotReloadController.unregisterPlugin(pluginId);
          }

          // 撤销能力（T-04-20: finally 中强制撤销）
          if (actorId) {
            try {
              const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
              await capService.revokeAll(actorId);
            } catch (capErr) {
              console.error(`[PluginHost] Failed to revoke capabilities for "${pluginId}":`, capErr);
            }
          }
        }

        console.log(`[PluginHost] Plugin "${pluginId}" deactivated`);
      });
    } catch (pipelineErr) {
      console.warn(
        `[PluginHost] Onion deactivation pipeline crashed for "${pluginId}", executing safety fallback:`,
        pipelineErr,
      );
      this.resourceTracker.disposeAll(pluginId);
      this.pluginInstances.delete(pluginId);
      this.revokePluginContributions(pluginId); // D-1/D-2：注销声明式贡献
      this.setPluginState(pluginId, PluginState.INACTIVE, { persistDb: true });
      if (actorId) {
        try {
          const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
          await capService.revokeAll(actorId);
        } catch {}
      }
      throw pipelineErr;
    }
  }

  // ── Phase 5: Worker-mode deactivation ───────────────────────────────────

  /**
   * Worker 模式停用插件。
   *
   * 委托给 WorkerManager.terminateWorker()。
   * 无论停用成功或失败，finally 块保证清理状态和 DB 记录。
   */
  private async deactivateWorker(pluginId: string): Promise<void> {
    const currentState = this.pluginStates.get(pluginId);
    if (!currentState || currentState === PluginState.UNINSTALLED) return;
    if (currentState !== PluginState.ACTIVE && currentState !== PluginState.DEACTIVATING) return;

    if (currentState === PluginState.ACTIVE) {
      this.validateTransition(pluginId, currentState, PluginState.DEACTIVATING);
      this.setPluginState(pluginId, PluginState.DEACTIVATING);
    }

    let actorId: string | undefined;
    const instance = this.pluginInstances.get(pluginId);
    if (instance?.manifest?.id) {
      actorId = `plugin:${instance.manifest.id}`;
    }

    try {
      await this.workerManager.terminateWorker(pluginId);
    } catch (termErr) {
      console.error(`[PluginHost] Worker termination error for "${pluginId}":`, termErr);
    } finally {
      // D-09: 与 inline 路径（deactivatePluginExclusive）保持一致 —— 无论成功/失败/超时，
      // 都在 finally 中强制回收资源。此前只有 inline 路径调用 disposeAll，
      // 导致 worker 模式插件停用后命令、事件订阅、定时器、路由永久残留。
      this.resourceTracker.disposeAll(pluginId);
      this.pluginInstances.delete(pluginId);
      this.revokePluginContributions(pluginId); // D-1/D-2：注销声明式贡献
      this.setPluginState(pluginId, PluginState.INACTIVE, { persistDb: true });

      if (actorId) {
        try {
          const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
          await capService.revokeAll(actorId);
        } catch (capErr) {
          console.error(`[PluginHost] Failed to revoke capabilities for "${pluginId}":`, capErr);
        }
      }

      console.log(`[PluginHost] Plugin "${pluginId}" deactivated (worker mode)`);
    }
  }

  /**
   * 切换插件激活/停用状态。
   *
   * @param pluginId - 插件标识符
   * @returns 切换后的状态：'active' 或 'disabled'
   */
  async togglePlugin(pluginId: string): Promise<string> {
    pluginId = this.resolvePluginUuid(pluginId);
    const row = this.db.prepare('SELECT status FROM plugins WHERE id = ?').get(pluginId) as
      { status: string } | undefined;
    if (!row) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    // Wait out any in-flight lifecycle op so we see a stable state
    const pendingActivate = this.inflightActivate.get(pluginId);
    if (pendingActivate) {
      try {
        await pendingActivate;
      } catch {
        /* previous attempt may have failed; continue to toggle based on new state */
      }
    }
    const pendingDeactivate = this.inflightDeactivate.get(pluginId);
    if (pendingDeactivate) {
      try {
        await pendingDeactivate;
      } catch {
        /* ignore */
      }
    }

    let currentState = this.getPluginState(pluginId) ?? PluginState.INSTALLED;

    // Heal stuck transient states (should not linger)
    if (currentState === PluginState.ACTIVATING) {
      console.warn(`[PluginHost] togglePlugin: healing stuck ACTIVATING for "${pluginId}" → ERROR`);
      currentState = PluginState.ERROR;
      this.setPluginState(pluginId, currentState);
    } else if (currentState === PluginState.DEACTIVATING) {
      console.warn(`[PluginHost] togglePlugin: healing stuck DEACTIVATING for "${pluginId}" → INACTIVE`);
      currentState = PluginState.INACTIVE;
      this.setPluginState(pluginId, currentState);
    }

    const newStatus = currentState === PluginState.ACTIVE ? 'disabled' : 'active';

    if (newStatus === 'disabled') {
      await this.deactivatePlugin(pluginId);
    } else {
      await this.activatePlugin(pluginId);
    }

    this.db.prepare('UPDATE plugins SET status = ? WHERE id = ?').run(newStatus, pluginId);
    return newStatus;
  }

  /**
   * 卸载插件。
   *
   * 方法 4: uninstallPlugin(pluginId: string): Promise<void>
   *
   * 流程：
   * 1. 如果 ACTIVE，先调用 deactivatePlugin()
   * 2. 验证状态转换 INACTIVE/ERROR/INSTALLED → UNINSTALLED
   * 3. 从 DB DELETE（plugins + plugin_storage）
   * 4. 清理内存状态
   *
   * @param pluginId - 插件标识符
   */
  async uninstallPlugin(pluginId: string): Promise<void> {
    pluginId = this.resolvePluginUuid(pluginId);
    if (pluginId.startsWith('@openlearn/') || this.preloadedPlugins.has(pluginId)) {
      throw new Error(`Cannot uninstall system plugin: ${pluginId}`);
    }

    // 等待在飞的生命周期操作结束（审计 H-2）。
    //
    // 修复前：下方只判断 `currentState === ACTIVE`，若插件此刻正在 ACTIVATING 就跳过停用、
    // 直接 DELETE DB 行，而在飞的 activate 随后完成 → **已删除的插件仍留在 commandBus 上**，
    // 其 handler 永久泄漏。典型触发：装完插件立刻点卸载。
    await this.waitForLifecycleIdle(pluginId);

    const currentState = this.pluginStates.get(pluginId);

    // 1. 如果当前是 ACTIVE，先停用（deactivatePlugin 自动检测 worker/inline 模式）
    if (currentState === PluginState.ACTIVE) {
      // Phase 5: If worker-mode, ensure Worker is terminated before DB deletion
      const execMode = this.getExecutionMode(pluginId);
      if (execMode === 'worker') {
        await this.deactivateWorker(pluginId);
      } else {
        await this.deactivatePlugin(pluginId);
      }
    }

    // 1b. 兜底资源回收：插件若非 ACTIVE 态（如 ERROR / INACTIVE / INSTALLED），
    // 上面的停用分支不会执行，其命令、事件订阅、定时器与路由可能仍然残留
    // （典型场景：activate 中途失败、reload 失败后直接卸载）。
    // disposeAll 幂等，对已回收过的插件为无操作，故无条件执行。
    this.resourceTracker.disposeAll(pluginId);

    // 2. 获取当前状态（可能已被 deactivatePlugin 修改）
    const state = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;

    // 3. 查询 file_path 和 manifest（DELETE 之前必须获取）
    const row = this.db.prepare('SELECT manifest, file_path FROM plugins WHERE id = ?').get(pluginId) as
      { manifest: string; file_path?: string } | undefined;

    // 幂等：已卸载且 DB 无残留记录时直接返回，避免 uninstalled → uninstalled 非法转换
    if (state === PluginState.UNINSTALLED && !row) {
      this.pluginStates.delete(pluginId);
      return;
    }

    // 验证状态转换（已处于 UNINSTALLED 但仍有残留记录时跳过校验，继续清理）
    if (state !== PluginState.UNINSTALLED) {
      this.validateTransition(pluginId, state, PluginState.UNINSTALLED);
    }
    const manifestId = (() => {
      if (!row) return pluginId;
      try {
        const m = JSON.parse(row.manifest);
        return m.id ?? pluginId;
      } catch {
        return pluginId;
      }
    })();
    const pluginDir = row?.file_path ? this.getPluginDir(pluginId) : null;

    // 4. 从 DB 删除
    this.db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
    this.db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ?').run(manifestId);

    // v5.1: 清理插件自建表
    const tablePrefix = `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, '_')}_`;
    try {
      const tables = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?`)
        .all(tablePrefix + '%') as { name: string }[];
      for (const t of tables) {
        this.db.exec(`DROP TABLE IF EXISTS ${t.name}`);
      }
      if (tables.length > 0) {
        console.log(`[PluginHost] Dropped ${tables.length} plugin tables for "${pluginId}"`);
      }
    } catch (e) {
      console.warn(`[PluginHost] Failed to drop plugin tables for "${pluginId}":`, e);
    }

    // 4b. 撤销插件能力（与 T-04-20 等价的兜底）
    // 非 ACTIVE 态卸载不会走 deactivate 路径，也就不会执行 revokeAll，
    // 会造成已授予能力在内存中残留（权限泄漏）。此处无条件撤销一次。
    try {
      const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
      await capService.revokeAll(`plugin:${manifestId}`);
    } catch (capErr) {
      console.warn(`[PluginHost] Failed to revoke capabilities for "${pluginId}":`, capErr);
    }

    // 4c. Deregister static routes registered by deploy (best-effort cleanup)
    if (this.expressApp && this._registeredRoutes.has(manifestId)) {
      try {
        const route = this._registeredRoutes.get(manifestId);
        const stack = this.expressApp._router?.stack || [];
        for (let i = stack.length - 1; i >= 0; i--) {
          const layer = stack[i];
          if (layer.route === undefined && layer.regexp && new RegExp(layer.regexp).test(route + '/')) {
            stack.splice(i, 1);
            break;
          }
        }
        this._registeredRoutes.delete(manifestId);
        console.log(`[PluginHost] Deregistered static route "${route}" for plugin "${manifestId}"`);
      } catch (routeErr: any) {
        console.warn(`[PluginHost] Failed to deregister static route for "${manifestId}":`, routeErr.message);
      }
    }
    // 5. 清理文件系统
    if (pluginDir && fs.existsSync(pluginDir)) {
      try {
        fs.rmSync(pluginDir, { recursive: true, force: true });
        console.log(`[PluginHost] Removed plugin directory: ${pluginDir}`);
      } catch (e) {
        console.warn(`[PluginHost] Failed to remove plugin directory "${pluginDir}":`, e);
      }
    }

    // 6. 清理内存
    this.setPluginState(pluginId, PluginState.UNINSTALLED);
    this.pluginInstances.delete(pluginId);

    // 6a. V3.0: 清理贡献注册
    this.contributionRegistry.unregister(manifestId);

    console.log(`[PluginHost] Plugin "${pluginId}" uninstalled`);
  }

  /**
   * 从 ZIP Buffer 安装插件。
   *
   * 方法 5: installPluginFromZip(zipBuffer: Buffer): Promise<Manifest>
   *
   * 从 PluginRuntime lines 69-107 迁移，适配 PluginHost 架构：
   * - 调用 validateAndBundleZip() 进行 ZIP 验证和 esbuild 打包
   * - 生成 uuidv7() 作为 id
   * - 唯一性检查
   * - INSERT 到 DB（含 zip_package BLOB, loader_version='esm'）
   * - 设置状态为 INSTALLED
   * - 失败时清理 DB 条目
   *
   * 注意：与 PluginRuntime 不同，PluginHost 不在安装时自动激活 —
   * 调用方需显式调用 activatePlugin()。
   *
   * @param zipBuffer - ZIP 文件的原始字节
   * @returns manifest
   */
  async installPluginFromZip(zipBuffer: Buffer, overrideExecutionMode?: 'worker' | 'inline'): Promise<Manifest> {
    if (!this.esmLoader) {
      throw new Error('Cannot install ZIP plugin: no esmLoader injected');
    }

    // 1. 验证并打包 ZIP
    const { manifest, bundledCode } = await validateAndBundleZip(zipBuffer);
    this.emitProgress(manifest.id, 'validating', 'Plugin validated, writing files...');

    // 2. 唯一性检查
    this.ensureUniqueManifestId(manifest.id);

    // 2a. engines.openlearn 平台版本兼容性检查
    if (manifest.engines?.openlearn) {
      if (!semver.satisfies(OPENLEARN_VERSION, manifest.engines.openlearn)) {
        throw new Error(
          `[PluginHost] Plugin "${manifest.id}" requires OpenLearn ${manifest.engines.openlearn}, ` +
            `but host is running ${OPENLEARN_VERSION}.`,
        );
      }
    }

    // 2b. V3.0: 注册声明式贡献点（classroomTools → contributes 自动桥接）
    if (manifest.contributes) {
      this.contributionRegistry.register(manifest.id, manifest.contributes);
    } else if (manifest.classroomTools && manifest.classroomTools.length > 0) {
      this.contributionRegistry.registerClassroomTools(manifest.id, manifest.classroomTools as ClassroomToolConfig[]);
    }

    // 2c. V3.0: 检查插件依赖（仅警告）
    if (manifest.pluginDependencies && manifest.pluginDependencies.length > 0) {
      const installedIds = new Set(this.listInstalledPluginIds());
      const missing = checkMissingDeps(manifest.pluginDependencies, installedIds);
      if (missing.length > 0) {
        console.warn(
          `[PluginHost] Plugin "${manifest.id}" depends on: ${missing.join(', ')}, ` + `which are not installed.`,
        );
      }
    }

    // 3. 生成 ID
    const pluginId = uuidv7();
    const pluginDir = this.getPluginDir(pluginId);
    const filePath = this.getPluginFilePath(pluginId);
    const manifestPath = this.getPluginManifestPath(pluginId);
    const zipFilePath = path.join(pluginDir, 'package.zip');

    try {
      // 4. 写入文件系统
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(filePath, bundledCode, 'utf-8');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(zipFilePath, zipBuffer);

      // Extract frontend.js and deploy script if present in ZIP
      const zip = await JSZip.loadAsync(zipBuffer);
      const frontendFile = zip.file('frontend.js');
      if (frontendFile) {
        const frontendCode = await frontendFile.async('string');
        fs.writeFileSync(path.join(pluginDir, 'frontend.js'), frontendCode, 'utf-8');
      }
      // Extract deploy script declared in manifest
      if (manifest.deploy?.script) {
        const rawScript = manifest.deploy.script.replace(/\\/g, '/');
        const resolvedScript = path.resolve(pluginDir, rawScript);
        if (rawScript.includes('..') || !resolvedScript.startsWith(pluginDir + path.sep)) {
          throw new Error(`Security Violation: Zip Slip detected in deploy script path "${manifest.deploy.script}"`);
        }
        const deployFile = zip.file(manifest.deploy.script);
        if (deployFile) {
          const deployCode = await deployFile.async('string');
          fs.writeFileSync(resolvedScript, deployCode, 'utf-8');
        }
      }

      this.emitProgress(manifest.id, 'extracting', 'Extracting assets...');
      // Extract storage/ directory if present in ZIP (for static assets bundled with plugin)
      const storageEntries = Object.keys(zip.files).filter(
        (name) => name.startsWith('storage/') && !zip.files[name].dir,
      );
      if (storageEntries.length > 0) {
        console.log(
          `[PluginHost] Extracting ${storageEntries.length} static asset files for plugin "${manifest.id}"...`,
        );
        // SEC-ZIPSLIP: 严密校验所有条目路径，防止通过 .. 实施 Zip Slip 穿越写任意文件
        const dirs = new Set<string>();
        for (const rawName of storageEntries) {
          const normalized = rawName.replace(/\\/g, '/');
          const destPath = path.resolve(pluginDir, normalized);
          if (normalized.includes('..') || !destPath.startsWith(pluginDir + path.sep)) {
            throw new Error(`Security Violation: Zip Slip detected in asset path "${rawName}"`);
          }
          dirs.add(path.dirname(destPath));
        }
        for (const dir of dirs) {
          fs.mkdirSync(dir, { recursive: true });
        }
        // Write files in parallel batches (10 at a time) to balance speed and memory
        const BATCH_SIZE = 10;
        for (let i = 0; i < storageEntries.length; i += BATCH_SIZE) {
          const batch = storageEntries.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(async (name) => {
              const normalized = name.replace(/\\/g, '/');
              const destPath = path.resolve(pluginDir, normalized);
              if (normalized.includes('..') || !destPath.startsWith(pluginDir + path.sep)) {
                throw new Error(`Security Violation: Zip Slip detected in asset path "${name}"`);
              }
              const file = zip.file(name);
              if (file) {
                const content = await file.async('nodebuffer');
                fs.writeFileSync(destPath, content);
              }
            }),
          );
        }
        console.log(`[PluginHost] Static assets extracted for plugin "${manifest.id}"`);
      }

      // 4b. Auto-install declared dependencies if present
      //
      // H-4：**刻意不吞异常**。原实现是 `catch { console.error(...) }` 后继续执行 ——
      // 部署脚本、贡献注册、DB 落库、状态机全都照常跑完，插件最终是 ACTIVE 的，
      // 只是 node_modules 残缺。故障会以「插件运行时 MODULE_NOT_FOUND」的形式
      // 在很久之后、别的上下文里出现。现在依赖装不上就让整个安装事务回滚。
      //
      // 参数拼装与 --ignore-scripts 统一在 dependency-install.ts，两条路径不再可能漂移。
      if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
        console.log(`[PluginHost] Installing dependencies for plugin "${manifest.id}" in ${pluginDir}...`);
        installPluginDependencies(pluginDir, {
          pluginId: manifest.id,
          // dependencies 不在 manifestSchema 里 → 类型 unknown，运行时窄化而非断言
          dependencies: parsePluginDependencies(manifest.dependencies, manifest.id),
          operation: 'install',
        });
        console.log(`[PluginHost] Dependencies successfully installed for plugin "${manifest.id}"`);
      }

      // 4c. Execute deploy script if declared in manifest
      if (manifest.deploy?.script) {
        // SEC-RCE-02: 默认禁止执行外部 deploy 脚本，需显式设置 ALLOW_UNSAFE_PLUGIN_SCRIPTS=true 环境变量
        if (process.env.ALLOW_UNSAFE_PLUGIN_SCRIPTS !== 'true') {
          console.warn(
            `[SECURITY WARNING] Deploy script "${manifest.deploy.script}" for plugin "${manifest.id}" blocked by default security policy. Set ALLOW_UNSAFE_PLUGIN_SCRIPTS=true to enable.`,
          );
        } else {
          // Try running from plugin dir; fall back to v2_plugins source dir
          let deployScriptPath = path.join(pluginDir, manifest.deploy.script);
          if (!fs.existsSync(deployScriptPath)) {
            const altPath = path.join(process.cwd(), 'v2_plugins', 'scratch-editor-deploy', manifest.deploy.script);
            if (fs.existsSync(altPath)) deployScriptPath = altPath;
          }
          if (fs.existsSync(deployScriptPath)) {
            console.log(`[PluginHost] Running deploy script: node ${deployScriptPath}`);
            try {
              const { execSync } = await import('node:child_process');
              execSync(`node "${deployScriptPath}" "${process.cwd()}"`, { timeout: 120000 });
              console.log(`[PluginHost] Deploy script completed for plugin "${manifest.id}"`);
            } catch (deployErr: any) {
              console.error(`[PluginHost] Deploy script failed for plugin "${manifest.id}":`, deployErr.message);
              throw new Error(`Deploy script "${manifest.deploy.script}" failed: ${deployErr.message}`);
            }
          } else {
            console.warn(
              `[PluginHost] Deploy script "${manifest.deploy.script}" not found for plugin "${manifest.id}"`,
            );
          }
        }
      }
      // 4d. Register static route if declared in manifest
      if (manifest.deploy?.staticRoute && manifest.deploy?.staticDir && this.expressApp) {
        const route = manifest.deploy.staticRoute.trim();
        // SEC-ROUTE-01: 静态路由必须以 '/' 开头且不能包含 '..'
        if (!route.startsWith('/') || route.includes('..')) {
          throw new Error(
            `[PluginHost] Invalid staticRoute "${route}" for plugin "${manifest.id}": must start with "/" and cannot contain ".."`,
          );
        }
        // SEC-ROUTE-02: 禁止注册系统核心保留前缀
        const normalized = PluginHost.normalizeStaticRoute(route);
        const SYSTEM_RESERVED_ROUTES = ['/api', '/socket.io', '/runtime', '/docs', '/admin', '/health'];
        if (
          route === '/' ||
          SYSTEM_RESERVED_ROUTES.some((res) => normalized === res || normalized.startsWith(res + '/'))
        ) {
          throw new Error(
            `[PluginHost] Security Violation: Plugin "${manifest.id}" cannot register reserved system route "${route}"`,
          );
        }
        // SEC-ROUTE-03: 检查已有插件路由冲突
        //
        // 两侧都归一化：`_registeredRoutes` 存的是归一化形式（见下面的 set），
        // 但仍再归一化一次 —— 该 Map 也可能被 setExpressApp 的恢复路径写入，
        // 双保险避免将来某条写入路径存了原始形式就静默失效。
        for (const [ownerId, existingRoute] of this._registeredRoutes.entries()) {
          if (ownerId !== manifest.id && PluginHost.normalizeStaticRoute(existingRoute) === normalized) {
            throw new Error(
              `[PluginHost] Static route conflict: "${route}" (normalized: "${normalized}") ` +
                `is already registered by plugin "${ownerId}" as "${existingRoute}"`,
            );
          }
        }
        const absDir = path.join(pluginDir, manifest.deploy.staticDir);
        if (fs.existsSync(absDir)) {
          this.expressApp.use(route, ...createPluginStaticMiddleware(absDir));
          // 存归一化形式，使后续比较不必依赖调用方记得归一
          this._registeredRoutes.set(manifest.id, normalized);
          console.log(`[PluginHost] Registered static route "${route}" for plugin "${manifest.id}"`);
        } else {
          console.warn(
            `[PluginHost] Static directory "${manifest.deploy.staticDir}" for route "${route}" not found for plugin "${manifest.id}"`,
          );
        }
      }
      this.emitProgress(manifest.id, 'registering', 'Registering routes and saving...');
      // 5. INSERT 到 DB（源码和 ZIP 已迁移到文件系统，DB 仅存元数据）
      // Read executionMode from manifest (default: 'inline'), override if administrator specifies
      const executionMode =
        overrideExecutionMode ?? ((manifest as any).executionMode === 'worker' ? 'worker' : 'inline');
      // version 列说明同 installPlugin（H-3）：加速索引，真源是 manifest JSON
      const stmt = this.db.prepare(
        'INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      stmt.run(
        pluginId,
        manifest.name,
        JSON.stringify(manifest),
        '',
        filePath,
        'installed',
        Date.now(),
        'esm',
        executionMode,
        manifest.version,
      );

      // 6. 设置状态（同上：INSERT 已落 DB，这里只同步内存）
      this.setPluginState(pluginId, PluginState.INSTALLED);

      console.log(`[PluginHost] Plugin "${manifest.id}" installed from ZIP to ${filePath} (${pluginId})`);
      this.emitProgress(manifest.id, 'complete', 'Installation complete');
      return {
        ...manifest,
        pluginId,
      };
    } catch (err) {
      // 失败时清理 DB 条目 + 文件系统
      try {
        this.db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
      } catch {
        // 静默清理
      }
      try {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      } catch {
        // 静默清理
      }
      this.pluginStates.delete(pluginId);
      throw err;
    }
  }

  /**
   * Look up an installed plugin by manifest.id (logical id).
   * Returns null when not installed.
   */
  findByManifestId(manifestId: string): {
    pluginId: string;
    manifest: Manifest;
    status: string;
    state: PluginState;
    name: string;
    version: string;
  } | null {
    const row = this.db
      .prepare("SELECT id, name, status, manifest FROM plugins WHERE json_extract(manifest, '$.id') = ?")
      .get(manifestId) as { id: string; name: string; status: string; manifest: string } | undefined;
    if (!row) return null;
    let parsed: Manifest;
    try {
      parsed = JSON.parse(row.manifest) as Manifest;
    } catch {
      return null;
    }
    const state = this.pluginStates.get(row.id) ?? PluginState.INSTALLED;
    return {
      pluginId: row.id,
      manifest: parsed,
      status: row.status,
      state,
      name: parsed.name ?? row.name,
      version: parsed.version ?? '0.0.0',
    };
  }

  private isSystemPluginRecord(pluginId: string, manifestId?: string): boolean {
    if (pluginId.startsWith('@openlearn/') || this.preloadedPlugins.has(pluginId)) return true;
    if (manifestId?.startsWith('@openlearn/')) return true;
    return false;
  }

  /**
   * Replace an already-installed plugin package in place (same DB UUID).
   *
   * - Blocks system plugins (@openlearn/* / preloaded)
   * - Requires matching manifest.id
   * - Version policy: new >= old unless allowDowngrade
   * - Preserves config tables / plugin_migrations / business data
   * - ACTIVE → hot reload (or deactivate+activate if execution mode changes)
   * - inactive → replace files only, keep disabled
   */
  async updatePluginFromZip(
    zipBuffer: Buffer,
    options: {
      targetPluginId?: string;
      executionMode?: 'worker' | 'inline';
      allowDowngrade?: boolean;
    } = {},
  ): Promise<{
    pluginId: string;
    manifest: Manifest;
    oldVersion: string;
    newVersion: string;
    previousStatus: string;
    wasActive: boolean;
  }> {
    if (!this.esmLoader) {
      throw new Error('Cannot update ZIP plugin: no esmLoader injected');
    }

    const { manifest, bundledCode } = await validateAndBundleZip(zipBuffer);
    this.emitProgress(manifest.id, 'validating', 'Plugin validated, preparing update...');

    // Resolve existing install
    let pluginId: string;
    if (options.targetPluginId) {
      pluginId = this.resolvePluginUuid(options.targetPluginId);
      const row = this.db.prepare('SELECT id, manifest, status FROM plugins WHERE id = ?').get(pluginId) as
        { id: string; manifest: string; status: string } | undefined;
      if (!row) {
        throw new Error(`Plugin "${options.targetPluginId}" is not installed`);
      }
      let existingManifest: Manifest;
      try {
        existingManifest = JSON.parse(row.manifest) as Manifest;
      } catch {
        throw new Error(`Plugin "${pluginId}" has a corrupt manifest`);
      }
      if (existingManifest.id !== manifest.id) {
        throw new Error(`Manifest id mismatch: card/target is "${existingManifest.id}", ZIP declares "${manifest.id}"`);
      }
    } else {
      const found = this.findByManifestId(manifest.id);
      if (!found) {
        throw new Error(`Plugin "${manifest.id}" is not installed; use install instead of update`);
      }
      pluginId = found.pluginId;
    }

    if (this.isSystemPluginRecord(pluginId, manifest.id)) {
      throw new Error(`Cannot update system plugin: ${manifest.id}`);
    }

    // version 在 SELECT 里：更新失败回滚时需要拿**旧** version 写回，
    // 否则会留下「索引列比 manifest 新」的不一致（比 NULL 更难排查）。
    const existingRow = this.db
      .prepare('SELECT id, name, status, manifest, execution_mode, version FROM plugins WHERE id = ?')
      .get(pluginId) as {
      id: string;
      name: string;
      status: string;
      manifest: string;
      execution_mode: string;
      version: string | null;
    };

    const oldManifest = JSON.parse(existingRow.manifest) as Manifest;
    const oldVersion = oldManifest.version ?? '0.0.0';
    const newVersion = manifest.version ?? '0.0.0';
    const oldCoerced = semver.coerce(oldVersion)?.version ?? '0.0.0';
    const newCoerced = semver.coerce(newVersion)?.version ?? '0.0.0';
    if (semver.lt(newCoerced, oldCoerced) && !options.allowDowngrade) {
      throw new Error(
        `Refusing downgrade of "${manifest.id}" from v${oldVersion} to v${newVersion}. Pass allowDowngrade to force.`,
      );
    }

    // engines.openlearn check
    if (manifest.engines?.openlearn) {
      if (!semver.satisfies(OPENLEARN_VERSION, manifest.engines.openlearn)) {
        throw new Error(
          `[PluginHost] Plugin "${manifest.id}" requires OpenLearn ${manifest.engines.openlearn}, ` +
            `but host is running ${OPENLEARN_VERSION}.`,
        );
      }
    }

    const previousStatus = existingRow.status;
    const currentState = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;
    const wasActive = currentState === PluginState.ACTIVE ? true : previousStatus === 'active';
    const oldMode = (this.getExecutionMode(pluginId) as 'worker' | 'inline') || 'inline';
    const executionMode =
      options.executionMode ?? ((manifest as any).executionMode === 'worker' ? 'worker' : oldMode || 'inline');

    const pluginDir = this.getPluginDir(pluginId);
    const filePath = this.getPluginFilePath(pluginId);
    const manifestPath = this.getPluginManifestPath(pluginId);
    const zipFilePath = path.join(pluginDir, 'package.zip');

    // Snapshot old files for crude rollback on inactive path failures
    const backupDir = path.join(pluginDir, '.update-backup');
    try {
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      fs.mkdirSync(backupDir, { recursive: true });
      for (const name of ['index.js', 'manifest.json', 'package.zip', 'frontend.js']) {
        const src = path.join(pluginDir, name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(backupDir, name));
      }
    } catch {
      // backup is best-effort
    }

    try {
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(filePath, bundledCode, 'utf-8');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(zipFilePath, zipBuffer);

      const zip = await JSZip.loadAsync(zipBuffer);
      const frontendFile = zip.file('frontend.js');
      const frontendPath = path.join(pluginDir, 'frontend.js');
      if (frontendFile) {
        fs.writeFileSync(frontendPath, await frontendFile.async('string'), 'utf-8');
      } else if (fs.existsSync(frontendPath)) {
        fs.rmSync(frontendPath, { force: true });
      }

      if (manifest.deploy?.script) {
        const deployFile = zip.file(manifest.deploy.script);
        if (deployFile) {
          fs.writeFileSync(path.join(pluginDir, manifest.deploy.script), await deployFile.async('string'), 'utf-8');
        }
      }

      this.emitProgress(manifest.id, 'extracting', 'Extracting assets...');
      const storageDir = path.join(pluginDir, 'storage');
      const storageEntries = Object.keys(zip.files).filter(
        (name) => name.startsWith('storage/') && !zip.files[name].dir,
      );
      if (storageEntries.length > 0) {
        if (fs.existsSync(storageDir)) fs.rmSync(storageDir, { recursive: true, force: true });
        const dirs = new Set<string>();
        for (const name of storageEntries) dirs.add(path.dirname(name));
        for (const dir of dirs) fs.mkdirSync(path.join(pluginDir, dir), { recursive: true });
        const BATCH_SIZE = 10;
        for (let i = 0; i < storageEntries.length; i += BATCH_SIZE) {
          const batch = storageEntries.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(async (name) => {
              const file = zip.file(name);
              if (file) fs.writeFileSync(path.join(pluginDir, name), await file.async('nodebuffer'));
            }),
          );
        }
      }

      // Optional dependency install
      if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
        try {
          // H-4：与安装路径共用同一实现。原先此处**缺 --ignore-scripts**（SEC-RCE-01），
          // 等于「装一次安全、从市场更新一次就能跑 postinstall」—— 而更新是第三方插件
          // 最常见的安装途径。现已由 dependency-install.ts 统一，不可能再漂移。
          installPluginDependencies(pluginDir, {
            pluginId: manifest.id,
            dependencies: parsePluginDependencies(manifest.dependencies, manifest.id),
            operation: 'update',
          });
        } catch (installErr) {
          // 依赖装不上 ⇒ 更新失败 ⇒ 回滚到旧版本并向上传播，让 DB 不落到「新版已装」的假象。
          // 原实现只 console.error 就继续，把新 manifest 写进了 DB。
          console.error(`[PluginHost] Failed to install dependencies during update of "${manifest.id}":`, installErr);
          throw installErr;
        }
      }

      // Contribution registry refresh (manifest.id keyed)
      if (manifest.contributes) {
        this.contributionRegistry.register(manifest.id, manifest.contributes);
      } else if (manifest.classroomTools && manifest.classroomTools.length > 0) {
        this.contributionRegistry.registerClassroomTools(manifest.id, manifest.classroomTools as ClassroomToolConfig[]);
      } else {
        this.contributionRegistry.unregister(manifest.id);
      }

      // Persist metadata — keep UUID; do not touch config/migrations tables
      this.db
        .prepare(
          `UPDATE plugins SET name = ?, manifest = ?, file_path = ?, execution_mode = ?, loader_version = 'esm', updated_at = ?, version = ? WHERE id = ?`,
        )
        .run(
          manifest.name,
          JSON.stringify(manifest),
          filePath,
          executionMode,
          Date.now(),
          // version 是 H-3 的加速索引列：更新 manifest 的同时必须同步，否则版本停留在旧值
          manifest.version,
          pluginId,
        );

      this.emitProgress(manifest.id, 'registering', 'Applying runtime update...');

      if (wasActive) {
        if (oldMode !== executionMode) {
          // Mode switch: full deactivate + activate under new mode
          try {
            if (oldMode === 'worker') await this.deactivateWorker(pluginId);
            else await this.deactivatePlugin(pluginId);
          } catch (e) {
            console.warn(`[PluginHost] deactivate before mode-switch update failed for "${pluginId}":`, e);
          }
          await this.activatePlugin(pluginId);
        } else {
          // Same mode: atomic hot reload
          await this.reloadPlugin(pluginId, bundledCode);
        }
      } else {
        // Keep disabled — ensure state is not ACTIVE
        if (currentState === PluginState.ACTIVE) {
          // inconsistent DB/memory — force deactivate path already handled above
        } else {
          // 兜底回收可能残留的 worker 线程（审计 C-4）。
          //
          // 修复前的成因判断有误（原以为是「mode 从 DB 二次读导致走错分支」）——
          // `worker-manager.terminate()` 的 finally 块是**无条件**回收的，与 execution_mode 无关。
          // 真实泄漏场景在这里：插件处于 ERROR / INACTIVE 态时执行更新，
          // `wasActive` 为 false → 上面的 deactivate 分支整段被跳过 → 若此前崩溃或
          // 其它路径留下了活跃 worker，其引用与 serviceHost 注册的命令转发无人回收；
          // 之后再以 worker 模式激活会被 "Worker already exists" 拒绝。
          //
          // 此处无条件兜底（幂等）：无论当前是否真的有 worker，都调用一次。
          try {
            if (this.workerManager) {
              await this.workerManager.terminateWorker(pluginId);
            }
          } catch (e) {
            console.warn(`[PluginHost] Best-effort worker reclaim during update of "${pluginId}" failed:`, e);
          }

          this.setPluginState(
            pluginId,
            currentState === PluginState.UNINSTALLED ? PluginState.INSTALLED : currentState,
            { persistDb: true },
          );
        }
      }

      // Cleanup backup
      try {
        if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }

      console.log(
        `[PluginHost] Plugin "${manifest.id}" updated ${oldVersion} → ${newVersion} (${pluginId}), wasActive=${wasActive}`,
      );
      this.emitProgress(manifest.id, 'complete', 'Update complete');
      return {
        pluginId,
        manifest,
        oldVersion,
        newVersion,
        previousStatus,
        wasActive,
      };
    } catch (err) {
      // Best-effort restore of key files for inactive updates; active reload has its own rollback
      try {
        if (fs.existsSync(backupDir)) {
          for (const name of ['index.js', 'manifest.json', 'package.zip', 'frontend.js']) {
            const b = path.join(backupDir, name);
            if (fs.existsSync(b)) fs.copyFileSync(b, path.join(pluginDir, name));
          }
          // 回滚路径：写回的是旧 manifest，version 必须取**旧行**的值。
          // 若这里填新 manifest 的 version，会造成「索引列比真源新」的不一致 ——
          // 那比 version 列为 NULL 更难排查（NULL 语义明确是「未知」）。
          this.db
            .prepare(`UPDATE plugins SET name = ?, manifest = ?, execution_mode = ?, version = ? WHERE id = ?`)
            .run(existingRow.name, existingRow.manifest, existingRow.execution_mode, existingRow.version, pluginId);
        }
      } catch (restoreErr) {
        console.error(`[PluginHost] Failed to restore backup after update error:`, restoreErr);
      }
      try {
        if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  /**
   * 从 DB 恢复所有 active 状态的 ESM 插件。
   *
   * 方法 6: restoreActivePlugins(): Promise<void>
   *
   * 从 PluginRuntime.loadFromDB 迁移：
   * - 查询 SELECT * FROM plugins WHERE status = 'active' AND loader_version = 'esm'
   * - 对每个插件调用 activatePlugin()
   * - 单个插件激活失败不影响其他插件（D-10）
   * - loader_version='vm' 的插件不可恢复（PluginHost 仅处理 ESM 插件）
   *
   * 在服务器重启时调用，恢复之前运行中的插件。
   */
  async restoreActivePlugins(): Promise<void> {
    const plugins = this.db
      .prepare("SELECT * FROM plugins WHERE status = 'active' AND loader_version = 'esm'")
      .all() as Array<{ id: string; name?: string; execution_mode?: string; [key: string]: unknown }>;

    console.log(`[PluginHost] Restoring ${plugins.length} active ESM plugin(s) from database`);

    // Ensure frontend.js is extracted for all active plugins if missing
    for (const p of plugins) {
      try {
        const pluginDir = this.getPluginDir(p.id);
        const frontendPath = path.join(pluginDir, 'frontend.js');
        const zipFilePath = path.join(pluginDir, 'package.zip');
        if (fs.existsSync(zipFilePath) && !fs.existsSync(frontendPath)) {
          console.log(`[PluginHost] Extracting missing frontend.js for plugin ${p.id}...`);
          const zipBuffer = fs.readFileSync(zipFilePath);
          const zip = await JSZip.loadAsync(zipBuffer);
          const frontendFile = zip.file('frontend.js');
          if (frontendFile) {
            const frontendCode = await frontendFile.async('string');
            fs.writeFileSync(frontendPath, frontendCode, 'utf-8');
            console.log(`[PluginHost] Successfully restored frontend.js for plugin ${p.id}`);
          }
        }
      } catch (err) {
        console.error(`[PluginHost] Failed to restore frontend.js for plugin ${p.id}:`, err);
      }
    }

    // V3.0: 按拓扑序激活（依赖优先）
    const manifests = new Map<string, Manifest>();
    for (const p of plugins) {
      try {
        const row = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(p.id) as
          { manifest: string } | undefined;
        if (row) {
          manifests.set(p.id, JSON.parse(row.manifest));
        }
      } catch {
        // Skip malformed manifests
      }
    }

    const graph = buildDepGraph(manifests);
    const installedIds = Array.from(manifests.keys());
    const { sorted, blocked, cycles } = topologicalSort(graph, installedIds);

    if (cycles.length > 0) {
      console.warn(
        `[PluginHost] Dependency cycles detected during restore:`,
        cycles.map((c) => c.join(' → ')).join(', '),
      );
      console.warn(`[PluginHost] Cyclic plugins will be activated without ordering guarantees.`);
    }

    if (blocked.length > 0) {
      for (const b of blocked) {
        console.warn(
          `[PluginHost] Plugin "${b.pluginId}" blocked during restore: ` +
            `missing dependencies: ${b.missingDeps.join(', ')}`,
        );
      }
    }

    // ── 激活顺序（H-5）──
    //
    // 原实现把 blocked 与 cycles 一视同仁地「best-effort 激活」：
    //   const orderedIds = [...sorted];
    //   for (const b of blocked) orderedIds.push(b.pluginId);   // ← 缺依赖的插件被强行激活
    //   for (const cycle of cycles) orderedIds.push(...cycle);
    //
    // 缺依赖的插件被激活后会在 `activate()` 里撞上 MODULE_NOT_FOUND，
    // 状态机把它打成 ERROR —— 于是 DB 里出现一批「ERROR 状态的插件」，
    // 而真实原因是「它的依赖压根没装」。重启一次就复现一次，且现象与病因不在一处。
    //
    // 现在区分三类：
    //   · sorted  —— 依赖齐备，按拓扑序正常激活
    //   · cycles  —— 依赖成环，**仍** best-effort 激活（无序保证，但能跑）
    //   · blocked —— 依赖缺失/未激活，**不激活**，只记日志并保持 INSTALLED
    //                 理由：成环的插件功能上通常仍可用；缺依赖的插件一定不可用，
    //                 强行激活只会把「依赖没装」伪装成「插件自身报错」
    const orderedIds = [...sorted];
    for (const cycle of cycles) orderedIds.push(...cycle);

    if (blocked.length > 0) {
      const blockedIds = new Set(blocked.map((b) => b.pluginId));
      for (const b of blocked) {
        console.warn(
          `[PluginHost] Skipping activation of "${b.pluginId}": dependency not satisfied ` +
            `(${b.missingDeps.join(', ')}). 插件保持 INSTALLED —— 强行激活只会把` +
            `「依赖缺失」伪装成「插件自身报错」，重启后还会复现。`,
        );
      }
      // 双保险：即便 orderedIds 里因其他路径混入了被阻塞插件，这里也剔除
      for (let i = orderedIds.length - 1; i >= 0; i--) {
        if (blockedIds.has(orderedIds[i])) orderedIds.splice(i, 1);
      }
    }

    for (const id of orderedIds) {
      const resolvedId = this.resolvePluginUuid(id);
      const p = plugins.find((pl) => pl.id === resolvedId);
      if (!p) continue;

      const runtimeState = this.getPluginState(p.id);
      if (runtimeState === PluginState.ACTIVE) {
        continue;
      }

      try {
        const mode = (p.execution_mode ?? 'inline') as 'inline' | 'worker';
        await this.activatePlugin(p.id, { mode });
      } catch (err) {
        // D-10: 单个插件激活失败不影响其他插件
        console.error(`[PluginHost] Failed to restore plugin "${p.name ?? p.id}" (${p.id}):`, err);
      }
    }

    console.log('[PluginHost] Plugin restoration complete');
  }

  // ── Phase 7: Hot Reload ──────────────────────────────────────────────────

  private _hotReloadController: import('./hot-reload.js').HotReloadController | null = null;

  /**
   * Phase 7: 设置 HotReloadController 引用（避免循环依赖）。
   * 由 Kernel 在 dev 模式初始化 HotReloadController 后调用。
   */
  setHotReloadController(controller: import('./hot-reload.js').HotReloadController): void {
    this._hotReloadController = controller;
  }

  /**
   * 暴露 resourceTracker 给 reloadPlugin 和测试使用。
   */
  getResourceTracker(): ResourceTracker {
    return this.resourceTracker;
  }

  /**
   * **插件状态的唯一写入点**（审计 H-4）。
   *
   * 修复前，`pluginStates`（内存）与 `plugins.status`（DB）由 16 处代码**各自独立**写入：
   * - 激活失败只写内存 `ERROR`，不写 DB（成功路径才写 `status='active'`）
   *   → 重启后 `restoreActivePlugins` 会重试一个已知失败的插件；
   * - worker-manager 熔断直接 `UPDATE plugins SET status='error'`，
   *   **不动** `pluginStates` → DB=error、内存=ACTIVE。
   *
   * 两个方向的分歧都会造成「重启前后行为不同」或「UI 与运行时不一致」。
   * 收敛到本方法后，任何状态变更都必须显式声明是否持久化，
   * 且两侧在同一函数内更新，物理上无法只改一边。
   *
   * @param pluginId 插件 id
   * @param state 目标状态
   * @param opts.persistDb 是否同步写入 DB（默认 false）。仅在状态确应跨重启存活时传 true
   */
  /**
   * 插件转入非活跃态时，注销其**声明式贡献**（审计 D-1 / D-2）。
   *
   * `contributionRegistry` 的键是 `manifest.id`（而非 DB 主键 pluginId），
   * 见 installPlugin 的 `register(manifest.id, manifest.contributes)`。
   * 之前只有 `uninstallPlugin` 会注销，停用时不清 → 服务端贡献摘要长期包含
   * 已停用插件的条目。
   *
   * 说明：这**不影响前端 UI** —— 前端扩展点由插件在 `activate()` 内自行注册、
   * 停用时由前端宿主 `unregisterPluginResources()` 清理，走的是另一条链路。
   * 这里清理的是服务端这份无人读取的死数据（审计 M-2 已更正其影响面）。
   */
  /**
   * 声明本插件对 ProcessManager 的所有权（B-5）。
   *
   * 必须在 buildContext 之前调用：归属通过 ProcessManager 的同步字段写入，
   * 顺序错了会把任务记到上一个插件名下。
   *
   * 失败不阻断激活 —— 归属声明只是 kill() 的归属校验依据，缺失时校验退化为
   * 「不拦截」（与修复前一致），不该让插件因它起不来。
   */
  private async declareProcessOwnership(pluginId: string): Promise<void> {
    try {
      const pm = await this.serviceRegistry.resolve<IProcessService>(IProcessServiceToken);
      if (typeof pm?.setPluginOwner === 'function') pm.setPluginOwner(pluginId);
    } catch (e) {
      console.warn(`[PluginHost] Failed to declare process ownership for "${pluginId}":`, e);
    }
  }

  private revokePluginContributions(pluginId: string): void {
    const manifestId = this.getPluginManifest(pluginId)?.id ?? pluginId;
    try {
      this.contributionRegistry.unregister(manifestId);
    } catch (e) {
      console.warn(`[PluginHost] Failed to unregister contributions for "${pluginId}":`, e);
    }
    void this.revokePluginStageGuards(pluginId, manifestId);
  }

  /**
   * 回收该插件注册的教学环节门禁守卫（I-3）。
   *
   * 守卫注册在**内核 DI 的 StageGuardPipeline 单例**里，进程级存活 ——
   * 插件停用/卸载时不清理，门禁会继续按已停用插件的规则判定。
   * 旧实现里守卫没有 owner 字段，插件只能按 id 全局删，会误伤同名的他人守卫；
   * I-3 给守卫加了 owner 后即可精确回收。
   *
   * 两侧 id 都试一遍：注册方可能传 pluginId（DB uuid）也可能传 manifestId，
   * 取决于插件作者用了哪个。
   */
  private async revokePluginStageGuards(pluginId: string, manifestId: string): Promise<void> {
    try {
      const pipeline = await this.serviceRegistry.resolve(IStageGuardServiceToken);
      if (!pipeline || typeof pipeline.unregisterByOwner !== 'function') return;
      let removed = 0;
      for (const owner of new Set([pluginId, manifestId])) {
        removed += pipeline.unregisterByOwner(owner) ?? 0;
      }
      if (removed > 0) {
        console.log(`[PluginHost] Revoked ${removed} stage guard(s) for plugin "${pluginId}"`);
      }
    } catch (e) {
      console.warn(`[PluginHost] Failed to revoke stage guards for "${pluginId}":`, e);
    }
  }

  private setPluginState(pluginId: string, state: PluginState, opts: { persistDb?: boolean } = {}): void {
    this.pluginStates.set(pluginId, state);
    if (!opts.persistDb) return;

    // UNINSTALLED 走 DELETE 而非 status 更新（uninstallPlugin 会删行）
    if (state === PluginState.UNINSTALLED) return;

    // PluginState 值与 DB status 字符串一一对应（'installed'/'activating'/...）
    const statusMap: Partial<Record<PluginState, string>> = {
      [PluginState.INSTALLED]: 'installed',
      [PluginState.ACTIVATING]: 'installed',
      [PluginState.ACTIVE]: 'active',
      [PluginState.DEACTIVATING]: 'active',
      [PluginState.INACTIVE]: 'inactive',
      [PluginState.ERROR]: 'error',
    };
    const status = statusMap[state];
    if (!status) return;

    try {
      this.db.prepare('UPDATE plugins SET status = ? WHERE id = ?').run(status, pluginId);
    } catch (e) {
      // 测试库可能缺少 plugins 表；不因持久化失败而中断状态机
      console.warn(`[PluginHost] Failed to persist status "${status}" for "${pluginId}":`, e);
    }
  }

  /**
   * 精确销毁快照中的一组 Disposable，并把它们从 ResourceTracker 中摘除。
   *
   * 与 `disposeAll` 的区别：disposeAll 销毁该插件**全部**资源；本方法只碰快照里的那些，
   * 因此可在「新旧版本资源混在同一追踪表」的窗口里安全使用（热重载成功路径）。
   */
  private disposeSnapshot(pluginId: string, disposables: readonly Disposable[]): void {
    for (const d of disposables) {
      try {
        d.dispose();
      } catch (e) {
        console.error(`[PluginHost] Error disposing old resource for "${pluginId}":`, e);
      }
    }
    this.resourceTracker.reap(pluginId, disposables as Disposable[]);
  }

  /**
   * 热重载失败回滚：让旧版本恢复到「可服务命令」的状态。
   *
   * 场景：新版本 activate 抛错。此刻 ResourceTracker 里同时存在旧资源（第 3 步快照）
   * 与新版本 activate 期间注册的资源，**两者混在一个 list 中、无法逐一区分**。
   *
   * 因此采取「重建而非猜测」的策略：
   * 1. `disposeAll` 清空全部追踪资源（含旧资源与新资源）；
   * 2. **重新激活旧版本**（`activatePluginExclusive` 内部只新增不依赖历史状态，
   *    且 activate 失败会再次 disposeAll，不会累积残留）。
   *
   * 为什么不像成功路径那样「只 dispose 新资源」：ResourceTracker 只保存 Disposable 数组，
   * 不记录归属版本，没有可靠办法区分二者。要让回滚也精确，需在 ResourceTracker 上按版本
   * 分桶 —— 属架构变更，本轮不做（见台账 Batch 2 备注）。
   *
   * 若重建也失败，则把状态置为 ERROR 并让 DB 同步 —— 宁可显示「已停用并报错」，
   * 也不能留下「状态显示 active、命令全部 404」的僵尸态（审计 C-3）。
   */
  private async rollbackReload(pluginId: string, oldInstance: PluginInstance | undefined): Promise<void> {
    this.resourceTracker.disposeAll(pluginId);

    if (!oldInstance) {
      this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
      return;
    }

    try {
      // 回到 INSTALLED 再激活：validateTransition 不允许 ERROR→ACTIVE 之外的非法路径，
      // 而此处旧实例仍可运行，语义上就是「仍是已安装状态、只是本次热重载失败」。
      this.setPluginState(pluginId, PluginState.INSTALLED, { persistDb: true });
      await this.activatePluginExclusive(pluginId);
      console.warn(`[PluginHost] reload rollback for "${pluginId}": 旧版本已重新激活，插件恢复可用。`);
    } catch (err) {
      // 重建失败：进入 ERROR 并同步 DB，避免僵尸态
      console.error(`[PluginHost] reload rollback failed for "${pluginId}":`, err);
      this.resourceTracker.disposeAll(pluginId);
      this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
    }
  }

  /**
   * Phase 7: 原子热重载插件。
   *
   * 策略（atomic new-before-old）：
   * 1. 提取新 manifest，验证 ID 一致性
   * 2. SemVer 兼容检查
   * 3. 构建新 PluginContext
   * 4. ESM 加载新源码 → 激活新版本
   * 5. [成功] 停用旧版本 → 清理旧资源 → 替换实例引用 → 更新 DB
   * 6. [失败] 保留旧版本运行，清理临时资源，抛出 HotReloadActivationError
   *
   * @param pluginId - 插件标识符
   * @param newSourceCode - 新版本源码
   */
  async reloadPlugin(pluginId: string, newSourceCode: string): Promise<void> {
    pluginId = this.resolvePluginUuid(pluginId);

    // ── 并发串行化（审计 H-2）─────────────────────────────────────────────
    //
    // 修复前 reload **完全不经过** inflightActivate / inflightDeactivate 串行化，
    // 也不检查 ACTIVATING/DEACTIVATING 中间态。与 deactivate 并发时，
    // 两边各自 `disposeAll(pluginId)` 互相踩踏：reload 刚注册的新资源会被
    // deactivate 的清理销毁，或反之，最终状态与实际注册情况不符。
    //
    // 这里等待在飞的生命周期操作结束后再进入 reload。
    await this.waitForLifecycleIdle(pluginId);

    const currentState = this.pluginStates.get(pluginId);

    // 1. 状态检查
    if (currentState !== PluginState.ACTIVE) {
      throw new IllegalStateTransitionError(pluginId, currentState ?? PluginState.UNINSTALLED, PluginState.ACTIVE);
    }

    const oldInstance = this.pluginInstances.get(pluginId);
    if (!oldInstance) {
      throw new PluginActivateError(pluginId, 'No active instance found for reload');
    }

    const oldManifest = oldInstance.manifest;
    const oldVersion = oldManifest.version ?? 'unknown';
    const filePath = '(hot-reload)';

    // 2. 提取 manifest
    let newManifest: Manifest;
    try {
      newManifest = await this.extractManifest(newSourceCode);
    } catch (err) {
      throw new HotReloadActivationError(pluginId, filePath, err instanceof Error ? err : new Error(String(err)));
    }

    // 2a. 验证 manifest.id 一致性
    if (newManifest.id !== oldManifest.id) {
      throw new HotReloadError(
        `Manifest id mismatch: expected "${oldManifest.id}", got "${newManifest.id}"`,
        pluginId,
        filePath,
      );
    }

    // 2b. SemVer 兼容检查
    const skipTokens = this.checkSemVerCompatibility(newManifest, pluginId, 'activate');

    // 3. 快照旧资源 — 在构建新 Context 之前（防止 disposeAll 误伤新资源）
    const oldDisposables = this.resourceTracker.snapshot(pluginId);

    // 4. 构建新 Context（会注册新 disposables 到 ResourceTracker）
    const ctx = await buildContext(
      this.serviceRegistry,
      this.resourceTracker,
      pluginId,
      newManifest,
      this.db,
      skipTokens,
      this.contributionRegistry,
    );

    // 5. Phase 5: Worker-mode check — if worker-mode, delegate to workerManager
    const mode = this.getExecutionMode(pluginId);
    if (mode === 'worker') {
      return this.reloadWorker(pluginId, newSourceCode, newManifest, oldInstance, oldDisposables, filePath, oldVersion);
    }

    // 6. ESM 加载 + 激活新版本（inline mode）
    let newInstance: {
      manifest: Manifest;
      activate: ((pluginCtx: PluginContext) => Promise<void>) | undefined;
      deactivate?: (() => Promise<void>) | undefined;
    };

    try {
      const pluginModule: PluginModule = await this.esmLoader.load(newSourceCode);
      newInstance = {
        manifest: newManifest,
        activate: pluginModule.activate,
        deactivate: pluginModule.deactivate,
      };

      // Phase 7: middleware wrapping for reload
      const middlewareCtx: MiddlewareContext = {
        pluginId,
        manifest: newManifest,
        phase: 'beforeActivate',
        timestamp: Date.now(),
      };
      const before = this.getMiddleware('beforeActivate');
      const after = this.getMiddleware('afterActivate');
      const pipeline = compose([
        ...before,
        async (_ctx, next) => {
          await next();
          const afterCtx: MiddlewareContext = { ...middlewareCtx, phase: 'afterActivate' };
          await compose(after)(afterCtx, async () => {});
        },
      ]);
      await pipeline(middlewareCtx, async () => {
        if (newInstance.activate) {
          await newInstance.activate(ctx);
        }
      });
    } catch (err) {
      // 激活失败 —— 回滚（审计 C-3，async）
      //
      // 修复前是 `disposeAll(pluginId)`：销毁该插件**全部**已追踪资源，包括旧版本
      // 仍在正常运行的 command handler / event 订阅 / interval / http 路由。而
      // `pluginStates` 仍为 ACTIVE、`pluginInstances` 仍指向旧实例、DB 仍 'active'。
      //
      // 用户可见后果：插件中心显示「已启用」，但全部命令返回 "No handler registered"，
      // 且**无自愈路径** —— 再次 activate 会因状态已是 ACTIVE 被 validateTransition 拒绝。
      //
      // 修复：走 rollbackReload()，把旧版本重新激活；重建失败则置 ERROR 并同步 DB，
      // 任何路径下都不留下「状态与实际不一致」的僵尸态。
      await this.rollbackReload(pluginId, oldInstance);
      throw new HotReloadActivationError(pluginId, filePath, err instanceof Error ? err : new Error(String(err)));
    }

    // 7. 激活成功 — 停用旧版本
    try {
      if (oldInstance.deactivate) {
        const deactResult = oldInstance.deactivate();
        if (deactResult instanceof Promise) {
          await Promise.race([
            deactResult,
            new Promise<void>((_, reject) =>
              setTimeout(
                () => reject(new PluginDeactivateTimeoutError(pluginId, DEACTIVATION_TIMEOUT_MS)),
                DEACTIVATION_TIMEOUT_MS,
              ),
            ),
          ]);
        }
      }
    } catch (deactErr) {
      console.error(`[PluginHost] Deactivation error during reload for "${pluginId}":`, deactErr);
    }

    // 8. 精确清理旧资源（仅快照中的，不碰新注册的）
    this.disposeSnapshot(pluginId, oldDisposables);

    // 9. 替换实例引用
    this.pluginInstances.set(pluginId, newInstance);

    // 10. 更新 DB
    this.db
      .prepare('UPDATE plugins SET source_code = ?, manifest = ?, updated_at = ?, version = ? WHERE id = ?')
      .run(newSourceCode, JSON.stringify(newManifest), Date.now(), newManifest.version, pluginId);

    const newVersion = newManifest.version ?? 'unknown';
    console.log(`[PluginHost] Hot reload succeeded for "${pluginId}" — old: ${oldVersion} → new: ${newVersion}`);

    // 11. Phase 7: publish reload event
    try {
      const eventBus = await this.serviceRegistry.resolve<IEventBusService>(IEventBusServiceToken);
      eventBus.publish({
        id: uuidv7(),
        type: 'plugin.reloaded',
        source: 'plugin-host',
        payload: { pluginId, oldVersion, newVersion },
        timestamp: Date.now(),
      });
    } catch {
      // Event publishing failure is non-fatal
    }
  }

  /**
   * Phase 7: Worker-mode hot reload.
   * Creates a new Worker for the updated source, terminates the old one on success.
   */
  private async reloadWorker(
    pluginId: string,
    newSourceCode: string,
    _newManifest: Manifest,
    _oldInstance: NonNullable<ReturnType<typeof this.pluginInstances.get>>,
    _oldDisposables: import('./types.js').Disposable[],
    filePath: string,
    _oldVersion: string,
  ): Promise<void> {
    // 1. Save old source code for rollback
    const oldRow = this.db.prepare('SELECT source_code FROM plugins WHERE id = ?').get(pluginId) as
      { source_code: string } | undefined;
    const oldSourceCode = oldRow?.source_code ?? '';

    // 2. Terminate old worker
    let prevState: any = undefined;
    try {
      prevState = await this.workerManager.terminateWorker(pluginId);
    } catch {
      // Old worker may already be gone — continue
    }

    // 3. Write new source code to disk and create new worker with updated source
    try {
      const pluginDir = this.getPluginDir(pluginId);
      if (fs.existsSync(pluginDir)) {
        fs.writeFileSync(path.join(pluginDir, 'index.js'), newSourceCode);
      }

      await this.workerManager.createWorker(
        pluginId,
        _newManifest,
        newSourceCode,
        (await import('../worker-runtime/worker-manager.js')).ALL_SERVICE_TOKENS,
        undefined,
        this.getPluginDir(pluginId),
        prevState,
      );
      this.db
        .prepare('UPDATE plugins SET source_code = ?, updated_at = ? WHERE id = ?')
        .run(newSourceCode, Date.now(), pluginId);
      console.log(`[PluginHost] Worker-mode reload succeeded for "${pluginId}"`);
    } catch (err) {
      // Failed — try to restore old worker
      if (oldSourceCode) {
        try {
          await this.workerManager.createWorker(
            pluginId,
            _newManifest,
            oldSourceCode,
            (await import('../worker-runtime/worker-manager.js')).ALL_SERVICE_TOKENS,
            undefined,
            this.getPluginDir(pluginId),
          );
        } catch {
          console.error(`[PluginHost] Worker-mode reload: failed to restore old worker for "${pluginId}"`);
        }
      }
      throw new HotReloadActivationError(pluginId, filePath, err instanceof Error ? err : new Error(String(err)));
    }
  }
}

// ── Re-exports ───────────────────────────────────────────────────────────────

export { SemverMismatchError } from './errors.js';
export { PluginRuntimeAdapter, type IPluginRuntime } from './plugin-runtime-adapter.js';
export { PluginRuntimeComposition } from './plugin-runtime-composition.js';
export { PluginContextAdapter, type IUnifiedPluginContext } from './plugin-context-adapter.js';
export { PluginLifecycleManager, type IPluginLifecycleManager } from './plugin-lifecycle-manager.js';
export {
  PluginCapabilityGateway,
  type IPluginCapabilityGateway,
  type CapabilityMetadata,
} from './plugin-capability-gateway.js';
export {
  UnifiedExtensionRegistry,
  type IUnifiedExtensionRegistry,
  type ExtensionItemMetadata,
} from './unified-extension-registry.js';
export {
  PluginDistributionManager,
  LocalRepositoryAdapter,
  type IPluginDistributionManager,
  type IPluginRepositoryAdapter,
  type PluginPackageMetadata,
} from './plugin-distribution-manager.js';

export { PluginHttpRouter, compileRoutePattern } from './http-router.js';
export type { PluginApiRequest, PluginApiResponse, PluginApiHandler, IPluginHttpRouter } from './types.js';
