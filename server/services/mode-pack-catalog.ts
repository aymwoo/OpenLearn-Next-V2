/**
 * 教学模式包目录（Mode Pack Catalog）。
 *
 * 数据来源：
 * - 内置白板 / 学案包：`packages/core/plugin-host/mode-pack.ts` 的 `BUILTIN_MODE_PACKS`；
 * - 第三方插件包：**已激活**插件 manifest 里的 `contributes['mode.pack']`。
 *
 * 仅返回通过 manifest schema 校验的条目；未激活插件、坏 manifest、重复 id
 * 一律不进目录。重复 id 保留先出现者（内置优先），并记录一条告警。
 *
 * 本模块同时负责「课时绑定模式包」的决议：请求的包不存在时回落白板并给出
 * 原因，避免向导写入一个永远无法渲染的模式。
 */
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { manifestSchema } from '../../packages/core/esm-loader/manifest-schema.js';
import {
  BUILTIN_MODE_PACKS,
  BUILTIN_WHITEBOARD_MODE_PACK_ID,
  BUILTIN_XUEAN_MODE_PACK_ID,
  type ModePackContribution,
} from '../../packages/core/plugin-host/mode-pack.js';
import {
  resolveCourseDeliveryMode,
  type CourseDeliveryMode,
} from '../../packages/core/plugin-host/course-delivery-mode.js';

export type ModePackSource = 'builtin' | 'plugin';

export interface ModePackDescriptor extends ModePackContribution {
  /** 来源：宿主内置 / 第三方插件 */
  source: ModePackSource;
  /** 第三方插件 id（source === 'plugin' 时存在） */
  pluginId?: string;
  /** 第三方插件展示名（source === 'plugin' 时存在） */
  pluginName?: string;
}

/** `listPlugins()` 返回值中本模块关心的字段（便于单元测试传入最小夹具）。 */
export interface ModePackPluginRecord {
  id?: string;
  name?: string;
  state?: string;
  status?: string;
  manifest?: string | Record<string, unknown> | null;
}

export interface LessonModeBinding {
  /** 需要落库的 `lessons.mode_pack_id`；无法解析时为 null */
  modePackId: string | null;
  /** 兼容旧读路径的交付模式（whiteboard / xuean） */
  deliveryMode: CourseDeliveryMode;
  /** 请求的模式不可用而回落时为 true */
  fallback: boolean;
  /** 回落原因，供向导与日志展示 */
  reason?: string;
}

function parsePluginManifest(record: ModePackPluginRecord): Record<string, unknown> | null {
  if (!record.manifest) return null;
  if (typeof record.manifest === 'object') return record.manifest as Record<string, unknown>;
  try {
    return JSON.parse(record.manifest);
  } catch {
    return null;
  }
}

function isActivePlugin(record: ModePackPluginRecord): boolean {
  return record.state === 'active' || record.status === 'active';
}

/**
 * 从插件列表构建模式包目录（纯函数，便于测试）。
 */
export function collectModePacks(plugins: readonly ModePackPluginRecord[]): ModePackDescriptor[] {
  const descriptors: ModePackDescriptor[] = BUILTIN_MODE_PACKS.map((pack) => ({
    ...pack,
    source: 'builtin' as const,
  }));
  const seen = new Set<string>(BUILTIN_MODE_PACKS.map((pack) => pack.id));

  for (const plugin of plugins) {
    if (!isActivePlugin(plugin)) continue;

    const raw = parsePluginManifest(plugin);
    if (!raw) continue;

    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) continue;

    const packs = parsed.data.contributes?.['mode.pack'] ?? [];
    for (const pack of packs) {
      if (seen.has(pack.id)) {
        console.warn(`[mode-pack-catalog] 模式包 id 冲突，已忽略后出现者：${pack.id}（插件 ${parsed.data.id}）`);
        continue;
      }
      seen.add(pack.id);
      descriptors.push({
        ...(pack as ModePackContribution),
        source: 'plugin',
        pluginId: parsed.data.id,
        pluginName: parsed.data.name,
      });
    }
  }

  return descriptors;
}

/**
 * 读取当前可用模式包目录。插件宿主不可用（单测 / 早期启动）时只返回内置包。
 */
export function listModePacks(): ModePackDescriptor[] {
  return collectModePacks(readActivePluginRecords());
}

function readActivePluginRecords(): readonly ModePackPluginRecord[] {
  try {
    return (kernelContainer.pluginLifecycleManager?.listPlugins() ?? []) as readonly ModePackPluginRecord[];
  } catch {
    return [];
  }
}

/** 按 id 查找模式包；未找到返回 null。 */
export function findModePack(
  id: string | null | undefined,
  packs: readonly ModePackDescriptor[] = listModePacks(),
): ModePackDescriptor | null {
  if (typeof id !== 'string' || !id.trim()) return null;
  const wanted = id.trim();
  return packs.find((pack) => pack.id === wanted) ?? null;
}

/**
 * 模式包对应的旧版交付模式。
 *
 * 第三方包按环节类型推断；无法判断时回落白板，保证旧读路径行为不变。
 */
export function modePackDeliveryMode(pack: ModePackContribution): CourseDeliveryMode {
  if (pack.id === BUILTIN_WHITEBOARD_MODE_PACK_ID) return 'whiteboard';
  if (pack.id === BUILTIN_XUEAN_MODE_PACK_ID) return 'xuean';
  if (pack.segmentTypes.some((type) => type === 'xuean' || type.startsWith('xuean:'))) return 'xuean';
  return 'whiteboard';
}

/**
 * 决议课时应当绑定的模式包。
 *
 * - 显式 `modePackId` 可用 → 直接绑定；
 * - 显式 id 不可用 → 回落内置白板（`fallback: true` 并带原因）；
 * - 未传 id（旧客户端 / 向导未升级）→ 按 `deliveryMode` 推导内置包。
 */
export function resolveLessonModeBinding(input: {
  modePackId?: unknown;
  deliveryMode?: unknown;
  packs?: readonly ModePackDescriptor[];
}): LessonModeBinding {
  const packs = input.packs ?? listModePacks();
  const requested = typeof input.modePackId === 'string' && input.modePackId.trim() ? input.modePackId.trim() : null;

  if (requested) {
    const pack = packs.find((candidate) => candidate.id === requested);
    if (pack) {
      return { modePackId: pack.id, deliveryMode: modePackDeliveryMode(pack), fallback: false };
    }
    return {
      modePackId: null,
      deliveryMode: 'whiteboard',
      fallback: true,
      reason: `模式包不可用：${requested}，已回落为白板`,
    };
  }

  const legacy = resolveCourseDeliveryMode(input.deliveryMode);
  const builtinId = legacy === 'xuean' ? BUILTIN_XUEAN_MODE_PACK_ID : BUILTIN_WHITEBOARD_MODE_PACK_ID;
  const pack = packs.find((candidate) => candidate.id === builtinId);
  return {
    modePackId: pack?.id ?? null,
    deliveryMode: pack ? modePackDeliveryMode(pack) : legacy,
    fallback: false,
  };
}
