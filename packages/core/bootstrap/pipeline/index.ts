/**
 * OpenLearn Platform Kernel - Bootstrap Pipeline Subsystem Exports (PI-003)
 *
 * 注意：`IBootstrapStage` 由 `../types/index.js` 单一导出（权威定义），
 * 这里不重新导出 `bootstrap-stage.js` 以避免与 types 中的同名 interface
 * 产生 TS2308 重导出歧义。`./bootstrap-stage.ts` 仍保留其本地契约，
 * 但其 `name` 字段已与 types 对齐 (`PlatformStage`)。
 */

export * from './pipeline-types.js';
// IBootstrapStage intentionally NOT re-exported here — it lives in `../types/index.ts`.
export * from './pipeline-executor.js';
export * from './bootstrap-pipeline.js';
export * from './stages/standard-stages.js';
