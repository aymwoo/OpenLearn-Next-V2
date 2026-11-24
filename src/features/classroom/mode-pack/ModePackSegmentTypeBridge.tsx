/**
 * 第三方模式包的环节类型桥（阶段 8.1）。
 *
 * 插件在 `contributes['mode.pack'].segmentTypes` 声明自己认领的环节类型时，
 * 宿主自动把它们注册进备课端环节类型选择器（`customSegmentStore`），
 * 避免插件作者还要再调一次 `ctx.ui.registerSegmentType`。
 *
 * 已存在的类型不覆盖（插件显式注册的元数据优先）；插件停用或包消失时按
 * `pluginId` 清理本桥注册的条目。
 */
import { useEffect, useRef } from 'react';
import { Layers } from 'lucide-react';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { useModePackCatalog, type ModePackCatalogEntry } from './useModePackCatalog';
import {
  getAllSegmentTypes,
  registerCustomSegmentType,
  unregisterCustomSegmentType,
} from '../../teacher/lesson-editor/timelineConfig';

/**
 * 同步一次目录 → 环节类型注册表。返回本轮由各插件包持有的类型 id，
 * 供下一次同步做差量清理。
 */
export function applyModePackSegmentTypes(input: {
  packs: readonly ModePackCatalogEntry[];
  previous?: ReadonlyMap<string, readonly string[]>;
  /** 不传表示不按插件激活状态过滤（目录本身就只含已激活插件）。 */
  activePluginIds?: ReadonlySet<string>;
}): Map<string, string[]> {
  const existing = new Set(getAllSegmentTypes().map((type) => type.id));
  const owned = new Set<string>(input.previous ? Array.from(input.previous.values()).flat() : []);
  const next = new Map<string, string[]>();

  for (const pack of input.packs) {
    if (pack.source !== 'plugin' || !pack.pluginId) continue;
    if (input.activePluginIds && !input.activePluginIds.has(pack.pluginId)) continue;

    const multiple = pack.segmentTypes.length > 1;
    const ids: string[] = [];
    for (const type of pack.segmentTypes) {
      if (!type) continue;
      // 已存在的类型：插件自己注册的优先；其它包占用的不抢。
      if (existing.has(type) && !owned.has(type)) continue;
      if (!existing.has(type)) {
        registerCustomSegmentType(
          {
            id: type,
            labelZh: multiple ? `${pack.label} · ${type}` : pack.label,
            labelEn: multiple ? `${pack.labelEn ?? pack.label} · ${type}` : (pack.labelEn ?? pack.label),
            icon: Layers,
          },
          pack.pluginId,
        );
        existing.add(type);
      }
      ids.push(type);
    }
    if (ids.length > 0) next.set(pack.pluginId, ids);
  }

  // 清理上一轮由本桥注册、但本轮不再需要的类型。
  for (const [pluginId, ids] of input.previous ?? []) {
    const keep = new Set(next.get(pluginId) ?? []);
    for (const id of ids) {
      if (!keep.has(id)) unregisterCustomSegmentType(id, pluginId);
    }
  }

  return next;
}

export function ModePackSegmentTypeBridge() {
  const packs = useModePackCatalog();
  const activePlugins = usePluginHostStore((state) => state.activePlugins);
  const registeredRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    // activePlugins 尚未加载时不做过滤/清理，避免启动瞬间把类型全部摘掉。
    const activePluginIds =
      Array.isArray(activePlugins) && activePlugins.length > 0
        ? new Set(activePlugins.map((plugin) => plugin.id).filter(Boolean))
        : undefined;

    registeredRef.current = applyModePackSegmentTypes({
      packs,
      previous: registeredRef.current,
      activePluginIds,
    });
  }, [packs, activePlugins]);

  return null;
}

export default ModePackSegmentTypeBridge;
