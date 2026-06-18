/**
 * Worker Runtime 结构化错误类层次。
 *
 * 遵循 packages/core/plugin-host/errors.ts 和 packages/core/esm-loader/errors.ts
 * 的精确模式：
 *   1. extends Error（或上级错误类）
 *   2. 构造函数 super(message) 带 [WorkerRuntime] 前缀（仅基类使用）
 *   3. 设置 this.name = 'ErrorClassName'
 *   4. public readonly 属性携带上下文（pluginId, timeoutMs, actorId 等）
 */

/**
 * WorkerRuntimeError — 所有 Worker Runtime 错误的基类。
 *
 * 使用 [WorkerRuntime] 前缀标签，遵循项目日志约定。
 * 支持通过 options.cause 链式传递原始错误（结构化克隆丢失原型链时尤为重要）。
 */
export class WorkerRuntimeError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(`[WorkerRuntime] ${message}`, options);
    this.name = 'WorkerRuntimeError';
  }
}

/**
 * WorkerTransportError — Worker 运输层通信失败时抛出。
 *
 * 触发场景：
 * - postMessage 时 Worker 已终止
 * - 消息序列化/反序列化失败
 * - Worker 非预期退出
 */
export class WorkerTransportError extends WorkerRuntimeError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'WorkerTransportError';
  }
}

/**
 * WorkerActivateError — Worker 端插件激活失败时抛出。
 *
 * 携带 pluginId 上下文，与 PluginActivateError 和 EsmActivationError 模式一致。
 * 消息自动包含 pluginId 以便追踪。
 */
export class WorkerActivateError extends WorkerRuntimeError {
  constructor(
    public readonly pluginId: string,
    message: string,
    options?: { cause?: Error },
  ) {
    super(`Plugin "${pluginId}" activation failed in Worker: ${message}`, options);
    this.name = 'WorkerActivateError';
  }
}

/**
 * WorkerTimeoutError — Worker 操作超时时抛出。
 *
 * 触发场景：
 * - RPC 调用超时（ServiceProxy 发起的 invoke 超过等待时间）
 * - Worker 激活超时（未在时限内收到 'activated' 消息）
 * - Worker 停用超时
 *
 * 携带超时阈值（毫秒）用于诊断性能问题。
 */
export class WorkerTimeoutError extends WorkerRuntimeError {
  constructor(
    public readonly timeoutMs: number,
    message?: string,
    options?: { cause?: Error },
  ) {
    super(message ?? `Worker operation timed out after ${timeoutMs}ms`, options);
    this.name = 'WorkerTimeoutError';
  }
}

/**
 * WorkerCapabilityError — Worker 跨边界能力检查失败时抛出。
 *
 * 当 ServiceHost 检查 Worker 角色的 CapabilityGuard 权限拒绝时抛出。
 * 此错误由主线程的 ServiceHost 在检查能力守卫后，序列化后通过
 * ErrorMessage 发送给 Worker 端反序列化。
 *
 * 注意：此错误不带 options.cause（能力错误从不链式传递）。
 */
export class WorkerCapabilityError extends WorkerRuntimeError {
  constructor(
    public readonly actorId: string,
    public readonly capabilityRequired: string,
    message?: string,
  ) {
    super(
      message ?? `Capability ${capabilityRequired} denied for actor ${actorId}`,
    );
    this.name = 'WorkerCapabilityError';
  }
}

/**
 * WorkerNotSupportedError — 当前运行时不支持的操作。
 *
 * 触发场景：
 * - BrowserWorkerTransport 的所有方法调用（Phase 5 仅 stub）
 * - 未来 Worker runtime 中未实现的功能
 *
 * 仅携带 featureName 标识什么功能尚未实现，不含堆栈信息。
 */
export class WorkerNotSupportedError extends WorkerRuntimeError {
  constructor(featureName: string) {
    super(`'${featureName}' is not implemented in this runtime`);
    this.name = 'WorkerNotSupportedError';
  }
}
