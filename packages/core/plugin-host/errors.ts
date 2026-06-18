/**
 * PluginHost 子系统错误类层次。
 *
 * D-10/D-11: 遵循 packages/core/di/errors.ts 和 packages/core/esm-loader/errors.ts
 * 的精确模式：
 *   1. extends Error（或上级错误类）
 *   2. 构造函数 super(message) 带 [PluginHost] 前缀
 *   3. 设置 this.name = 'ErrorClassName'
 *   4. public readonly 属性携带上下文
 */

import type { PluginState } from './types.js';

/**
 * PluginHostError — 所有 PluginHost 错误的基类。
 *
 * 使用 [PluginHost] 前缀标签，遵循项目日志约定。
 */
export class PluginHostError extends Error {
  constructor(message: string) {
    super(`[PluginHost] ${message}`);
    this.name = 'PluginHostError';
  }
}

/**
 * PluginActivateError — 插件激活失败时抛出。
 *
 * 携带 pluginId 上下文，与 EsmActivationError 模式一致。
 */
export class PluginActivateError extends PluginHostError {
  constructor(
    public readonly pluginId: string,
    message: string,
    options?: { cause?: Error },
  ) {
    super(`Plugin "${pluginId}" activation failed: ${message}`);
    this.name = 'PluginActivateError';
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

/**
 * PluginDeactivateTimeoutError — 插件停用超时时抛出。
 *
 * 携带 pluginId 和超时阈值（毫秒），用于诊断性能问题。
 */
export class PluginDeactivateTimeoutError extends PluginHostError {
  constructor(
    public readonly pluginId: string,
    public readonly timeoutMs: number,
  ) {
    super(`Plugin "${pluginId}" deactivate timed out after ${timeoutMs}ms`);
    this.name = 'PluginDeactivateTimeoutError';
  }
}

/**
 * IllegalStateTransitionError — 非法状态转换时抛出。
 *
 * 携带 pluginId、当前状态和目标状态，辅助调试状态机违规。
 */
export class IllegalStateTransitionError extends PluginHostError {
  constructor(
    public readonly pluginId: string,
    public readonly from: PluginState,
    public readonly to: PluginState,
  ) {
    super(
      `Illegal state transition for plugin "${pluginId}": ${from} → ${to}`,
    );
    this.name = 'IllegalStateTransitionError';
  }
}

/**
 * SemverMismatchError — Token 版本不兼容时抛出。
 *
 * 携带结构化字段供 UI 解析 + 人类可读 message 用于日志。
 * 包含插件 id/名称、冲突 Token 名称、要求范围、实际版本。
 * 在 PluginHost.activatePlugin() 和 PluginHost.installPlugin() 中抛出。
 */
export class SemverMismatchError extends PluginHostError {
  constructor(
    public readonly pluginId: string,
    public readonly pluginName: string,
    public readonly tokenName: string,
    public readonly requiredRange: string,
    public readonly actualVersion: string,
  ) {
    super(
      `Plugin "${pluginName}" (${pluginId}) requires ${tokenName}@${requiredRange}, ` +
      `but host provides ${actualVersion}. ` +
      `Please upgrade the host or use a compatible plugin version.`
    );
    this.name = 'SemverMismatchError';
  }
}
