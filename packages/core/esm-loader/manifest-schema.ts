/**
 * manifest-schema.ts — manifest.json 的 zod 运行时校验 schema。
 *
 * D-10: 集中定义 zod schema + 运行时校验 + TypeScript 类型推导。
 * D-04: 最小 manifest.json — 必需字段：id、name、version、main。
 * D-05: optional 字段：requires、optional、capabilitiesProposed 使用 Token 标识符字符串。
 */

import { z } from 'zod';

/**
 * manifestSchema — 插件 manifest.json 的 zod 运行时校验 schema。
 *
 * 必需字段：
 * - id: 插件唯一标识符（如 "ext-countdown-timer"）
 * - name: 人类可读的插件名称
 * - version: 语义化版本号（如 "1.0.0"）
 * - main: 入口文件路径（相对于 ZIP 包根目录）
 *
 * 可选字段：
 * - requires: 必须存在的 Token 服务依赖列表
 * - optional: 可选 Token 服务依赖列表
 * - capabilitiesProposed: 插件请求的 capability 列表
 */
export const manifestSchema = z.object({
  id: z.string().min(1, { error: 'manifest.id 不能为空' }),
  name: z.string().min(1, { error: 'manifest.name 不能为空' }),
  version: z.string().min(1, { error: 'manifest.version 不能为空' }),
  main: z.string().min(1, { error: 'manifest.main 必须指定入口文件路径' }),
  requires: z.array(z.string()).optional(),
  optional: z.array(z.string()).optional(),
  capabilitiesProposed: z.array(z.string()).optional(),
});

/**
 * Manifest — 从 manifestSchema 推导出的 TypeScript 类型。
 */
export type Manifest = z.infer<typeof manifestSchema>;
