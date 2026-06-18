/**
 * manifest-schema.ts — manifest.json 的 zod schema 运行时校验。
 *
 * D-04: 最小 manifest.json — 必需字段 id、name、version、main
 * D-10: 独立模块，导出 zod schema 和推导出的 TypeScript 类型
 *
 * 在插件安装时校验 manifest.json，早失败并提供精确错误消息。
 */
import { z } from 'zod';

/**
 * manifestSchema — 插件 manifest.json 的 zod 运行时校验 schema。
 *
 * 必需字段: id, name, version, main（均为非空字符串）
 * 可选字段: requires, optional, capabilitiesProposed（字符串数组）
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
 * Manifest 类型 — 由 manifestSchema 推导出的 TypeScript 类型。
 *
 * 使用 z.infer 确保类型与运行时校验完全一致。
 */
export type Manifest = z.infer<typeof manifestSchema>;
