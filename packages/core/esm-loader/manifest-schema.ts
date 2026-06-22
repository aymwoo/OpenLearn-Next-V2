/**
 * manifest-schema.ts — manifest.json 的 zod schema 运行时校验。
 *
 * Phase 3 schema (D-04, D-10):
 *   必需字段 id、name、version、main
 *   可选字段 requires、optional、capabilitiesProposed（纯字符串数组）
 *
 * Phase 6 扩展 (D-09, D-10):
 *   requires/optional 条目支持 @scope:IServiceName@^version 格式
 *   旧版 manifestSchemaV3 导出供 Phase 3-5 遗留代码继续使用
 *
 * 在插件安装/激活时校验 manifest.json，早失败并提供精确错误消息。
 */
import { z } from 'zod';

// ── Version 4 schema (Phase 6+) ──────────────────────────────────────────

/**
 * requiresItemSchema — requires/optional 条目的 zod 正则校验。
 *
 * 支持两种格式：
 * 1. `@scope:IServiceName`（无版本——Phase 3 格式，向后兼容）
 * 2. `@scope:IServiceName@^1.0.0`（带语义化版本范围——Phase 6 格式）
 *
 * 版本范围支持：^x.y.z, ~x.y.z, x.y.z（精确）, x.y.z-pre（pre-release）
 * 正则模式为线性（无嵌套量词），无 ReDoS 风险。
 */
const requiresItemSchema = z.string().regex(
  /^@[\w-]+\/[\w-]+:I\w+(?:@[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)?$/,
  { message: 'requires/optional 条目格式无效。需要 @scope/domain:IServiceName 或 @scope/domain:IServiceName@^x.y.z' }
);

/**
 * manifestSchema — 插件 manifest.json 的 zod 运行时校验 schema（Phase 6+ 增强版）。
 *
 * 与 Phase 3 的 manifestSchemaV3 的区别：
 * - requires/optional 条目通过 requiresItemSchema 正则约束，支持 @version
 * - 其他字段与 V3 完全一致
 */
export const manifestSchema = z.object({
  id: z.string().min(1, { error: 'manifest.id 不能为空' }),
  name: z.string().min(1, { error: 'manifest.name 不能为空' }),
  version: z.string().min(1, { error: 'manifest.version 不能为空' }),
  main: z.string().min(1, { error: 'manifest.main 必须指定入口文件路径' }),
  requires: z.array(requiresItemSchema).optional(),
  optional: z.array(requiresItemSchema).optional(),
  capabilitiesProposed: z.array(z.string()).optional(),
}).passthrough();

/**
 * Manifest 类型 — 由 manifestSchema 推导出的 TypeScript 类型。
 */
export type Manifest = z.infer<typeof manifestSchema>;

// ── Version 3 schema (Phase 3-5 backward compatibility) ──────────────────

/**
 * requiresItemV3Schema — Phase 3-5 格式的 requires 条目正则。
 *
 * 仅匹配 @scope:IServiceName（无 @version 后缀）。
 * 供 Phase 8 迁移完成前的遗留代码使用。
 */
const requiresItemV3Schema = z.string().regex(
  /^@[\w-]+\/[\w-]+:I\w+$/,
  { message: 'requires/optional 条目格式无效。需要 @scope/domain:IServiceName' }
);

/**
 * manifestSchemaV3 — Phase 3-5 的旧版 manifest schema（无 @version 支持）。
 *
 * 与 manifestSchema 的唯一区别：requires/optional 使用 requiresItemV3Schema
 * （严格无 @version 后缀格式）。
 *
 * 用途：
 * - Phase 3-5 的代码和测试继续使用此 schema
 * - Phase 8 迁移完成后可移除
 */
export const manifestSchemaV3 = z.object({
  id: z.string().min(1, { error: 'manifest.id 不能为空' }),
  name: z.string().min(1, { error: 'manifest.name 不能为空' }),
  version: z.string().min(1, { error: 'manifest.version 不能为空' }),
  main: z.string().min(1, { error: 'manifest.main 必须指定入口文件路径' }),
  requires: z.array(requiresItemV3Schema).optional(),
  optional: z.array(requiresItemV3Schema).optional(),
  capabilitiesProposed: z.array(z.string()).optional(),
}).passthrough();

/**
 * ManifestV3 类型 — 由 manifestSchemaV3 推导的类型，保留供引用。
 */
export type ManifestV3 = z.infer<typeof manifestSchemaV3>;
