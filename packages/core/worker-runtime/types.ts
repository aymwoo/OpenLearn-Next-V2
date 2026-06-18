/**
 * Worker Runtime 基础类型定义。
 *
 * 为 Worker 隔离子系统提供跨运行时（Node.js Worker Thread / Browser Web Worker）
 * 的标准消息协议类型、运输层接口和类型守卫函数。
 *
 * ## 消息协议
 *
 * ### Worker → Main Thread（6 个类型）
 * - `invoke` — 调用主线程上的服务方法（RPC）
 * - `subscribe` — 订阅主线程上的事件
 * - `unsubscribe` — 取消事件订阅
 * - `activated` — Worker 激活完成信号
 * - `deactivated` — Worker 停用完成信号
 * - `log` — Worker 端日志消息
 *
 * ### Main Thread → Worker（5 个类型）
 * - `result` — RPC 调用成功返回值
 * - `error` — RPC 调用失败错误信息
 * - `event` — 从主线程转发的平台事件
 * - `deactivate-request` — 请求 Worker 停用
 * - `activate` — 激活 Worker 并加载插件
 */

// ── IWorkerTransport ─────────────────────────────────────────────────────────

/**
 * IWorkerTransport — Worker 运输层抽象接口。
 *
 * 定义跨运行时（Node.js Worker Thread / Browser Web Worker）统一的
 * postMessage/onMessage/terminate 操作契约。每个 Worker 实例通过
 * 此接口与主线程通信，运行时差异由具体实现类封装。
 *
 * 实现类：
 * - NodeWorkerTransport — 包装 node:worker_threads.Worker
 * - BrowserWorkerTransport — 包装 Web Worker（Phase 9 stub）
 */
export interface IWorkerTransport {
  /**
   * 发送消息到对端。
   * 消息必须为 structured clone 兼容的数据（无函数、Symbol、DOM 节点等）。
   */
  postMessage(msg: unknown): void;

  /**
   * 注册消息处理器，接收对端发来的消息。
   * 每次调用 replace 上次注册的处理器（单监听者模式适配 postMessage 通道）。
   */
  onMessage(handler: (msg: any) => void): void;

  /**
   * 优雅终止 Worker 连接。
   * 返回 Promise，在 Worker 实际终止后 resolve。
   */
  terminate(): Promise<void>;

  /** Worker 唯一标识符（如 "worker:1" 或 "browser-worker:stub"） */
  readonly id: string;
}

// ── PendingCall ───────────────────────────────────────────────────────────────

/**
 * PendingCall — 等待主线程响应的 RPC 调用记录。
 *
 * ServiceProxy 使用 Map<invokeId, PendingCall> 追踪所有正在进行的
 * 跨 Worker 方法调用。当主线程返回 result 或 error 消息时，
 * 根据 invokeId 找到对应的 PendingCall 并 resolve/reject。
 */
export interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

// ── Worker → Main Thread 消息类型 ─────────────────────────────────────────

/**
 * Worker 向主线程发起服务方法调用（RPC 请求）。
 */
export interface InvokeMessage {
  readonly type: 'invoke';
  readonly invokeId: string;
  readonly token: string;
  readonly method: string;
  readonly args: unknown[];
}

/**
 * Worker 向主线程订阅事件。
 */
export interface SubscribeMessage {
  readonly type: 'subscribe';
  readonly subId: string;
  readonly eventType: string;
}

/**
 * Worker 向主线程取消事件订阅。
 */
export interface UnsubscribeMessage {
  readonly type: 'unsubscribe';
  readonly subId: string;
}

/**
 * Worker 激活完成，通知主线程。
 */
export interface ActivatedMessage {
  readonly type: 'activated';
}

/**
 * Worker 停用完成，通知主线程。
 */
export interface DeactivateMessage {
  readonly type: 'deactivated';
}

/**
 * Worker 端产生的日志消息。
 */
export interface LogMessage {
  readonly type: 'log';
  readonly level: string;
  readonly message: string;
}

/**
 * WorkerMessage — Worker 发给 Main Thread 的联合消息类型。
 *
 * 6 个成员类型，通过 type 字段区分。
 */
export type WorkerMessage =
  | InvokeMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | ActivatedMessage
  | DeactivateMessage
  | LogMessage;

// ── Main Thread → Worker 消息类型 ─────────────────────────────────────────

/**
 * 主线程返回 RPC 调用结果。
 */
export interface ResultMessage {
  readonly type: 'result';
  readonly invokeId: string;
  readonly value: unknown;
}

/**
 * 主线程返回 RPC 调用错误。
 */
export interface ErrorMessage {
  readonly type: 'error';
  readonly invokeId: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
}

/**
 * 主线程向 Worker 转发平台事件。
 */
export interface EventMessage {
  readonly type: 'event';
  readonly subId: string;
  readonly event: {
    readonly id: string;
    readonly type: string;
    readonly source: string;
    readonly payload: unknown;
    readonly timestamp: number;
    readonly correlationId?: string;
  };
}

/**
 * 主线程请求 Worker 执行停用。
 */
export interface DeactivateRequestMessage {
  readonly type: 'deactivate-request';
}

/**
 * 主线程激活 Worker，包含插件代码和 manifest。
 */
export interface ActivateMessage {
  readonly type: 'activate';
  readonly pluginCode: string;
  readonly manifest: unknown;
  readonly serviceTokens: string[];
}

/**
 * MainThreadMessage — Main Thread 发给 Worker 的联合消息类型。
 *
 * 5 个成员类型，通过 type 字段区分。
 */
export type MainThreadMessage =
  | ResultMessage
  | ErrorMessage
  | EventMessage
  | DeactivateRequestMessage
  | ActivateMessage;

// ── 类型守卫函数 ──────────────────────────────────────────────────────────────

/**
 * WorkerMessage 类型守卫：鉴定消息是否为 invoke 类型。
 */
export function isInvokeMessage(msg: unknown): msg is InvokeMessage {
  return (msg as InvokeMessage)?.type === 'invoke';
}

/**
 * WorkerMessage 类型守卫：鉴定消息是否为 subscribe 类型。
 */
export function isSubscribeMessage(msg: unknown): msg is SubscribeMessage {
  return (msg as SubscribeMessage)?.type === 'subscribe';
}

/**
 * MainThreadMessage 类型守卫：鉴定消息是否为 result 类型。
 */
export function isResultMessage(msg: unknown): msg is ResultMessage {
  return (msg as ResultMessage)?.type === 'result';
}

/**
 * MainThreadMessage 类型守卫：鉴定消息是否为 error 类型。
 */
export function isErrorMessage(msg: unknown): msg is ErrorMessage {
  return (msg as ErrorMessage)?.type === 'error';
}

/**
 * MainThreadMessage 类型守卫：鉴定消息是否为 event 类型。
 */
export function isEventMessage(msg: unknown): msg is EventMessage {
  return (msg as EventMessage)?.type === 'event';
}
