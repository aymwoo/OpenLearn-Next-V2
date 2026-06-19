/**
 * ExtensionPointRegistry — slot-based registry for frontend extension points.
 *
 * D-04: Slot-based registration pattern. Plugins register UI components via
 *       `ctx.ui.registerExtensionPoint(slot, config)`.
 *
 * Plugins can register components for slots like:
 *   - teacher.tab (navigation tab buttons)
 *   - student.view (student-facing views)
 *   - classroom.tool (in-class tools like rollcall)
 *   - teacher.dashboard.widget (dashboard widget cards)
 *   - student.lesson.tool (lesson-scoped student tools)
 *
 * T-09-04: Throws on duplicate slot+id registration per RESEARCH.md Pitfall 3,
 *          preventing duplicate or competing registrations.
 */

import type { ExtensionSlot, ExtensionPointConfig } from './types';

export class ExtensionPointRegistry {
  /** Internal slot store: slot name -> array of extension point configs */
  private slots = new Map<string, ExtensionPointConfig[]>();

  /**
   * Register an extension point for a given slot.
   *
   * Pushes the config to the slot's array and re-sorts by position (default 100).
   * Throws if a config with the same `id` is already registered for the same `slot`
   * (T-09-04 mitigation against Pitfall 3 — duplicate registrations).
   */
  register(slot: ExtensionSlot | string, config: ExtensionPointConfig): void {
    const items = this.slots.get(slot) ?? [];

    // Dedup check: throw on duplicate id for same slot (Pitfall 3, T-09-04)
    const dup = items.find((item) => item.id === config.id);
    if (dup) {
      throw new Error(
        `Extension point already registered for slot "${slot}" with id "${config.id}"`,
      );
    }

    items.push(config);
    items.sort((a, b) => (a.position ?? 100) - (b.position ?? 100));
    this.slots.set(slot, items);
  }

  /**
   * Get all registered extension point configs for a given slot.
   * Returns a sorted array (by position, ascending). Returns empty array if
   * no extensions are registered for the slot.
   */
  getExtensions(slot: ExtensionSlot | string): ExtensionPointConfig[] {
    return this.slots.get(slot) ?? [];
  }

  /**
   * Unregister a single extension point by slot + id.
   * No-op if the slot or id does not exist.
   */
  unregister(slot: ExtensionSlot | string, id: string): void {
    const items = this.slots.get(slot);
    if (!items) return;
    const filtered = items.filter((item) => item.id !== id);
    if (filtered.length === 0) {
      this.slots.delete(slot);
    } else {
      this.slots.set(slot, filtered);
    }
  }

  /**
   * Unregister all extension points belonging to a specific plugin.
   * Removes the config from all slots where pluginId matches.
   */
  unregisterByPlugin(pluginId: string): void {
    for (const [slot, configs] of this.slots) {
      const filtered = configs.filter((c) => c.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.slots.delete(slot);
      } else {
        this.slots.set(slot, filtered);
      }
    }
  }

  /**
   * Dispose all registered extension points.
   * Clears all slots. Used during host teardown.
   */
  dispose(): void {
    this.slots.clear();
  }
}
