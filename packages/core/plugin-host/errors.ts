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
 * PluginCapabilityDeniedError — 插件缺少必需能力，调用被拒绝（Issue #225）。
 *
 * 此前「未声明 student-data:write 却要写学生积分」这类调用只是打一条告警便放行，
 * 属于「事后可见、事前不拦」。现在改为真正阻断，并保留 pluginId / 能力名 /
 * 操作类型 / 方法名，便于审计与追溯。
 */
export class PluginCapabilityDeniedError extends PluginHostError {
  constructor(
    public readonly pluginId: string,
    public readonly requiredCapability: string,
    public readonly operation: 'read' | 'write',
    public readonly method: string,
  ) {
    super(
      `Plugin "${pluginId}" denied: ${operation === 'read' ? '读取' : '写入'}学生数据需要 ` +
        `'${requiredCapability}' 能力（调用 ${method} 被拒绝）`,
    );
    this.name = 'PluginCapabilityDeniedError';
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
    super(`Illegal state transition for plugin "${pluginId}": ${from} → ${to}`);
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
        `Please upgrade the host or use a compatible plugin version.`,
    );
    this.name = 'SemverMismatchError';
  }
}

// ── Phase 7: Hot Reload Errors ───────────────────────────────────────────

/**
 * PluginDispatchTimeoutError — inline 插件 HTTP/SSE 派发超时（审计 R-1）。
 *
 * 修复前 inline 路径直接调用 `httpRouter.handle(req)`，网关传入的 timeoutMs
 * 被静默丢弃 —— inline 插件一个不 resolve 的 handler 会永久占住 Express
 * 连接。消息含 "timed out" 以命中网关既有的 504 判定，与 worker 路径同一契约。
 */
export class PluginDispatchTimeoutError extends PluginHostError {
  constructor(
    public readonly pluginId: string,
    public readonly timeoutMs: number,
  ) {
    super(`Plugin "${pluginId}" request timed out after ${timeoutMs}ms`);
    this.name = 'PluginDispatchTimeoutError';
  }
}

/**
 * HotReloadError — 热重载失败时抛出。
 */
export class HotReloadError extends PluginHostError {
  constructor(
    message: string,
    public readonly pluginId: string,
    public readonly filePath: string,
  ) {
    super(`Hot reload failed for "${pluginId}": ${message}`);
    this.name = 'HotReloadError';
  }
}

/**
 * HotReloadActivationError — 热重载中新版本激活失败时抛出。
 */
export class HotReloadActivationError extends HotReloadError {
  constructor(
    pluginId: string,
    filePath: string,
    public readonly cause: Error,
  ) {
    super(`Activation of new version failed: ${cause.message}`, pluginId, filePath);
    this.name = 'HotReloadActivationError';
  }
}

// ── Phase 7: Middleware Errors ────────────────────────────────────────────

/**
 * MiddlewareError — 中间件执行异常（非致命，用于日志记录）。
 */
export class MiddlewareError extends PluginHostError {
  constructor(
    public readonly pluginId: string,
    public readonly phase: string,
    message: string,
  ) {
    super(`Middleware error in phase "${phase}" for "${pluginId}": ${message}`);
    this.name = 'MiddlewareError';
  }
}

// ── Phase 8: Signature & Distribution Verification Errors (Issue #143) ───────

/**
 * PluginSignatureError — 插件包完整性或发布者签名错误基类。
 */
export class PluginSignatureError extends PluginHostError {
  constructor(
    public readonly pluginId: string,
    public readonly code: string,
    message: string,
  ) {
    super(`Signature verification failed for "${pluginId}" [${code}]: ${message}`);
    this.name = 'PluginSignatureError';
  }
}

export class PluginIntegrityRequiredError extends PluginSignatureError {
  constructor(pluginId: string, message = '社区插件包必须声明 integrity (SHA-256)') {
    super(pluginId, 'COMMUNITY_INTEGRITY_REQUIRED', message);
    this.name = 'PluginIntegrityRequiredError';
  }
}

export class PluginAttestationRequiredError extends PluginSignatureError {
  constructor(pluginId: string, message = '社区插件包必须包含有效发布者签名') {
    super(pluginId, 'COMMUNITY_ATTESTATION_REQUIRED', message);
    this.name = 'PluginAttestationRequiredError';
  }
}

export class PluginIntegrityMismatchError extends PluginSignatureError {
  constructor(
    pluginId: string,
    message = `Integrity verification failed for plugin "${pluginId}". Downloaded ZIP checksum does not match repository metadata.`,
  ) {
    super(
      pluginId,
      'COMMUNITY_INTEGRITY_MISMATCH',
      message.includes('Integrity verification failed')
        ? message
        : `Integrity verification failed for plugin "${pluginId}": ${message}`,
    );
    this.name = 'PluginIntegrityMismatchError';
  }
}

export class PluginSignatureInvalidError extends PluginSignatureError {
  constructor(pluginId: string, message = '发布者签名无效或未在信任公钥列表中') {
    super(pluginId, 'COMMUNITY_SIGNATURE_INVALID', message);
    this.name = 'PluginSignatureInvalidError';
  }
}
// ── Issue #142: Declarative Migration Errors ──────────────────────────────

/**
 * PluginMigrationError — 插件数据库迁移异常基类。
 */
export class PluginMigrationError extends PluginHostError {
  constructor(
    public readonly pluginId: string,
    message: string,
  ) {
    super(`Plugin "${pluginId}" migration failed: ${message}`);
    this.name = 'PluginMigrationError';
  }
}

/**
 * PluginMigrationExecutionError — 插件单步迁移 SQL 执行失败且已回滚事务。
 */
export class PluginMigrationExecutionError extends PluginMigrationError {
  constructor(
    pluginId: string,
    public readonly migrationName: string,
    public readonly cause: Error,
  ) {
    super(pluginId, `Execution of migration "${migrationName}" failed: ${cause.message}`);
    this.name = 'PluginMigrationExecutionError';
  }
}

/**
 * PluginMigrationDowngradeError — 插件版本降级被拒绝（数据库版本高于插件包声明版本）。
 */
export class PluginMigrationDowngradeError extends PluginMigrationError {
  constructor(
    pluginId: string,
    public readonly currentDbVersion: number,
    public readonly packageVersion: number,
  ) {
    super(
      pluginId,
      `Downgrade rejected: Database has migration version ${currentDbVersion}, but package only declares version ${packageVersion}. Downgrading plugin database schema is not permitted.`,
    );
    this.name = 'PluginMigrationDowngradeError';
  }
}
