/**
 * PluginHost 子系统基础类型定义。
 *
 * 为 PluginHost 生命周期管理器、ContextBuilder 和资源追踪器提供共享的类型契约。
 *
 * D-03: PluginState 枚举 — 7 个值定义完整的插件生命周期状态机
 * D-04/D-05: PluginContext — 7 个 IService 属性供插件访问内核能力
 */

import type { IActionRegistryService } from '../di/interfaces.js';
import type { ICommandBusService } from '../di/interfaces.js';
import type { IEventBusService } from '../di/interfaces.js';
import type { ICapabilityService } from '../di/interfaces.js';
import type { IProcessService } from '../di/interfaces.js';
import type { IStorageService } from '../di/interfaces.js';
import type { IAIService } from '../di/interfaces.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import type { Token } from '../di/token.js';

/**
 * Disposable — 可清理资源的统一接口。
 *
 * 任何需要生命周期清理的资源（命令处理器、事件订阅、定时器、
 * 进程等）都实现此接口，使 ResourceTracker 能够统一管理。
 */
export interface Disposable {
  dispose(): void;
}

/**
 * PluginState — 插件生命周期状态机枚举。
 *
 * 状态转换图（D-03）：
 *   INSTALLED → ACTIVATING → ACTIVE → DEACTIVATING → INACTIVE
 *                                          ↓
 *                                        ERROR
 *   INACTIVE → ACTIVATING（重新激活）或 UNINSTALLED
 *   ERROR → ACTIVATING（重试激活）或 UNINSTALLED
 *
 * ACTIVATING 和 DEACTIVATING 是瞬态（transient），不应长时间停留。
 */
export enum PluginState {
  INSTALLED = 'installed',
  ACTIVATING = 'activating',
  ACTIVE = 'active',
  DEACTIVATING = 'deactivating',
  INACTIVE = 'inactive',
  ERROR = 'error',
  UNINSTALLED = 'uninstalled',
}

/**
 * PluginContext — 插件激活时接收的上下文对象。
 *
 * 包含 7 个内核服务接口 + 插件标识信息 + manifest 元数据 + resolve 辅助函数。
 * ContextBuilder（Plan 03）负责构建此对象并进行安全包装。
 */
/** 插件可引用的主应用共享模块白名单 */
export const PLUGIN_SHARED_MODULES = [
  'recharts',
  'react-markdown',
  'jspdf',
  'jspdf-autotable',
  'xlsx',
  'konva',
  'react-konva',
  'react-konva-utils',
  'lucide-react',
  'uuid',
] as const;

/** 插件自建表 API — 命名空间隔离的数据库操作 */
export interface PluginDatabaseAPI {
  /** 确保插件专用表存在（幂等），表名自动加前缀 plugin_{pluginId}_{tableName} */
  ensureTable(tableName: string, schema: string): Promise<void>;
  /** 获取带前缀的完整表名 */
  table(tableName: string): string;
  /** 删除插件创建的所有表（uninstall 时由 PluginHost 自动调用） */
  dropAllTables(): Promise<void>;
}

export interface PluginContext {
  /** 7 个内核服务，通过 Token DI 获取的接口代理 */
  services: {
    commandBus: ICommandBusService;
    eventBus: IEventBusService;
    actionRegistry: IActionRegistryService;
    capability: ICapabilityService;
    processManager: IProcessService;
    storage: IStorageService;
    ai: IAIService;
  };
  /** 插件唯一标识符（manifest.id） */
  pluginId: string;
  /** 插件 manifest 元数据 */
  manifest: Manifest;
  /** 解析依赖注入容器中的服务 */
  resolve<T>(token: Token<T>): Promise<T>;
  /** 插件自建表 API（v5.1） */
  db: PluginDatabaseAPI;
  /**
   * 引用主应用共享模块（v5.1）
   * 仅白名单中的模块可被引用，非白名单模块抛出错误
   */
  require(moduleName: string): any;
}

/**
 * PluginInfo — 插件基本信息摘要。
 *
 * 用于 UI 展示和状态查询，不包含运行时上下文。
 */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  state: PluginState;
  status?: string;
  execution_mode?: string;
}

// ── Phase 7: Hot Reload Types ─────────────────────────────────────────────

/**
 * HotReloadEvent — 文件变更触发的热重载事件。
 */
export interface HotReloadEvent {
  pluginId: string;
  filePath: string;
  timestamp: number;
}

export type HotReloadCallback = (event: HotReloadEvent) => Promise<void>;

// ── Phase 7: Middleware Types ─────────────────────────────────────────────

/**
 * LifecyclePhase — 中间件挂载的生命周期阶段。
 */
export type LifecyclePhase =
  | 'beforeActivate'
  | 'afterActivate'
  | 'beforeDeactivate'
  | 'afterDeactivate'
  | 'beforeCommand'
  | 'afterCommand';

/**
 * MiddlewareContext — 传递给每个中间件的不可变上下文。
 */
export interface MiddlewareContext {
  readonly pluginId: string;
  readonly manifest: Manifest;
  readonly phase: LifecyclePhase;
  readonly timestamp: number;
}

/**
 * Middleware — 洋葱模型中间件函数。
 *
 * 在 next() 之前做预处理，next() 之后做后处理。
 * 不调用 next() 则终止管道。
 */
export type Middleware = (
  ctx: MiddlewareContext,
  next: () => Promise<void>,
) => Promise<void>;
