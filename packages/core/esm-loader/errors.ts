/**
 * Named error classes for the EsmLoader subsystem.
 *
 * Each error carries contextual information to aid debugging.
 * Error messages follow the project logging convention
 * (`[EsmLoader]` prefix tags).
 *
 * D-14: 继承层次 — EsmLoaderError 基类，子类携带特定上下文属性。
 */

/**
 * EsmLoaderError — ESM 加载器子系统所有错误的基类。
 */
export class EsmLoaderError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(`[EsmLoader] ${message}`, options);
    this.name = 'EsmLoaderError';
  }
}

/**
 * EsmSyntaxError — 插件代码包含语法错误的加载失败。
 */
export class EsmSyntaxError extends EsmLoaderError {
  constructor(
    message: string,
    options?: { cause?: Error; line?: number; column?: number },
  ) {
    super(message, options);
    this.name = 'EsmSyntaxError';
  }
}

/**
 * EsmModuleNotFoundError — 插件尝试导入不存在的模块。
 */
export class EsmModuleNotFoundError extends EsmLoaderError {
  constructor(
    public readonly specifier: string,
    options?: { cause?: Error },
  ) {
    super(`Module not found: "${specifier}"`, options);
    this.name = 'EsmModuleNotFoundError';
  }
}

/**
 * EsmLoadTimeoutError — 插件加载超时。
 */
export class EsmLoadTimeoutError extends EsmLoaderError {
  constructor(timeoutMs: number, options?: { cause?: Error }) {
    super(`Module load timed out after ${timeoutMs}ms`, options);
    this.name = 'EsmLoadTimeoutError';
  }
}

/**
 * EsmActivationError — 插件激活阶段失败（manifest 校验失败、activate 函数缺失等）。
 */
export class EsmActivationError extends EsmLoaderError {
  constructor(
    public readonly pluginId: string,
    message: string,
    options?: { cause?: Error },
  ) {
    super(`Plugin "${pluginId}" activation failed: ${message}`, options);
    this.name = 'EsmActivationError';
  }
}
