/**
 * 学案活动类型目录（含第三方插件扩展）。
 *
 * 数据来源：
 * - 内置类型：`packages/core/activity-contract` 的 `XUEAN_ACTIVITY_TYPES`；
 * - 第三方类型：已激活插件 manifest 的 `contributes['xuean.activity.type']`。
 *
 * 命名空间约束：插件声明的类型 id 必须以 `<manifest.id>:` 开头，避免与内置
 * 类型或其它插件冲突；不满足的条目直接丢弃并告警。
 *
 * 该目录是服务端活动类型白名单的唯一事实源，`lesson-activities` 路由的
 * 写入校验也走这里。
 */
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { manifestSchema } from '../../packages/core/esm-loader/manifest-schema.js';
import { XUEAN_ACTIVITY_TYPES } from '../../packages/core/activity-contract/index.js';

export type XueanActivityTypeSource = 'builtin' | 'plugin';

export interface XueanActivityTypeDescriptor {
  id: string;
  label: string;
  labelEn?: string;
  description?: string;
  icon?: string;
  source: XueanActivityTypeSource;
  /** 来源插件 id（source === 'plugin' 时存在） */
  pluginId?: string;
  /** 来源插件展示名（source === 'plugin' 时存在） */
  pluginName?: string;
}

/** `listPlugins()` 返回值中本模块关心的字段（便于单元测试传入最小夹具）。 */
export interface XueanActivityTypePluginRecord {
  id?: string;
  name?: string;
  state?: string;
  status?: string;
  manifest?: string | Record<string, unknown> | null;
}

const BUILTIN_LABELS: Record<string, string> = {
  reading: '阅读',
  submission: '作品提交（练习）',
  quiz: '测验',
  survey: '调查',
  discussion: '讨论',
  courseware: '网页课件',
  scratch: '图形化编程',
  form: '填表',
  other: '其他',
};

function parsePluginManifest(record: XueanActivityTypePluginRecord): Record<string, unknown> | null {
  if (!record.manifest) return null;
  if (typeof record.manifest === 'object') return record.manifest as Record<string, unknown>;
  try {
    return JSON.parse(record.manifest);
  } catch {
    return null;
  }
}

function isActivePlugin(record: XueanActivityTypePluginRecord): boolean {
  return record.state === 'active' || record.status === 'active';
}

/**
 * 从插件列表构建活动类型目录（纯函数，便于测试）。
 */
export function collectXueanActivityTypes(
  plugins: readonly XueanActivityTypePluginRecord[],
): XueanActivityTypeDescriptor[] {
  const descriptors: XueanActivityTypeDescriptor[] = XUEAN_ACTIVITY_TYPES.map((id) => ({
    id,
    label: BUILTIN_LABELS[id] ?? id,
    source: 'builtin' as const,
  }));
  const seen = new Set<string>(descriptors.map((item) => item.id));

  for (const plugin of plugins) {
    if (!isActivePlugin(plugin)) continue;

    const raw = parsePluginManifest(plugin);
    if (!raw) continue;

    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) continue;

    const pluginId = parsed.data.id;
    const pluginName = parsed.data.name;
    const entries = parsed.data.contributes?.['xuean.activity.type'] ?? [];
    for (const entry of entries) {
      const typeId = entry.id;
      // 命名空间约束：插件类型必须是 `<pluginId>:<suffix>`
      if (!typeId.startsWith(`${pluginId}:`)) {
        console.warn(`[xuean-activity-types] 活动类型 "${typeId}" 缺少插件命名空间前缀 "${pluginId}:"，已忽略`);
        continue;
      }
      if (seen.has(typeId)) {
        console.warn(`[xuean-activity-types] 活动类型 id 冲突，已忽略后出现者：${typeId}（插件 ${pluginId}）`);
        continue;
      }
      if (XUEAN_ACTIVITY_TYPES.includes(typeId as (typeof XUEAN_ACTIVITY_TYPES)[number])) {
        continue;
      }
      seen.add(typeId);
      descriptors.push({
        id: typeId,
        label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : typeId,
        ...(typeof entry.labelEn === 'string' && entry.labelEn.trim() ? { labelEn: entry.labelEn.trim() } : {}),
        ...(typeof entry.description === 'string' && entry.description.trim()
          ? { description: entry.description.trim() }
          : {}),
        ...(typeof entry.icon === 'string' && entry.icon.trim() ? { icon: entry.icon.trim() } : {}),
        source: 'plugin',
        pluginId,
        pluginName,
      });
    }
  }

  return descriptors;
}

function readActivePluginRecords(): readonly XueanActivityTypePluginRecord[] {
  try {
    return (kernelContainer.pluginLifecycleManager?.listPlugins() ?? []) as readonly XueanActivityTypePluginRecord[];
  } catch {
    return [];
  }
}

/** 读取当前可用活动类型目录；插件宿主不可用时只返回内置类型。 */
export function listXueanActivityTypes(): XueanActivityTypeDescriptor[] {
  return collectXueanActivityTypes(readActivePluginRecords());
}

/** 校验活动类型是否可用（内置 + 当前激活插件的扩展）。 */
export function isXueanActivityTypeAllowed(type: string): boolean {
  return listXueanActivityTypes().some((item) => item.id === type);
}
