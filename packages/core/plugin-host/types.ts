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
import type { ContributionSummary } from './contribution-registry.js';
import type { IConfigService } from './config-service.js';

/**
 * ContributionAccessor — 插件可在运行时内省自己在 manifest 中声明的贡献点（V3.0）。
 */
export interface ContributionAccessor {
  /** 列出该插件在所有 slot 上的贡献点摘要 */
  list(): ContributionSummary[];
}

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
/**
 * 插件可引用的主应用共享模块白名单（服务端）。
 * 前端专属库（konva/react-konva/react-konva-utils）通过前端 FrontendPluginHost 单独注入，
 * CJS bundle 无法加载纯 ESM 模块。
 */
export const PLUGIN_SHARED_MODULES = [
  'recharts',
  'react-markdown',
  'jspdf',
  'jspdf-autotable',
  'xlsx',            // 可选：需在 package.json dependencies 中
  'lucide-react',
  'uuid',
] as const;

/**
 * IPluginLogger — 插件结构化日志接口。
 *
 * 替代 system.log 命令，提供 4 级日志 + 自动注入 pluginId 和 timestamp。
 * V2.5 新增，V3.0 将移除 system.log 命令。
 */
export interface IPluginLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** 插件自建表 API — 命名空间隔离的数据库操作 */
export interface PluginDatabaseAPI {
  /** 确保插件专用表存在（幂等），表名自动加前缀 plugin_{pluginId}_{tableName} */
  ensureTable(tableName: string, schema: string): Promise<void>;
  /** 获取带前缀的完整表名 */
  table(tableName: string): string;
  /** 删除插件创建的所有表（uninstall 时由 PluginHost 自动调用） */
  dropAllTables(): Promise<void>;
  /** 执行声明式的数据库迁移，参数 version 表示目标版本号，若当前版本低于目标版本则执行 upgradeFn */
  migrate(targetVersion: number, upgradeFn: (db: any) => Promise<void> | void): Promise<void>;
}

// ── V5.2: RESTful API 契约 ──────────────────────────────────────────────

/** 插件 RESTful API 请求 DTO（只读、无原生 Node.js 对象、安全过滤） */
export interface PluginApiRequest<TBody = unknown, TQuery = Record<string, string | string[]>> {
  /** HTTP 请求动词（全大写） */
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | string;
  /** 插件命名空间下的相对路径（如 /students/101） */
  readonly path: string;
  /** 动态路由提取参数（如 { id: '101' }） */
  readonly params: Record<string, string>;
  /** 解析后的查询参数 */
  readonly query: TQuery;
  /** 经白名单清洗后的安全请求头 */
  readonly headers: Record<string, string>;
  /** 请求体（已解析为 JSON 或安全结构） */
  readonly body: TBody;
  /** 客户端 IP */
  readonly ip: string;
  /** 宿主注入的发起者上下文（只读不可伪造） */
  readonly actor: {
    readonly actorId: string;
    readonly userId?: string;
    readonly username?: string;
    readonly role: 'administrator' | 'teacher' | 'student' | 'anonymous' | string;
    readonly permissions?: string[];
  };
}

/** 插件 RESTful API 响应结构 */
export interface PluginApiResponse<TBody = unknown> {
  /** HTTP 响应状态码（默认 200，有效范围 100-599） */
  status?: number;
  /** 自定义安全响应头（白名单过滤） */
  headers?: Record<string, string>;
  /** 响应体数据 */
  body: TBody;
}

/** 插件 RESTful API 处理函数 */
export type PluginApiHandler<TBody = unknown, TRes = unknown> = (
  req: PluginApiRequest<TBody>,
) => Promise<PluginApiResponse<TRes> | TRes> | PluginApiResponse<TRes> | TRes;

/**
 * 插件流式响应写入器接口 (SSE Stream Writer)
 */
export interface PluginStreamResponse {
  /**
   * 写入一个 SSE 数据块
   * @param data 传输的数据（对象自动序列化为 JSON 字符串，字符串原样输出）
   * @param event 可选的 SSE 事件类型名（默认 'message'）
   * @param id 可选的 SSE 消息唯一 ID
   * @returns 是否成功排队/写入（若客户端已断开则返回 false）
   */
  write(data: string | Record<string, any>, event?: string, id?: string): boolean;

  /**
   * 正常结束流式传输
   */
  end(): void;

  /**
   * 异常终止流式传输（向客户端发送 error 事件并关闭连接）
   */
  error(err: Error | string): void;

  /**
   * 客户端连接是否已断开
   */
  readonly isClosed: boolean;

  /**
   * 监听客户端断开连接事件（用于在客户端主动中止时中断大模型调用或循环任务）
   */
  onClose(callback: () => void): void;
}

/**
 * 插件流式处理器签名
 */
export type PluginStreamHandler<TBody = unknown> = (
  req: PluginApiRequest<TBody>,
  stream: PluginStreamResponse,
) => Promise<void> | void;

/** 插件 HTTP 路由器接口 */
export interface IPluginHttpRouter {
  get<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>): void;
  post<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  put<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  patch<TBody = unknown, TRes = unknown>(path: string, handler: PluginApiHandler<TBody, TRes>): void;
  delete<TRes = unknown>(path: string, handler: PluginApiHandler<unknown, TRes>): void;
  route<TBody = unknown, TRes = unknown>(
    method: string,
    path: string,
    handler: PluginApiHandler<TBody, TRes>,
  ): void;

  /**
   * 注册 Server-Sent Events (SSE) 流式响应端点（默认支持 GET 和 POST）
   */
  stream<TBody = unknown>(path: string, handler: PluginStreamHandler<TBody>): void;

  /**
   * 注册指定 HTTP 动词的 Server-Sent Events (SSE) 流式响应端点
   */
  stream<TBody = unknown>(method: string, path: string, handler: PluginStreamHandler<TBody>): void;
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
  /**
   * V3.0: 向 DI 容器注册一个由插件提供的服务（对应 manifest.provides）。
   * 其他插件可通过 ctx.resolve(token) 消费。
   */
  provide<T>(token: Token<T>, instance: T): Promise<void>;
  /** 插件自建表 API（v5.1） */
  db: PluginDatabaseAPI;
  /** 结构化日志接口（V2.5），自动注入 pluginId 和 timestamp */
  log: IPluginLogger;
  /**
   * 声明式贡献点只读视图（V3.0）。
   * 允许插件在运行时内省自己在 manifest 中声明的贡献点。
   */
  contributions: ContributionAccessor;
  /**
   * 类型安全的配置服务（V3.0）。
   * 读取 manifest.configuration 中声明的设置项，自动应用默认值和校验。
   */
  config: IConfigService;
  /**
   * 插件 RESTful API 路由器（V5.2）
   * 提供 get/post/put/patch/delete 等端点声明
   */
  http: IPluginHttpRouter;
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
  manifest?: string;
  created_at?: number;
  has_frontend?: boolean;
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
