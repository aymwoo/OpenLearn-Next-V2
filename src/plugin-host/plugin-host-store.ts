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
 *
 * Pitfall 5: This store manages ONLY PluginHost infrastructure state.
 * Application business state (lessons, classes, students) remains in
 * App.tsx's useState hooks.
 */

import { create } from 'zustand';
import type { FrontendPluginInfo, ExtensionSlot, ExtensionPointConfig, PluginState } from './types';
import type { FrontendServiceRegistry } from './service-registry';

// ── State shape ──────────────────────────────────────────────────────────

export interface PluginHostStoreState {
  activePlugins: FrontendPluginInfo[];
  extensionPoints: Map<string, ExtensionPointConfig[]>;
  services: FrontendServiceRegistry | null;
  initialized: boolean;
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
  registerExtensionPoint: (slot: ExtensionSlot, config: ExtensionPointConfig) => void;

  /** Unregister a single extension point by slot + id. */
  unregisterExtensionPoint: (slot: ExtensionSlot, id: string) => void;

  /** Unregister all extension points belonging to a plugin. */
  unregisterPluginExtensionPoints: (pluginId: string) => void;

  /** Get all extension point configs for a slot. */
  getExtensions: (slot: ExtensionSlot) => ExtensionPointConfig[];
}

// ── Store ────────────────────────────────────────────────────────────────

export const usePluginHostStore = create<PluginHostStoreState & PluginHostStoreActions>()(
  (set, get) => ({
    // ── Initial state ──────────────────────────────────────────────────
    activePlugins: [],
    extensionPoints: new Map(),
    services: null,
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
          throw new Error(
            `Extension point already registered for slot "${slot}" with id "${config.id}"`,
          );
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
      return get().extensionPoints.get(slot) ?? [];
    },
  }),
);
