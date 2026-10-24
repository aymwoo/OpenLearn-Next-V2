/**
 * PluginHost zustand store — browser-side state management for FrontendPluginHost.
 *
 * D-01: Uses zustand (already in dependencies) for frontend PluginHost state,
 * avoiding additional useState hooks in App.tsx.
 *
 * State slices:
 * - activePlugins: Array of currently tracked plugin infos
 * - extensionPoints: Map<slot, ExtensionPointConfig[]> — slot-based UI registrations
 * - services: Reference to the FrontendServiceRegistry (set on initialize)
 * - initialized: Boolean flag indicating the host is ready
 * - dashboardVisibility: Map<pluginId, boolean> — per-plugin dashboard widget toggle
 * - pluginErrors: Map<pluginId, string> — 插件前端错误（渲染层显示显式错误态）
 *
 * Pitfall 5: This store manages ONLY PluginHost infrastructure state.
 * Application business state (lessons, classes, students) remains in
 * App.tsx's useState hooks.
 */

import { create } from 'zustand';
import type { FrontendPluginInfo, AnyExtensionSlot, ExtensionPointConfig, PluginState } from './types';
import type { FrontendServiceRegistry } from './service-registry';

// ── State shape ──────────────────────────────────────────────────────────

export interface PluginHostStoreState {
  activePlugins: FrontendPluginInfo[];
  extensionPoints: Map<string, ExtensionPointConfig[]>;
  services: FrontendServiceRegistry | null;
  initialized: boolean;
  /** Per-plugin dashboard widget visibility. true (default, show) | false (hidden). */
  dashboardVisibility: Map<string, boolean>;
  /**
   * 插件前端错误信息（pluginId → 错误描述）。
   *
   * 记录「插件前端加载失败 / 被熔断降级」的事实，供扩展点渲染层显示**显式错误态**
   * （错误文案 + 重试按钮），而不是让贡献条目静默消失 —— 静默消失会让用户以为
   * 插件压根没装（v0.7.0 熔断越权修复）。
   */
  pluginErrors: Map<string, string>;
}

// ── Actions ──────────────────────────────────────────────────────────────

export interface PluginHostStoreActions {
  /** Set services registry and mark as initialized. */
  initialize: (services: FrontendServiceRegistry) => void;

  /** Add a plugin to the active plugins list. */
  addPlugin: (plugin: FrontendPluginInfo) => void;

  /** Remove a plugin by id. */
  removePlugin: (id: string) => void;

  /** Update a plugin's lifecycle state. */
  updatePluginState: (id: string, state: PluginState) => void;

  /**
   * Register an extension point for a given slot.
   * 同 slot 同 id 幂等覆盖（服务重启后 DB UUID 变化 / HMR 重新注册时防崩溃）。
   */
  registerExtensionPoint: (slot: AnyExtensionSlot, config: ExtensionPointConfig) => void;

  /** Unregister a single extension point by slot + id. */
  unregisterExtensionPoint: (slot: AnyExtensionSlot, id: string, ownerPluginId?: string) => void;

  /** Unregister all extension points belonging to a plugin. */
  unregisterPluginExtensionPoints: (pluginId: string) => void;

  /**
   * 仅摘除插件**运行时**注册的扩展点，保留 manifest 声明式贡献。
   *
   * 熔断降级与激活失败走这条路径：插件的前端 bundle 起不来，不代表它的
   * 声明式贡献（Tab / 命令面板项 / 画布调色板项）不可用 —— 那些贡献的执行
   * 后端在服务端插件宿主，与前端无关。整包摘除会让用户看到 Tab「闪现后消失」。
   */
  unregisterPluginRuntimeExtensionPoints: (pluginId: string) => void;

  /** Get all extension point configs for a slot. */
  getExtensions: (slot: AnyExtensionSlot) => ExtensionPointConfig[];

  /** Set dashboard widget visibility for a single plugin. */
  setDashboardVisibility: (pluginId: string, visible: boolean) => void;

  /** 记录插件前端错误（激活失败 / 熔断降级）—— 渲染层据此显示显式错误态。 */
  setPluginError: (pluginId: string, message: string) => void;

  /** 清除插件前端错误（重新激活成功时调用）。 */
  clearPluginError: (pluginId: string) => void;

  /** Bulk-initialize dashboard visibility (called on app startup). */
  setDashboardVisibilityBatch: (entries: Array<[string, boolean]>) => void;
}

// 跨标签页同步：仪表盘可见性写入 localStorage 后，其他标签页经
// storage 事件拉平，避免 A 页隐藏、B 页仍显示。
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === DASH_VIS_KEY) {
      usePluginHostStore.setState({ dashboardVisibility: loadDashboardVisibility() });
    }
  });
}

// ── localStorage helpers for dashboard visibility ─────────────────────
const DASH_VIS_KEY = 'openlearn:dashboardVisibility';

function loadDashboardVisibility(): Map<string, boolean> {
  try {
    const raw = localStorage.getItem(DASH_VIS_KEY);
    if (raw) return new Map(JSON.parse(raw));
  } catch {}
  return new Map();
}

function saveDashboardVisibility(map: Map<string, boolean>): void {
  try {
    localStorage.setItem(DASH_VIS_KEY, JSON.stringify([...map.entries()]));
  } catch {}
}

