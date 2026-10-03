/**
 * Worker 插件 manifest 能力声明的提取与归一化。
 *
 * ## 为什么需要这个文件
 *
 * `ServiceHost` 的 Security Barrier 2（`service-host.ts`）按
 * `manifestCapabilities` 判定：数组为空时只允许 `get*` 只读方法。
 * 该数组的源头是 `activateWorkerPlugin` 合成的 `FrontendPluginManifest`。
 * 若这里拿不到插件真实声明的 `capabilitiesProposed`，**所有** worker 模式插件
 * 都会被降级成只读 —— 数据链在 `/api/plugins` 响应 → store → manifest 之间
 * 任一环断开都会导致这种静默失效。
 *
 * ## 数据来源与优先级
 *
 * 1. `GET /api/plugins` 每条记录上的 `capabilitiesProposed` 字段
 *    （由 `server/routes/plugins.ts` 从 `plugins.manifest` JSON 解析后补齐）；
 * 2. 回退：`record.manifest` 原始 JSON 字符串中的 `capabilitiesProposed`
 *    （服务端未升级 / 缓存旧响应时仍可用）；
 * 3. 都没有 → `[]`（安全回退，走 Barrier 2 最严分支）。
 *
 * 字段名与形态与 `packages/core/esm-loader/manifest-schema.ts` 的
 * `capabilitiesProposed: z.array(z.string()).optional()` 保持一致：
 * 字符串数组，且整体可缺失。
 *
 * @module
 */

/** 插件列表记录的最小形状（对应 `GET /api/plugins` 的元素）。 */
export interface PluginListRecordLike {
  /** 服务端补齐的扁平字段（可选，旧响应无此字段）。 */
  capabilitiesProposed?: unknown;
  /** 原始 manifest JSON 字符串（回退来源）。 */
  manifest?: unknown;
}

/**
 * 把任意来源的 capability 声明归一化为 `string[]`。
 *
 * 非数组、含非字符串元素、null/undefined 一律过滤掉；
 * 归一化后为空则返回 `[]`（触发 Barrier 2 只读分支）。
 */
function normalizeCapabilities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string' && c.length > 0);
}

/**
 * 从插件列表记录中提取其 manifest 声明的 `capabilitiesProposed`。
 *
 * 绝不抛异常：manifest 解析失败、字段缺失、类型不符均回退为 `[]`。
 *
 * @param record - `GET /api/plugins` 的单条插件记录
 * @returns 归一化后的 capability 字符串数组（可能为空）
 */
export function resolveDeclaredCapabilities(record: PluginListRecordLike | null | undefined): string[] {
  if (!record || typeof record !== 'object') return [];

  // 1. 服务端补齐的扁平字段优先
  const direct = normalizeCapabilities(record.capabilitiesProposed);
  if (direct.length > 0) return direct;

  // 2. 回退：解析原始 manifest JSON 字符串
  const rawManifest = record.manifest;
  if (typeof rawManifest === 'string' && rawManifest.length > 0) {
    try {
      return normalizeCapabilities(JSON.parse(rawManifest)?.capabilitiesProposed);
    } catch {
      return [];
    }
  }
  if (rawManifest && typeof rawManifest === 'object') {
    return normalizeCapabilities((rawManifest as { capabilitiesProposed?: unknown }).capabilitiesProposed);
  }

  return [];
}
