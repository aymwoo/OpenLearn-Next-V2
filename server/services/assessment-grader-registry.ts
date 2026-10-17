/**
 * 测评题型注册表 —— 服务端引用点（Issue #100 / #120）。
 *
 * 真正的实现与单例在 `packages/core/assessment/registry-service.ts`：
 * 它由内核注册进 DI（`IAssessmentGraderRegistryToken`），插件可 `ctx.resolve` 拿到同一对象。
 * 这里只做转发，避免服务层出现第二个实例（split-brain）。
 */
export { AssessmentGraderRegistry, assessmentGraderRegistry } from '../../packages/core/assessment/registry-service.js';
