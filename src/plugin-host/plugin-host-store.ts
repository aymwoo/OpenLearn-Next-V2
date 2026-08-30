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
   * Pitfall 3: Throws if duplicate id for the same slot.
   */
  registerExtensionPoint: (slot: AnyExtensionSlot, config: ExtensionPointConfig) => void;

  /** Unregister a single extension point by slot + id. */
  unregisterExtensionPoint: (slot: AnyExtensionSlot, id: string) => void;

  /** Unregister all extension points belonging to a plugin. */
  unregisterPluginExtensionPoints: (pluginId: string) => void;

  /** Get all extension point configs for a slot. */
  getExtensions: (slot: AnyExtensionSlot) => ExtensionPointConfig[];

  /** Set dashboard widget visibility for a single plugin. */
  setDashboardVisibility: (pluginId: string, visible: boolean) => void;

  /** Bulk-initialize dashboard visibility (called on app startup). */
  setDashboardVisibilityBatch: (entries: Array<[string, boolean]>) => void;
}

// ── Store ────────────────────────────────────────────────────────────────

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

export const usePluginHostStore = create<PluginHostStoreState & PluginHostStoreActions>()(
  (set, get) => ({
    // ── Initial state ──────────────────────────────────────────────────
    activePlugins: [],
    extensionPoints: new Map(),
    services: null,
    dashboardVisibility: loadDashboardVisibility(),
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
        activePlugins: prev.activePlugins.map((p) =>
          p.id === id ? { ...p, state } : p,
        ),
      })),

    registerExtensionPoint: (slot, config) =>
      set((state) => {
        const existing = state.extensionPoints.get(slot) ?? [];
        const dup = existing.find((e) => e.id === config.id);
        if (dup) {
          // Widget IDs are globally unique per slot by convention.
          // Always overwrite on duplicate to handle re-registration after
          // server restart (new DB UUID) or HMR without crashing.
          const updated = new Map(state.extensionPoints);
          updated.set(slot, existing.map(e => e.id === config.id ? config : e));
          return { extensionPoints: updated };
        }
        const updated = new Map(state.extensionPoints);
        updated.set(slot, [...existing, config]);
        return { extensionPoints: updated };
      }),

    unregisterExtensionPoint: (slot, id) =>
      set((state) => {
        const existing = state.extensionPoints.get(slot);
        if (!existing) return state;
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
  }),
);
