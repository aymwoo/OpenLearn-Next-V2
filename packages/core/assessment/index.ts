/**
 * 测评子系统 · 领域模型（Issue #100 / 子 issue #120）。
 *
 * 纯函数 + 纯类型，不依赖 React / express / better-sqlite3。
 * 前端（出题页、作答页）与服务端（判分、发布、统计）共用同一套规则。
 */

export * from './types.js';
export * from './settings.js';
export * from './normalize.js';
export * from './question-types/types.js';
export * from './question-types/builtin.js';
export * from './question-types/registry.js';
export * from './grading.js';
export * from './snapshot.js';
export * from './anonymous.js';
export * from './timing.js';
export * from './serialize.js';
export * from './registry-service.js';
