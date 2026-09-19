import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { PaletteItemConfig } from './paletteConfig';

export class PaletteItemRegistry {
  private store = createStore<{
    items: Map<string, { config: PaletteItemConfig; pluginId?: string }>;
  }>(() => ({
    items: new Map(),
  }));

  /**
   * 注册第三方插件贡献的备课画板组件
   * @param config 组件配置
   * @param pluginId 插件唯一 ID
   */
  register(config: PaletteItemConfig, pluginId?: string): void {
    const resolvedPluginId = pluginId || config.pluginId;
    this.store.setState((state) => {
      const next = new Map(state.items);
      next.set(config.type, { config: { ...config, pluginId: resolvedPluginId }, pluginId: resolvedPluginId });
      return { items: next };
    });
  }

  /**
   * 注销指定类型的组件
   * @param type 组件类型
   * @param pluginId 插件唯一 ID（带 pluginId 时校验所有权）
   */
  unregister(type: string, pluginId?: string): void {
    this.store.setState((state) => {
      const entry = state.items.get(type);
      if (!entry) return state;
      if (pluginId && entry.pluginId !== pluginId) return state;
      const next = new Map(state.items);
      next.delete(type);
      return { items: next };
    });
  }

  /**
   * 卸载特定插件贡献的所有备课组件（插件停用/卸载时由宿主自动调用）
   * @param pluginId 插件唯一 ID
   */
  unregisterPlugin(pluginId: string): void {
    this.store.setState((state) => {
      let changed = false;
      const next = new Map(state.items);
      for (const [type, entry] of state.items) {
        if (entry.pluginId === pluginId) {
          next.delete(type);
          changed = true;
        }
      }
      return changed ? { items: next } : state;
    });
  }

  /**
   * 获取指定类型的组件配置
   */
  get(type: string): PaletteItemConfig | undefined {
    return this.store.getState().items.get(type)?.config;
  }

  /**
   * 获取当前已注册的所有插件组件列表
   */
  getAll(): PaletteItemConfig[] {
    return Array.from(this.store.getState().items.values()).map((e) => e.config);
  }

  /**
   * 检查指定类型是否由插件注册
   */
  has(type: string): boolean {
    return this.store.getState().items.has(type);
  }

  /**
   * 获取内部响应式 Store
   */
  getStore() {
    return this.store;
  }
}

export const paletteItemRegistry = new PaletteItemRegistry();

/**
 * React Hook：响应式订阅已注册的插件备课画板组件列表
 *
 * 注意：选择器体每次调用都会 `Array.from(...).map(...)` 出一个新数组，而
 * `useStore` 底层是 `useSyncExternalStore`（用 `Object.is` 比较快照）。
 * 若不包 `useShallow`，React 会永远认为快照已变化，每次提交都强制重渲染，
 * 直到抛 `Maximum update depth exceeded`。
 */
export function usePluginPaletteItems(): PaletteItemConfig[] {
  return useStore(
    paletteItemRegistry.getStore(),
    useShallow((state) => Array.from(state.items.values()).map((e) => e.config)),
  );
}
