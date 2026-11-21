/**
 * ⚠️ 本模块是「扩展点弃用账本」，不是运行时扩展注册表。
 * - 不能用于发现"当前有哪些扩展"——请查 packages/core/extension-registry/extension-points.ts
 * - 不能用于注册扩展——请查 contribution-registry / activity-ecosystem / RuntimeHooksManager
 * - 唯一职责：声明哪些扩展点已弃用、何时弃用、替换方案
 *
 * 例外：`compatibility-reporter` 读取 CORE_EXTENSION_POINTS 生成兼容性报告，
 * 属于账本的只读派生视图，不构成"运行时扩展发现"。
 */
export * from './metadata.js';
export * from './compatibility-reporter.js';
