/**
 * Named error classes for the EsmLoader subsystem.
 *
 * Each error carries contextual information to aid debugging.
 * Error messages follow the project logging convention
 * (`[EsmLoader]` prefix tags).
 *
 * D-14: 结构化错误类层次 — EsmLoaderError 基类（继承 Error）和 4 个子类。
 * 遵循 packages/core/di/errors.ts 的精确模式：
 *   1. extends Error（或上级错误类）
 *   2. 构造函数 super(message) 带 [EsmLoader] 前缀
 *   3. 设置 this.name = 'ErrorClassName'
 *   4. public readonly 属性携带上下文（specifier, pluginId 等）
 */

/**
 * EsmLoaderError — 所有 ESM 加载错误的基类。
 *
 * 使用 [EsmLoader] 前缀标签，遵循项目日志约定。
 */
export class EsmLoaderError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(`[EsmLoader] ${message}`, options);
    this.name = 'EsmLoaderError';
  }
}

/**
 * EsmSyntaxError — 插件代码包含语法错误时抛出。
 *
 * 可携带 line/column 信息，辅助定位语法错误的具体位置。
 */
export class EsmSyntaxError extends EsmLoaderError {
  constructor(
    message: string,
    options?: { cause?: Error; line?: number; column?: number }
  ) {
    super(message, options);
    this.name = 'EsmSyntaxError';
  }
}

/**
 * EsmModuleNotFoundError — 无法解析模块导入时抛出。
 *
 * 携带无法解析的 specifier 字符串，指示哪个模块未找到。
 */
export class EsmModuleNotFoundError extends EsmLoaderError {
  constructor(
    public readonly specifier: string,
    options?: { cause?: Error }
  ) {
    super(`Module not found: "${specifier}"`, options);
    this.name = 'EsmModuleNotFoundError';
  }
}

/**
 * EsmLoadTimeoutError — 模块加载超过时间限制时抛出。
 *
 * 携带超时阈值（毫秒），用于诊断性能问题。
 */
export class EsmLoadTimeoutError extends EsmLoaderError {
  constructor(
    public readonly timeoutMs: number,
    options?: { cause?: Error }
  ) {
    super(`Module load timed out after ${timeoutMs}ms`, options);
    this.name = 'EsmLoadTimeoutError';
  }
}

/**
 * EsmActivationError — 插件激活失败时抛出。
 *
 * 携带 pluginId 上下文，与 DuplicateRegistrationError (含 tokenName) 模式一致。
 */
export class EsmActivationError extends EsmLoaderError {
  constructor(
    public readonly pluginId: string,
    message: string,
    options?: { cause?: Error }
  ) {
    super(`Plugin "${pluginId}" activation failed: ${message}`, options);
    this.name = 'EsmActivationError';
  }
}
