/**
 * PluginHost 基类（L-2 阶段 2）。
 *
 * ## 为什么是抽象类继承链
 *
 * 实测：TypeScript **禁止**在类的外部通过 `this: PluginHost` 访问 private 字段（TS2341）。
 * 所以「抽成独立函数 + Object.assign 到 prototype」这条路，唯一出路是把内部字段全改成
 * public —— 那是真实的封装损失。
 *
 * 继承链没有这个问题：子类天然能访问父类的 **protected** 成员，而 protected 在类外与
 * private 一样不可访问 —— **对外 API 不变**。
 *
 * 链序：Base → Core → Http → Lifecycle → Reload → Install
 *
 * 硬约束：**后面的类能调用前面的，前面的不能调用后面的**（TS 解析时看不到后面类的声明）。
 * 已用脚本按调用图验证：分组后违例为 0。链序由三条事实决定 ——
 *   1. `setPluginState` / `declareProcessOwnership` / `revokePluginContributions` /
 *      `revokePluginStageGuards` 被 10+ 个方法跨模块调用，必须在链首的 Core；
 *   2. Reload 调用 Lifecycle（restore → activate），故 Lifecycle 在前；
 *   3. Install 依赖 Lifecycle 与 Reload，却**无人依赖它**，故置于链尾。
 *
 * 本文件同时承载原 `index.ts` 的文件级声明（状态转移表、超时常量、静态路由中间件工厂等），
 * 主题模块从这里 import。它们此前是模块私有的，现在仅对同包模块可见 ——
 * `index.ts` 并未 re-export，对外 API 不变。
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
import { normalizeExecutionMode, requiresProcessIsolation, type PluginExecutionMode } from './types.js';
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
} from './errors.js';
import { ICapabilityServiceToken, IEventBusServiceToken } from '../di/interfaces.js';
import type { ICapabilityService, IEventBusService } from '../di/interfaces.js';
import { WorkerManager } from '../worker-runtime/worker-manager.js';
import type { IWorkerTransport } from '../worker-runtime/types.js';
import type { ServiceHost } from '../worker-runtime/service-host.js';
import { OPENLEARN_VERSION } from '../version.js';
import type { PluginHost } from './index.js';

export const VALID_TRANSITIONS: Record<PluginState, PluginState[]> = {
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

export const ACTIVATION_TIMEOUT_MS = 5000;

export const DEACTIVATION_TIMEOUT_MS = 5000;

/** 平台版本号 — 用于 engines.openlearn 兼容性检查，统一从 version.js 引入并导出 */

/** 插件静态资源安全沙箱中间件 */

export function createPluginStaticMiddleware(absDir: string) {
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

export function resolveHostSdkDir(): string | null {
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

export interface PluginInstance {
  manifest: Manifest;
  activate: ((ctx: PluginContext) => Promise<void>) | undefined;
  deactivate?: (() => Promise<void>) | undefined;
  workerRef?: { transport: IWorkerTransport; serviceHost: ServiceHost };
  context?: PluginContext;
}

export abstract class PluginHostBase {
  // D-03: 插件状态追踪
  protected pluginStates = new Map<string, PluginState>();

  // D-07: 资源追踪器 — 按 pluginId 管理 Disposable 资源
  protected resourceTracker = new ResourceTracker();

  // V3.0: 贡献注册表 — 声明式 UI 贡献点存储
  protected contributionRegistry = new ContributionRegistry();

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
  protected middlewareRegistry = new Map<LifecyclePhase, Middleware[]>();

  // Preloaded plugins map for built-in plugins running in inline mode (Phase 8)
  protected preloadedPlugins = new Map<
    string,
    {
      manifest: any;
      activate: (ctx: PluginContext) => Promise<void>;
      deactivate?: () => Promise<void>;
    }
  >();

  // 活跃插件实例引用（manifest + activate/deactivate 函数）
  protected pluginInstances = new Map<string, PluginInstance>();

  /** Coalesce concurrent activate/deactivate calls per plugin (prevents activating→activating). */
  protected inflightActivate = new Map<string, Promise<void>>();

  protected inflightDeactivate = new Map<string, Promise<void>>();

  /**
   * D-02: 构造函数 — 接收 3 个核心依赖。
   *
   * @param serviceRegistry - DI 容器
   * @param esmLoader - ESM 动态加载器（Node.js / 浏览器实现）
   * @param db - SQLite 数据库实例
   */
  /** 插件文件系统存储目录 */
  protected pluginsDir: string;

  protected expressApp: any = null;

  protected _registeredRoutes = new Map<string, string>();

  protected _socketIO: any = null;

  constructor(
    protected serviceRegistry: ServiceRegistry,
    protected esmLoader: EsmLoader,
    protected db: Database,
    pluginsDir?: string,
  ) {
    this.pluginsDir = pluginsDir ?? path.resolve(process.cwd(), 'plugins');
  }

  protected _workerManager: WorkerManager | null = null;

  /** Internal getter — throws if WorkerManager was not set. */
  protected get workerManager(): WorkerManager {
    if (!this._workerManager) {
      throw new Error(
        '[PluginHost] WorkerManager not set — call setWorkerManager before activating worker-mode plugins',
      );
    }
    return this._workerManager;
  }

  // ── Phase 7: Middleware Registration ─────────────────────────────────────

  protected _hotReloadController: import('./hot-reload.js').HotReloadController | null = null;
}
