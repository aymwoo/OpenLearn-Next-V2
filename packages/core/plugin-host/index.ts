/**
 * PluginHost 公共入口（L-2 阶段 2）。
 *
 * 原先 3401 行 / 60 个方法的类已拆成抽象类继承链：
 *   Base → Core → Http → Lifecycle → Reload → Install
 * 各层在同目录下的同名文件。本文件只保留对外的类与 re-export，
 * 以维持既有导入面 `from './plugin-host/index.js'`。
 */

import { PluginHostInstall } from './install.js';

/**
 * 插件宿主 —— 对外唯一入口。
 *
 * 本类不新增任何成员，只作为继承链末端把各层能力组合起来。
 */
export class PluginHost extends PluginHostInstall {}

export { OPENLEARN_VERSION } from '../version.js';
export { validatePluginStateTransition } from './base.js';

// ── Re-exports ────────────────────────────────────────────────────────────

// ── Re-exports ───────────────────────────────────────────────────────────────
export { SemverMismatchError } from './errors.js';
export { PluginRuntimeAdapter, type IPluginRuntime } from './plugin-runtime-adapter.js';
export { PluginRuntimeComposition } from './plugin-runtime-composition.js';
export { PluginContextAdapter, type IUnifiedPluginContext } from './plugin-context-adapter.js';
export { PluginLifecycleManager, type IPluginLifecycleManager } from './plugin-lifecycle-manager.js';
export {
  PluginCapabilityGateway,
  type IPluginCapabilityGateway,
  type CapabilityMetadata,
} from './plugin-capability-gateway.js';
export {
  UnifiedExtensionRegistry,
  type IUnifiedExtensionRegistry,
  type ExtensionItemMetadata,
} from './unified-extension-registry.js';
export {
  PluginDistributionManager,
  LocalRepositoryAdapter,
  type IPluginDistributionManager,
  type IPluginRepositoryAdapter,
  type PluginPackageMetadata,
} from './plugin-distribution-manager.js';
export { PluginHttpRouter, compileRoutePattern } from './http-router.js';
export type { PluginApiRequest, PluginApiResponse, PluginApiHandler, IPluginHttpRouter } from './types.js';
