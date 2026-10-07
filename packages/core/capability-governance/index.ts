/**
 * OpenLearn Capability Governance - Subsystem Exports
 *
 * ## ⚠️ @experimental —— 未接入真实调用路径，不要在生产插件里依赖
 *
 * 本子系统已在内核启动时实例化并注册进 DI（`kernel/index.ts` 的
 * `CapabilityGovernanceKernel` 与 `ICapabilityGovernanceServiceToken`），但截至
 * D-2 决策（2026-10-07）**没有任何生产代码 resolve 过它** —— 审计项 M-9。
 *
 * 因此：
 * - **已从 `@openlearn/plugin-sdk` 的导出面移除**（随 SDK 3.8.0 minor 发布）。
 *   外部插件若曾 import `ICapabilityGovernanceServiceToken` 会编译失败，这是有意的：
 *   对外承诺一个零消费者的 API，比不承诺更糟。
 * - 内核侧引用不受影响（直接走 `packages/core` 相对路径）。
 * - 若将来接入真实调用路径并稳定，去掉本注释并把导出加回 `index.ts`。
 *
 * 详见 `plugin-system-remediation-tracker.md` 的 F-2 / D-2。
 */

export * from './types/index.js';
export * from './namespace/namespace-manager.js';
export * from './validation/capability-validator.js';
export * from './dependency/dependency-graph.js';
export * from './lifecycle/lifecycle-engine.js';
export * from './policy/policy-engine.js';
export * from './health/health-monitor.js';
export * from './search/search-engine.js';
export * from './export/manifest-exporter.js';
export * from './sdk/governance-sdk.js';
export * from './governance-kernel.js';
