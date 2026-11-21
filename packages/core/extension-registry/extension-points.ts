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

import fs from 'node:fs';
import path from 'node:path';
import { CONTRIBUTES_SLOT_KEYS } from '../esm-loader/manifest-schema.js';

/** manifest 中的 `locales` 不是扩展点 slot，只是语言包声明。 */
const MANIFEST_SLOT_KEYS = CONTRIBUTES_SLOT_KEYS.filter((key) => key !== 'locales');

export const ALL_EXTENSION_POINTS: Readonly<Record<string, { readonly id: string }>> = Object.freeze(
  Object.fromEntries(MANIFEST_SLOT_KEYS.map((id) => [id, Object.freeze({ id })])),
);

export type ExtensionPointId = keyof typeof ALL_EXTENSION_POINTS;

export type ExtensionSlotMode = 'strict' | 'warn' | 'lenient';

let lastUnknownSlots: ReadonlyArray<string> = [];
let invalidModeWarned = false;

/**
 * 解析 OPENLEARN_EXTENSION_STRICT_SLOTS。未设置/非法值回退 warn。
 * NODE_ENV=production 不会自动升级为 strict，严格模式必须显式声明。
 */
export function resolveExtensionSlotMode(
  raw: string | undefined = process.env.OPENLEARN_EXTENSION_STRICT_SLOTS,
): ExtensionSlotMode {
  if (raw === 'strict' || raw === 'warn' || raw === 'lenient') return raw;
  if (raw && !invalidModeWarned) {
    invalidModeWarned = true;
    console.warn(
      `[ExtensionPoints] 非法 OPENLEARN_EXTENSION_STRICT_SLOTS="${raw}"，已回退为 warn（可选：strict|warn|lenient）`,
    );
  }
  return 'warn';
}

/** 最近一次 warn 模式忽略的未知 slot，供健康接口读取。 */
export function getUnknownExtensionSlots(): ReadonlyArray<string> {
  return lastUnknownSlots;
}

export function isExtensionPointId(value: string): value is ExtensionPointId {
  return Object.prototype.hasOwnProperty.call(ALL_EXTENSION_POINTS, value);
}

function recordUnknownSlots(unknown: ReadonlyArray<string>, mode: ExtensionSlotMode): void {
  lastUnknownSlots = Object.freeze([...unknown]);
  console.warn(
    `[ExtensionPoints] ${unknown.length} 个未知 slot 被忽略（mode=${mode}）：${unknown.join(', ')}；请升级对应插件。`,
  );

  // 测试环境不落盘，避免污染工作树。
  if (process.env.NODE_ENV === 'test') return;

  try {
    const logPath = path.resolve(process.cwd(), '_extension-points-unknown.log');
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      mode,
      count: unknown.length,
      unknown,
    });
    fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch (err) {
    console.warn('[ExtensionPoints] 未知 slot 日志写入失败（已降级为 console）：', err);
  }
}

/**
 * 启动期对账：registry 中出现的 slot 必须属于 canonical 名单；manifest 声明
 * 也必须与 canonical 完全一致。
 *
 * 安全边界：
 * - `manifest` 缺失/未知 = 平台自身清单漂移，任何 mode 都 fail-fast；
 * - `registry` 未知 slot = 第三方 manifest passthrough，按 mode 处理：
 *   - strict：throw（Phase 1 行为）
 *   - warn（默认）：console.warn + 落盘 + 返回 { ok: true, unknown }
 *   - lenient：静默忽略未知项
 */
export function assertExtensionPointsAligned(
  registrySlots: readonly string[],
  manifestSlots: readonly string[],
  mode: ExtensionSlotMode = resolveExtensionSlotMode(),
): { ok: boolean; unknown: string[] } {
  const canonical = new Set(Object.keys(ALL_EXTENSION_POINTS));
  const manifest = new Set(manifestSlots.filter((slot) => slot !== 'locales'));
  const registry = new Set(registrySlots);

  const missingInManifest = [...canonical].filter((slot) => !manifest.has(slot)).sort();
  const unknownInManifest = [...manifest].filter((slot) => !canonical.has(slot)).sort();
  const unknownInRegistry = [...registry].filter((slot) => !canonical.has(slot)).sort();

  const manifestProblems: string[] = [];
  if (missingInManifest.length > 0) {
    manifestProblems.push(`manifest 缺少 slot: ${missingInManifest.join(', ')}`);
  }
  if (unknownInManifest.length > 0) {
    manifestProblems.push(`manifest 声明了未知 slot: ${unknownInManifest.join(', ')}`);
  }
  if (manifestProblems.length > 0) {
    throw new Error(`[ExtensionPoints] 扩展点清单不一致：${manifestProblems.join('；')}`);
  }

  if (unknownInRegistry.length === 0) {
    lastUnknownSlots = Object.freeze([]);
    return { ok: true, unknown: [] };
  }

  if (mode === 'strict') {
    throw new Error(`[ExtensionPoints] 扩展点清单不一致：registry 注册了未知 slot: ${unknownInRegistry.join(', ')}`);
  }

  if (mode === 'lenient') {
    lastUnknownSlots = Object.freeze([]);
    return { ok: true, unknown: [] };
  }

  recordUnknownSlots(unknownInRegistry, mode);
  return { ok: true, unknown: unknownInRegistry };
}
