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
 *
 * Pitfall 5: This store manages ONLY PluginHost infrastructure state.
 * Application business state (lessons, classes, students) remains in
 * App.tsx's useState hooks.
 */

import { create } from 'zustand';
import { isBuiltinBundleDefaultEnabled } from './builtin-bundles';
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
  /** 已被管理台停用的内置扩展包 id 列表（localStorage 持久）。 */
  /** 用户对内置包的显式启停覆盖（localStorage 持久）；未覆盖时取 builtin-bundles 的 defaultEnabled。 */
  builtinBundleOverrides: Record<string, boolean>;
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

  /** Get all extension point configs for a slot. */
  getExtensions: (slot: AnyExtensionSlot) => ExtensionPointConfig[];

  /** Set dashboard widget visibility for a single plugin. */
  setDashboardVisibility: (pluginId: string, visible: boolean) => void;

  /** Bulk-initialize dashboard visibility (called on app startup). */
  setDashboardVisibilityBatch: (entries: Array<[string, boolean]>) => void;

  /** 内置扩展包是否启用（默认启用）。 */
  isBuiltinBundleEnabled: (bundleId: string) => boolean;

  /** 启用/停用内置扩展包（持久到 localStorage）。停用后由调用方负责注销其扩展点。 */
  setBuiltinBundleEnabled: (bundleId: string, enabled: boolean) => void;
}

// 跨标签页同步（v0.6.1 审计 R-5）：内置包停用 / 仪表盘可见性写入
// localStorage 后，其他标签页经 storage 事件拉平，避免 A 页停用、B 页
// 扩展继续渲染直到手动刷新。
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === BUILTIN_BUNDLES_KEY) {
      usePluginHostStore.setState({ builtinBundleOverrides: loadBuiltinBundleOverrides() });
    } else if (e.key === DASH_VIS_KEY) {
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

// ── localStorage helpers for builtin extension bundles ───────────────
const BUILTIN_BUNDLES_KEY = 'openlearn:builtinBundleEnabled';

function loadBuiltinBundleOverrides(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(BUILTIN_BUNDLES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, Boolean(v)]));
      }
    }
  } catch {}
  return {};
}

function saveBuiltinBundleOverrides(overrides: Record<string, boolean>): void {
  try {
    localStorage.setItem(BUILTIN_BUNDLES_KEY, JSON.stringify(overrides));
  } catch {}
}

export const usePluginHostStore = create<PluginHostStoreState & PluginHostStoreActions>()((set, get) => ({
  // ── Initial state ──────────────────────────────────────────────────
  activePlugins: [],
  extensionPoints: new Map(),
  services: null,
  dashboardVisibility: loadDashboardVisibility(),
  builtinBundleOverrides: loadBuiltinBundleOverrides(),
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

  setDashboardVisibilityBatch: (entries) =>
    set((state) => {
      const next = new Map(state.dashboardVisibility);
      for (const [pluginId, visible] of entries) {
        next.set(pluginId, visible);
      }
      saveDashboardVisibility(next);
      return { dashboardVisibility: next };
    }),

  // ── 内置扩展包（builtin bundles）──
  //
  // 内置扩展包（如 smart-edu）不经过安装链路、没有 DB 行，无法走
  // activePlugins 的启停流。这里以 localStorage 持久的开关给它同等的
  // 「管理台可停用」能力（v0.6.0 审计：此前 main.tsx 开机直注册，
  // 无人能停用、无人能清理其扩展点）。

  // v0.6.1 用户决策：内置包默认停用 —— 启停语义从「黑名单」翻转为
  // 「用户覆盖 + defaultEnabled」（builtin-bundles.ts）。用户从未选择时
  // 以包元数据的 defaultEnabled 为准（国家平台连接器 = false）。
  isBuiltinBundleEnabled: (bundleId) => {
    const override = get().builtinBundleOverrides[bundleId];
    if (typeof override === 'boolean') return override;
    return isBuiltinBundleDefaultEnabled(bundleId);
  },

  setBuiltinBundleEnabled: (bundleId, enabled) =>
    set((state) => {
      const next = { ...state.builtinBundleOverrides, [bundleId]: enabled };
      saveBuiltinBundleOverrides(next);
      return { builtinBundleOverrides: next };
    }),
}));
