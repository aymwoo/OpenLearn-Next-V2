/**
 * 扩展点单一事实源（Phase 1.4，A 方案）。
 *
 * canonical 名单来自 `manifest-schema.ts` 的 `contributes` 键集合——这是安装期
 * 唯一真正会拒绝未知 slot 的白名单。`CORE_EXTENSION_POINTS` 继续承担生命周期/
 * 弃用元数据，`*Config` 接口继续承担 payload 形状；三者不再各自维护一份 slot 名单。
 *
 * 说明：`ALL_EXTENSION_POINTS` 由 manifest 键动态派生，因此 `ExtensionPointId`
 * 在类型层是 `string`。这样做是为了避免再复制一份 115 项的静态清单导致漂移；
 * 运行时可用 `isExtensionPointId()` 做收窄。
 */

import { CONTRIBUTES_SLOT_KEYS } from '../esm-loader/manifest-schema.js';

/** manifest 中的 `locales` 不是扩展点 slot，只是语言包声明。 */
const MANIFEST_SLOT_KEYS = CONTRIBUTES_SLOT_KEYS.filter((key) => key !== 'locales');

export const ALL_EXTENSION_POINTS: Readonly<Record<string, { readonly id: string }>> = Object.freeze(
  Object.fromEntries(MANIFEST_SLOT_KEYS.map((id) => [id, Object.freeze({ id })])),
);

export type ExtensionPointId = keyof typeof ALL_EXTENSION_POINTS;

export function isExtensionPointId(value: string): value is ExtensionPointId {
  return Object.prototype.hasOwnProperty.call(ALL_EXTENSION_POINTS, value);
}

/**
 * 启动期对账：registry 中出现的 slot 必须属于 canonical 名单；manifest 声明
 * 也必须与 canonical 完全一致（防止 schema 更新后派生名单悄悄漂移）。
 *
 * 任何不一致都抛出错误并列出差异，由 kernel 启动流程 fail-fast。
 */
export function assertExtensionPointsAligned(registrySlots: readonly string[], manifestSlots: readonly string[]): void {
  const canonical = new Set(Object.keys(ALL_EXTENSION_POINTS));
  const manifest = new Set(manifestSlots.filter((slot) => slot !== 'locales'));
  const registry = new Set(registrySlots);

  const missingInManifest = [...canonical].filter((slot) => !manifest.has(slot)).sort();
  const unknownInManifest = [...manifest].filter((slot) => !canonical.has(slot)).sort();
  const unknownInRegistry = [...registry].filter((slot) => !canonical.has(slot)).sort();

  const problems: string[] = [];
  if (missingInManifest.length > 0) {
    problems.push(`manifest 缺少 slot: ${missingInManifest.join(', ')}`);
  }
  if (unknownInManifest.length > 0) {
    problems.push(`manifest 声明了未知 slot: ${unknownInManifest.join(', ')}`);
  }
  if (unknownInRegistry.length > 0) {
    problems.push(`registry 注册了未知 slot: ${unknownInRegistry.join(', ')}`);
  }

  if (problems.length > 0) {
    throw new Error(`[ExtensionPoints] 扩展点清单不一致：${problems.join('；')}`);
  }
}
