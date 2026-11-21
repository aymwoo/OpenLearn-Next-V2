import { describe, it, expect } from 'vitest';
import { CORE_EXTENSION_POINTS } from '../../extension-points/metadata.js';
import { CONTRIBUTES_SLOT_KEYS } from '../../esm-loader/manifest-schema.js';
import {
  CLASSROOM_LEGACY_ACTIVITIES,
  XUEAN_ACTIVITY_TYPES,
  makeActivityId,
  type ActivityDescriptorBase,
} from '../../activity-contract/index.js';
import { BUILTIN_ACTIVITY_DEFINITIONS } from '../../lesson-engine/activity-registry.js';
import { ExtensionCatalog } from '../extension-catalog.js';

/**
 * 宿主专属 slot：不进入插件 manifest 的 contributes 白名单。
 * - `anchor:*` 是宿主公布的开放命名空间；
 * - `legacy.*` 是待移除的历史槽位。
 */
const HOST_ONLY_SLOT_PATTERNS: ReadonlyArray<RegExp> = [/^anchor:/, /^legacy\./];

describe('扩展声明对账（Phase 0）', () => {
  it('ExtensionPointMetadata 的 slot id 不重复', () => {
    const ids = CORE_EXTENSION_POINTS.filter((point) => point.kind === 'slot').map((point) => point.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('声明的 slot 必须存在于 manifest schema，或属于宿主专属命名空间', () => {
    const manifestSlots = new Set(CONTRIBUTES_SLOT_KEYS);
    const missing = CORE_EXTENSION_POINTS.filter((point) => point.kind === 'slot')
      .map((point) => point.id)
      .filter((id) => !manifestSlots.has(id) && !HOST_ONLY_SLOT_PATTERNS.some((pattern) => pattern.test(id)));

    expect(missing).toEqual([]);
  });
});

describe('ExtensionCatalog（Phase 1）', () => {
  it('聚合 slots、hooks 与动态活动源', () => {
    const catalog = new ExtensionCatalog({
      listSlots: () => [{ slot: 'teacher.tab', pluginId: 'ext-demo', id: 'demo-tab' }],
      listHooks: () => [{ name: 'beforeLessonStart', count: 1 }],
    });
    catalog.attachActivitySource(() => [
      {
        kind: 'provider',
        activityId: makeActivityId('provider', 'official_quiz'),
        title: 'Quiz',
        category: 'assessment',
      } satisfies ActivityDescriptorBase,
    ]);

    expect(catalog.listSlots()).toHaveLength(1);
    expect(catalog.listHooks()).toHaveLength(1);
    expect(catalog.listActivities('provider')).toHaveLength(1);
    expect(catalog.listActivities('xuean')).toHaveLength(XUEAN_ACTIVITY_TYPES.length);
    expect(catalog.listActivities('lesson-engine')).toHaveLength(BUILTIN_ACTIVITY_DEFINITIONS.length);
    expect(catalog.listActivities('classroom-legacy')).toHaveLength(CLASSROOM_LEGACY_ACTIVITIES.length);
    expect(catalog.getDeprecations().length).toBeGreaterThan(0);
  });

  it('所有活动的 activityId 均带命名空间且全局唯一', () => {
    const catalog = new ExtensionCatalog();
    const ids = catalog.listActivities().map((descriptor) => descriptor.activityId);

    expect(ids.every((id) => id.includes(':'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
