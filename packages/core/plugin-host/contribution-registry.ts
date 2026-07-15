/**
 * ContributionRegistry — plugin contribution declaration storage.
 *
 * V3.0: Plugins declare UI contributions declaratively in manifest.json.
 * The registry stores these at install time, enabling:
 * - Enumeration without activation (admin preview)
 * - Schema validation at install time (not runtime)
 * - Automatic classroomTools → contributes bridging
 *
 * This layers on top of the existing imperative ctx.ui.registerExtensionPoint() —
 * it does not replace it. The registry is a pre-declaration layer.
 *
 * Design: Two-level index — slot → pluginId → ContributionConfig[]
 */

import type { Manifest } from '../esm-loader/manifest-schema.js';

// ── Contribution Config Types ────────────────────────────────────────────

/** A contribution to the classroom.tool slot (command-triggered toolbar button). */
export interface ClassroomToolConfig {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  commandType: string;
  payload?: Record<string, unknown>;
}

/** A contribution to the teacher.tab slot (navigation tab). */
export interface TeacherTabConfig {
  id: string;
  label: string;
  icon?: string;
  position?: number;
}

/** A contribution to the teacher.dashboard.widget slot (dashboard card). */
export interface DashboardWidgetConfig {
  id: string;
  label: string;
  icon?: string;
  position?: number;
}

/** A contribution to the student.view slot (student-facing view). */
export interface StudentViewConfig {
  id: string;
  label: string;
  icon?: string;
  route?: string;
}

/** A contribution to the student.lesson.tool slot (lesson-scoped student tool). */
export interface StudentLessonToolConfig {
  id: string;
  label: string;
  icon?: string;
}

/** V3.2: A contribution to the help.plugin_docs slot (plugin documentation in help page). */
export interface HelpDocConfig {
  id: string;
  title: string;
  description?: string;
  /** URL to markdown documentation content */
  markdownUrl?: string;
}

/** Union of all contribution config shapes, keyed by slot name. */
export type ContributionConfig =
  | ClassroomToolConfig
  | TeacherTabConfig
  | DashboardWidgetConfig
  | StudentViewConfig
  | StudentLessonToolConfig
  | HelpDocConfig;

/** A human-readable summary of what a plugin contributes. */
export interface ContributionSummary {
  slot: string;
  count: number;
  items: Array<{ id: string; label: string }>;
}

/** The shape of the manifest.contributes section. */
export type ContributesSection = NonNullable<Manifest['contributes']>;

// ── Registry ─────────────────────────────────────────────────────────────

export class ContributionRegistry {
  /** Two-level index: slot name → pluginId → config array */
  private contributions = new Map<string, Map<string, ContributionConfig[]>>();

  // ── Registration ──────────────────────────────────────────────────────

  /**
   * Register all contributions declared by a plugin.
   *
   * Called at install time by PluginHost, before the plugin is activated.
   * If the plugin is reinstalled, old data is automatically replaced.
   *
   * @param pluginId - The manifest.id of the plugin
   * @param contributes - The manifest.contributes section
   */
  register(pluginId: string, contributes: ContributesSection): void {
    // ponytail: clear previous first, handles reinstall
    this.unregister(pluginId);

    for (const [slot, configs] of Object.entries(contributes)) {
      if (!configs || configs.length === 0) continue;

      if (!this.contributions.has(slot)) {
        this.contributions.set(slot, new Map());
      }
      this.contributions.get(slot)!.set(pluginId, configs);
    }
  }

  /**
   * Auto-register classroomTools as contributes['classroom.tool'].
   *
   * Bridges the legacy classroomTools manifest field into the unified
   * contributes model. Called at install time when a manifest has
   * classroomTools but no contributes section.
   */
  registerClassroomTools(pluginId: string, tools: ClassroomToolConfig[]): void {
    if (tools.length === 0) return;

    // Merge into existing classroom.tool contributions if present
    const slot = 'classroom.tool';
    if (!this.contributions.has(slot)) {
      this.contributions.set(slot, new Map());
    }
    const existing = this.contributions.get(slot)!.get(pluginId) ?? [];
    this.contributions.get(slot)!.set(pluginId, [...existing, ...tools]);
  }

  // ── Query ─────────────────────────────────────────────────────────────

  /**
   * Get all contribution configs for a given slot, across all plugins.
   */
  getBySlot(slot: string): ContributionConfig[] {
    const slotMap = this.contributions.get(slot);
    if (!slotMap) return [];
    return Array.from(slotMap.values()).flat();
  }

  /**
   * Get all contributions for a specific plugin, grouped by slot.
   */
  getByPlugin(pluginId: string): Map<string, ContributionConfig[]> {
    const result = new Map<string, ContributionConfig[]>();
    for (const [slot, slotMap] of this.contributions) {
      const configs = slotMap.get(pluginId);
      if (configs && configs.length > 0) {
        result.set(slot, configs);
      }
    }
    return result;
  }

  /**
   * Get a human-readable summary of what a plugin contributes.
   * Used by admin UI to show "this plugin adds 2 classroom tools, 1 tab".
   */
  summary(pluginId: string): ContributionSummary[] {
    const bySlot = this.getByPlugin(pluginId);
    const result: ContributionSummary[] = [];
    for (const [slot, configs] of bySlot) {
      result.push({
        slot,
        count: configs.length,
        items: configs.map((c: any) => ({
          id: c.id,
          label: c.label ?? c.name ?? c.id,
        })),
      });
    }
    return result;
  }

  /**
   * Get summaries for all registered plugins.
   */
  allSummaries(): Array<{ pluginId: string; contributions: ContributionSummary[] }> {
    const pluginIds = new Set<string>();
    for (const slotMap of this.contributions.values()) {
      for (const id of slotMap.keys()) {
        pluginIds.add(id);
      }
    }
    return Array.from(pluginIds).map((pluginId) => ({
      pluginId,
      contributions: this.summary(pluginId),
    }));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Remove all contributions for a plugin.
   * Called at uninstall time by PluginHost.
   */
  unregister(pluginId: string): void {
    for (const slotMap of this.contributions.values()) {
      slotMap.delete(pluginId);
    }
  }

  /**
   * Get counts aggregated across all slots (for dashboard/metrics).
   */
  stats(): { totalPlugins: number; totalContributions: number; bySlot: Record<string, number> } {
    const pluginIds = new Set<string>();
    let totalContributions = 0;
    const bySlot: Record<string, number> = {};

    for (const [slot, slotMap] of this.contributions) {
      for (const [pid, configs] of slotMap) {
        pluginIds.add(pid);
        const count = configs.length;
        totalContributions += count;
        bySlot[slot] = (bySlot[slot] ?? 0) + count;
      }
    }

    return { totalPlugins: pluginIds.size, totalContributions, bySlot };
  }

  /**
   * Clear all contributions. Used in test teardown.
   */
  dispose(): void {
    this.contributions.clear();
  }
}
