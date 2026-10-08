/**
 * PluginHost 子系统基础类型定义。
 *
 * 为 PluginHost 生命周期管理器、ContextBuilder 和资源追踪器提供共享的类型契约。
 *
 * D-03: PluginState 枚举 — 7 个值定义完整的插件生命周期状态机
 * D-04/D-05: PluginContext — 9 个 IService 属性供插件访问内核能力
 */

import type { IActionRegistryService } from '../di/interfaces.js';
import type { ICommandBusService } from '../di/interfaces.js';
import type { IEventBusService } from '../di/interfaces.js';
import type { ICapabilityService } from '../di/interfaces.js';
import type { IProcessService } from '../di/interfaces.js';
import type { IStorageService } from '../di/interfaces.js';
import type { IAIService } from '../di/interfaces.js';
import type { IPointsDimensionRegistry } from '../di/interfaces.js';
import type { IPointsLedgerService } from '../di/interfaces.js';
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
  'exceljs', // 可选：需在 package.json dependencies 中
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
  /**
   * 可选的 SSO 会话 Token（由平台 IAuthSessionBridgeService 颁发）。
   * 若提供且为合法的 token_* 格式，网关在主线程自动写入符合 SameSite=None; Secure 规范的会话 Cookie。
   */
  sessionToken?: string;
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
  route<TBody = unknown, TRes = unknown>(method: string, path: string, handler: PluginApiHandler<TBody, TRes>): void;

  /**
   * 注册 Server-Sent Events (SSE) 流式响应端点（默认支持 GET 和 POST）
   */
  stream<TBody = unknown>(path: string, handler: PluginStreamHandler<TBody>): void;

  /**
   * 注册指定 HTTP 动词的 Server-Sent Events (SSE) 流式响应端点
   */
  stream<TBody = unknown>(method: string, path: string, handler: PluginStreamHandler<TBody>): void;

  /**
   * 判断该 method+path 是否命中了一个流式（SSE）路由。
   *
   * 宿主在把请求分派给插件前用它决定走 handle 还是 handleStream。
   */
  isStream(method: string, path: string): boolean;
}

export interface PluginContext {
  /** 9 个内核服务，通过 Token DI 获取的接口代理 */
  services: {
    commandBus: ICommandBusService;
    eventBus: IEventBusService;
    actionRegistry: IActionRegistryService;
    capability: ICapabilityService;
    processManager: IProcessService;
    storage: IStorageService;
    ai: IAIService;
    pointsDimension: IPointsDimensionRegistry | null;
    pointsLedger: IPointsLedgerService | null;
  };
  /**
   * 插件唯一标识符。
   *
   * 注意：这是 `plugins` 表的行 UUID，**不是** `manifest.id`。
   * 命名空间相关的场景（如 `db.table()` 表前缀）在 inline / worker 两种模式下
   * 取值规则不同，详见 docs/reference/plugin-database-api.md。
   */
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
  'beforeActivate' | 'afterActivate' | 'beforeDeactivate' | 'afterDeactivate' | 'beforeCommand' | 'afterCommand';

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
export type Middleware = (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;

/**
 * 插件的执行模式（L-1 P1 阶段 3）。
 *
 * | 值 | 隔离强度 | 说明 |
 * |---|---|---|
 * | `'inline'` | 无 | 与宿主同进程同线程运行。默认。 |
 * | `'worker'` | 崩溃隔离 | `worker_threads.Worker` —— 独立 V8 isolate，但**同进程**，共享内存与 `process.env`。 |
 * | `'process'` | **进程隔离** | `child_process` 子进程 + 最小 env 白名单 —— 爆炸半径为一个进程。见 `child-spawn.ts`。 |
 *
 * ## 为什么用具名类型而不是各处内联字面量联合
 *
 * 加第三个取值时，`'inline' | 'worker'` 这个字面量在 `plugin-host/index.ts`
 * 里内联出现 5 处、`plugin-distribution-manager.ts` 3 处、`server/routes/plugins.ts`
 * 3 处（API 层的入参收窄）。逐个改漏一处，那个入口就会**悄悄退回只认两种模式**：
 * `'process'` 在收窄处被判为 `undefined` → 落到默认 `inline` → 插件**根本没进隔离路径**，
 * 而类型系统不会报任何错（因为收窄本身是合法的）。
 *
 * 这个失效形态最坏的地方在于**它不报错**：管理员选了「进程隔离」，插件却跑在
 * inline 里，界面上看着生效了。故收敛到单一来源，并配
 * `execution-mode.test.ts` 守住「三处 API 入口都认得 process」。
 */
export type PluginExecutionMode = 'inline' | 'worker' | 'process';

/** 需要进程级隔离（而非线程级）的模式 */
export function requiresProcessIsolation(mode: PluginExecutionMode): boolean {
  return mode === 'process';
}

/** 归一化任意来源（DB 字符串 / manifest 字段 / API 入参）到合法模式 */
export function normalizeExecutionMode(raw: unknown): PluginExecutionMode {
  if (raw === 'worker' || raw === 'process' || raw === 'inline') return raw;
  return 'inline';
}

/**
 * 运行时判据：给定值是否是合法的执行模式。
 *
 * 供 API 层收窄入参用（`server/routes/plugins.ts` 的三处）。
 *
 * 为什么必须有它、且必须与 {@link PluginExecutionMode} 同步：
 * 那三处原本写成 `x === 'worker' || x === 'inline' ? x : undefined`。
 * 收窄本身合法，所以**新增第三种模式时若漏改，编译器一声不吭**，
 * 而管理员选了新模式会静默拿到 `undefined` → 默认 `inline` →
 * **插件根本没进隔离路径，界面却显示已生效**。
 */
export function isValidExecutionMode(raw: unknown): raw is PluginExecutionMode {
  return raw === 'inline' || raw === 'worker' || raw === 'process';
}