export const usePluginHostStore = create<PluginHostStoreState & PluginHostStoreActions>()((set, get) => ({
  // ── Initial state ──────────────────────────────────────────────────
  activePlugins: [],
  extensionPoints: new Map(),
  services: null,
  dashboardVisibility: loadDashboardVisibility(),
  pluginErrors: new Map(),
  initialized: false,

  // ── Actions ────────────────────────────────────────────────────────

  initialize: (services) => set({ services, initialized: true }),

  addPlugin: (plugin) =>
    set((state) => ({
      activePlugins: [...state.activePlugins, plugin],
    })),

  removePlugin: (id) =>
    set((state) => ({
      activePlugins: state.activePlugins.filter((p) => p.id !== id),
    })),

  updatePluginState: (id, state) =>
    set((prev) => ({
      activePlugins: prev.activePlugins.map((p) => (p.id === id ? { ...p, state } : p)),
    })),

  registerExtensionPoint: (slot, config) =>
    set((state) => {
      const existing = state.extensionPoints.get(slot) ?? [];
      const dup = existing.find((e) => e.id === config.id);
      if (dup) {
        // 归属守卫（v0.6.1 审计 R-2）：同 (slot,id) 仅允许**同一插件**覆盖
        // （HMR / 服务重启重注册场景）；跨插件覆盖 = 扩展点劫持（可伪装
        // 别家 label/slotProps 或顶掉内置包），拒绝并告警。
        if (dup.pluginId !== config.pluginId) {
          console.warn(
            `[PluginHost] Extension point "${slot}/${config.id}" is owned by plugin "${dup.pluginId}"; ` +
              `registration from "${config.pluginId}" was rejected (cross-plugin overwrite).`,
          );
          return state;
        }
        // Widget IDs are globally unique per slot by convention.
        // Always overwrite on duplicate to handle re-registration after
        // server restart (new DB UUID) or HMR without crashing.
        const updated = new Map(state.extensionPoints);
        updated.set(
          slot,
          existing.map((e) => (e.id === config.id ? config : e)),
        );
        return { extensionPoints: updated };
      }
      const updated = new Map(state.extensionPoints);
      updated.set(slot, [...existing, config]);
      return { extensionPoints: updated };
    }),

  unregisterExtensionPoint: (slot, id, ownerPluginId?) =>
    set((state) => {
      const existing = state.extensionPoints.get(slot);
      if (!existing) return state;
      // 归属守卫（v0.6.1 审计 R-2）：提供 ownerPluginId 时只允许摘除自己的
      // 扩展点（ctx.ui.unregisterExtensionPoint 由插件调用，宿主注入其 id）
      const target = existing.find((e) => e.id === id);
      if (!target) return state;
      if (ownerPluginId && target.pluginId !== ownerPluginId) {
        console.warn(
          `[PluginHost] Plugin "${ownerPluginId}" cannot unregister extension point "${slot}/${id}" ` +
            `owned by "${target.pluginId}".`,
        );
        return state;
      }
      const filtered = existing.filter((e) => e.id !== id);
      const updated = new Map(state.extensionPoints);
      if (filtered.length === 0) {
        updated.delete(slot);
      } else {
        updated.set(slot, filtered);
      }
      return { extensionPoints: updated };
    }),

  unregisterPluginExtensionPoints: (pluginId) =>
    set((state) => {
      const updated = new Map(state.extensionPoints);
      for (const [slot, configs] of updated) {
        const filtered = configs.filter((c) => c.pluginId !== pluginId);
        if (filtered.length === 0) {
          updated.delete(slot);
        } else {
          updated.set(slot, filtered);
        }
      }
      return { extensionPoints: updated };
    }),

  unregisterPluginRuntimeExtensionPoints: (pluginId) =>
    set((state) => {
      const updated = new Map(state.extensionPoints);
      let changed = false;
      for (const [slot, configs] of updated) {
        // origin 缺省视为 'runtime' —— 历史注册路径全部是命令式注册
        const filtered = configs.filter((c) => c.pluginId !== pluginId || c.origin === 'manifest');
        if (filtered.length !== configs.length) {
          changed = true;
          if (filtered.length === 0) {
            updated.delete(slot);
          } else {
            updated.set(slot, filtered);
          }
        }
      }
      return changed ? { extensionPoints: updated } : state;
    }),

  getExtensions: (slot) => {
    const list = get().extensionPoints.get(slot) ?? [];
    // 按 position 升序排序（缺省 100），同一 slot 内跨插件稳定排序。
    // 锚点槽位（anchor:*）同样适用：同侧多个插件按钮按 position 排列。
    return [...list].sort((a, b) => (a.position ?? 100) - (b.position ?? 100));
  },

  setDashboardVisibility: (pluginId, visible) =>
    set((state) => {
      const next = new Map(state.dashboardVisibility);
      next.set(pluginId, visible);
      saveDashboardVisibility(next);
      return { dashboardVisibility: next };
    }),

  setPluginError: (pluginId, message) =>
    set((state) => {
      const next = new Map(state.pluginErrors);
      next.set(pluginId, message);
      return { pluginErrors: next };
    }),

  clearPluginError: (pluginId) =>
    set((state) => {
      if (!state.pluginErrors.has(pluginId)) return state;
      const next = new Map(state.pluginErrors);
      next.delete(pluginId);
      return { pluginErrors: next };
    }),

  setDashboardVisibilityBatch: (entries) =>
    set((state) => {
      const next = new Map(state.dashboardVisibility);
      for (const [pluginId, visible] of entries) {
        next.set(pluginId, visible);
      }
      saveDashboardVisibility(next);
      return { dashboardVisibility: next };
    }),
}));
