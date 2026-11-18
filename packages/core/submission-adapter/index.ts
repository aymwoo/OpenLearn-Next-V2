/**
 * Submission Adapter — 第三方教学模式的成绩采集扩展点。
 * 官方课件提交与插件提交走同一套 NormalizedSubmission 契约，统一面板聚合展示。
 *
 * Token 声明在 di/interfaces.ts（满足 SDK parity 的 DI 声明点扫描），此处重导出。
 */
export * from './types.js';
export * from './registry.js';
export { createXueanSubmissionAdapter, XUEAN_SUBMISSION_ADAPTER_ID, type XueanAdapterDb } from './xuean-adapter.js';
export { ISubmissionRegistryToken, ISubmissionAggregatorToken } from '../di/interfaces.js';
