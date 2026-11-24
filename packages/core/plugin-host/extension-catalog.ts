/**
 * OpenLearn Platform Kernel - Read-only Extension Catalog
 *
 * 取代已删除的旧扩展注册门面：Catalog 自身不存储、不注册，
 * 只按需聚合四类只读数据源：
 *   - ContributionRegistry 的 slot 贡献
 *   - activity-ecosystem 的活动 provider（由宿主在启动时 attach）
 *   - 各活动体系的静态内置定义（学案 / lesson-engine / 课堂旧协议）
 *   - classroom-runtime 的 hooks
 *   - extension-points 的弃用元数据
 */

import {
  type ActivityDescriptorBase,
  type ActivityKind,
  type ExtensionDeprecationRef,
  type ExtensionHookRef,
  type ExtensionSlotRef,
  type IExtensionCatalog,
  classroomLegacyDescriptors,
  makeActivityId,
  xueanDescriptors,
} from '../activity-contract/index.js';
import { CORE_EXTENSION_POINTS } from '../extension-points/metadata.js';
import { BUILTIN_ACTIVITY_DEFINITIONS } from '../lesson-engine/activity-registry.js';

export interface ExtensionCatalogSources {
  /** ContributionRegistry.listAll() 的扁平化只读投影。 */
  listSlots?: () => ReadonlyArray<ExtensionSlotRef>;
  /** RuntimeHooksManager.listHooks() 的只读投影。 */
  listHooks?: () => ReadonlyArray<ExtensionHookRef>;
}

export class ExtensionCatalog implements IExtensionCatalog {
  private readonly activitySources: Array<() => ReadonlyArray<ActivityDescriptorBase>> = [];

  constructor(private readonly sources: ExtensionCatalogSources = {}) {}

  /**
   * 启动期接线：把动态活动源（如 activity-ecosystem 的 provider 注册表）挂到 Catalog。
   * 这不是“扩展注册”，只允许宿主在 boot 阶段调用；插件侧仍通过各自 registry 注册。
   */
  public attachActivitySource(source: () => ReadonlyArray<ActivityDescriptorBase>): void {
    this.activitySources.push(source);
  }

  public listSlots(): ReadonlyArray<ExtensionSlotRef> {
    return this.sources.listSlots?.() ?? [];
  }

  public listHooks(): ReadonlyArray<ExtensionHookRef> {
    return this.sources.listHooks?.() ?? [];
  }

  public listActivities(kind?: ActivityKind): ReadonlyArray<ActivityDescriptorBase> {
    const all = [...this.builtinDescriptors(), ...this.activitySources.flatMap((source) => source())];
    return kind ? all.filter((descriptor) => descriptor.kind === kind) : all;
  }

  public getDeprecations(): ReadonlyArray<ExtensionDeprecationRef> {
    return CORE_EXTENSION_POINTS.filter((point) => Boolean(point.deprecated)).map((point) => ({
      id: point.id,
      since: point.since,
      removedIn: point.removedIn,
      replacement: point.replacement,
    }));
  }

  private builtinDescriptors(): ActivityDescriptorBase[] {
    const lessonEngine = BUILTIN_ACTIVITY_DEFINITIONS.map((definition) => ({
      kind: 'lesson-engine' as const,
      activityId: makeActivityId('lesson-engine', definition.type),
      title: definition.name,
      category: definition.category,
      description: definition.description,
    }));

    return [...xueanDescriptors(), ...lessonEngine, ...classroomLegacyDescriptors()];
  }
}
