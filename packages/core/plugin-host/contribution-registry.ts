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

/**
 * v0.2.6: A contribution to an `anchor:*` slot — a button injected
 * immediately before/after a host-defined anchor button.
 */
export interface AnchorToolConfig {
  id: string;
  label: string;
  icon?: string;
  /** Relative position to the host anchor button. Defaults to 'after'. */
  placement?: 'before' | 'after';
}

/** V3.2: A contribution to the help.plugin_docs slot (plugin documentation in help page). */
export interface HelpDocConfig {
  id: string;
  title: string;
  description?: string;
  /** URL to markdown documentation content */
  markdownUrl?: string;
}

/** A contribution to the classroom.quick_activity slot (interactive quick tools). */
export interface QuickActivityConfig {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  category?: string;
  commandType?: string;
  payload?: Record<string, unknown>;
}

/**
 * A contribution to `editor.timeline_segment` that declares a custom lesson segment type.
 * When `labelZh` + `labelEn` are present, the host bridges the entry into the segment-type
 * registry (SegmentEditorCard type dropdown). Pure UI panel plugins should register a
 * React component via `ctx.ui.registerExtensionPoint` instead.
 */
export interface TimelineSegmentConfig {
  id: string;
  labelZh: string;
  labelEn: string;
  icon?: string;
  color?: string;
  defaultDurationMin?: number;
}

/**
 * A contribution to `editor.palette_item` (custom lesson-palette / whiteboard widgets).
 * The host bridges data-shaped entries into `paletteItemRegistry` so they appear in the
 * LessonPalette grid (search, favorites, groups). Prefer `ctx.ui.registerPaletteItem` when
 * providing a custom canvas `component`.
 */
export interface PaletteItemContributionConfig {
  id: string;
  type: string;
  labelZh: string;
  labelEn: string;
  descriptionZh?: string;
  descriptionEn?: string;
  icon?: string;
  color?: string;
  group?: string;
  category?: 'media' | 'interactive' | 'container' | 'custom';
  defaultData?: Record<string, unknown>;
  editFields?: unknown[];
}

/** A contribution to the teacher.cockpit.widget slot (learning radar cards). */
export interface CockpitWidgetConfig {
  id: string;
  title: string;
  icon?: string;
  position?: number;
  width?: 'full' | 'half' | 'third';
}

/** A contribution to the stage.display.card slot (large projector display cards). */
export interface StageCardConfig {
  id: string;
  title: string;
  icon?: string;
  theme?: 'dark' | 'light' | 'accent';
}

/** A contribution to the classroom.topbar.action slot (custom action buttons in the unified 48px topbar). */
export interface ClassroomTopbarActionConfig {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  badge?: string | number;
  commandType?: string;
  payload?: Record<string, unknown>;
}

/** A contribution to the classroom.attribution.award slot (custom award criteria in point awarding modal). */
export interface ClassroomAttributionAwardConfig {
  id: string;
  dimensionId: string;
  name: string;
  description: string;
  icon?: string;
  defaultDeltaPoints: number;
}

/** A contribution to the student.profile.dimension slot (custom competency radar dimensions). */
export interface StudentCompetencyDimensionConfig {
  id: string;
  label: string;
  key: string;
  maxScore?: number;
  defaultWeight?: number;
  icon?: string;
  category?: 'cognitive' | 'practice' | 'collaboration' | 'focus' | 'custom';
}

/** A contribution to the student.profile.card slot (custom widgets inside student growth profile). */
export interface StudentProfileWidgetConfig {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  placement?: 'sidebar' | 'content' | 'footer';
  order?: number;
}

/** A contribution to the whiteboard.canvas.widget slot (draggable interactive canvas widgets). */
export interface CanvasWidgetConfig {
  id: string;
  title: string;
  component: string;
  description?: string;
  icon?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  resizable?: boolean;
}

/** A contribution to the classroom.barometer.metric slot (rhythm barometer metric gauge). */
export interface BarometerMetricConfig {
  id: string;
  label: string;
  icon?: string;
  valueSource?: string;
  color?: string;
  tooltip?: string;
}

/** A contribution to the peer_review.rubric.dimension slot (custom rubric assessment dimensions). */
export interface PeerReviewRubricConfig {
  id: string;
  name: string;
  description?: string;
  maxScore?: number;
  weight?: number;
  icon?: string;
  targetMetric?: string;
}

/** A contribution to the peer_review.badge slot (custom peer nomination micro-badges). */
export interface PeerReviewBadgeConfig {
  id: string;
  title: string;
  emoji?: string;
  description?: string;
  color?: string;
  points?: number;
}

/** A contribution to the classroom.preclass.passcode_action slot. */
export interface PreclassPasscodeActionConfig {
  id: string;
  label: string;
  icon?: string;
  order?: number;
  command?: string;
}

/** A contribution to the classroom.preclass.passcode_addon slot. */
export interface PreclassPasscodeAddonConfig {
  id: string;
  title: string;
  description?: string;
  order?: number;
}

/** A contribution to the command_palette.item slot (global command palette Ctrl+K). */
export interface CommandPaletteItemConfig {
  id: string;
  title: string;
  category?: string;
  description?: string;
  keywords?: string[];
  commandType?: string;
  shortcut?: string;
  payload?: Record<string, unknown>;
}

/** A contribution to the quick_insert.item slot (slash insert menu /). */
export interface QuickInsertItemConfig {
  id: string;
  title: string;
  category?: string;
  description?: string;
  icon?: string;
  keywords?: string[];
  commandType?: string;
  payload?: Record<string, unknown>;
}

/** A contribution to the ai.prompt.template slot (AI prompt engineering templates). */
export interface AIPromptTemplateConfig {
  id: string;
  title: string;
  description?: string;
  category?: string;
  prompt: string;
  parameters?: Array<{ name: string; label: string; default?: string }>;
}

/** A contribution to the ai.skill.provider slot (AI tool & function calling capabilities). */
export interface AISkillProviderConfig {
  id: string;
  name: string;
  description: string;
  parametersSchema?: Record<string, unknown>;
  commandType?: string;
}

/** A contribution to the class.tab slot. */
export interface ClassTabConfig {
  id: string;
  label: string;
  icon?: string;
  position?: number;
}

/** A contribution to the class.batch.action slot. */
export interface ClassBatchActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the student.row.panel slot. */
export interface StudentRowPanelConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the editor.header.action slot. */
export interface EditorHeaderActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the classroom.post_class.widget slot. */
export interface PostClassWidgetConfig {
  id: string;
  title: string;
  icon?: string;
  position?: number;
}

/** A contribution to the courseware.viewer.toolbar slot. */
export interface CoursewareViewerToolbarConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the courseware.viewer.overlay slot. */
export interface CoursewareViewerOverlayConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the classroom.portal.telemetry slot. */
export interface PortalTelemetryConfig {
  id: string;
  label: string;
  icon?: string;
  valueSource?: string;
}

/** A contribution to the classroom.portal.course_badge slot. */
export interface PortalCourseBadgeConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the classroom.portal.teaching_mode slot. */
export interface PortalTeachingModeConfig {
  id: string;
  title: string;
  description?: string;
  icon?: string;
}

/** A contribution to the classroom.portal.insight slot. */
export interface PortalInsightConfig {
  id: string;
  title: string;
  description?: string;
}

/** A contribution to the classroom.portal.preflight slot. */
export interface PortalPreflightConfig {
  id: string;
  label: string;
  description?: string;
}

/** A contribution to the classroom.portal.launch_action slot. */
export interface PortalLaunchActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the classroom.countdown.widget slot. */
export interface CountdownWidgetConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the classroom.countdown.action slot. */
export interface CountdownActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the student.classroom.countdown slot. */
export interface StudentCountdownConfig {
  id: string;
  title: string;
}

/** A contribution to the student.quick_actions.item slot. */
export interface StudentQuickActionsItemConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the student.quick_actions.action slot. */
export interface StudentQuickActionsActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the student.quick_actions.fab slot. */
export interface StudentQuickActionsFabConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the classroom.notification.tabs slot. */
export interface NotificationTabsConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the classroom.pacing.dashboard slot. */
export interface PacingDashboardConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the classroom.diagnostic.feed slot. */
export interface DiagnosticFeedConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the classroom.collab.canvas slot. */
export interface CollabCanvasConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the classroom.topbar.pill slot. */
export interface TopbarPillConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the classroom.attribution.action slot. */
export interface AttributionActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the classroom.leaderboard.action slot. */
export interface LeaderboardActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the student.profile.action slot. */
export interface StudentProfileActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the student.profile.timeline_item slot. */
export interface StudentProfileTimelineItemConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the classroom.header.action slot. */
export interface ClassroomHeaderActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the classroom.agenda.action slot. */
export interface ClassroomAgendaActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the whiteboard.dock.plugin slot. */
export interface WhiteboardDockPluginConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the classroom.audit.event slot. */
export interface ClassroomAuditEventConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the peer_review.action slot. */
export interface PeerReviewActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the peer_review.showcase.widget slot. */
export interface PeerReviewShowcaseWidgetConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the classroom.seating.toolbar slot. */
export interface SeatingToolbarConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the classroom.seating.legend slot. */
export interface SeatingLegendConfig {
  id: string;
  label: string;
  color?: string;
  icon?: string;
}

/** A contribution to the classroom.seating.seat_badge slot. */
export interface SeatingSeatBadgeConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the classroom.seating.seat_actions slot. */
export interface SeatingSeatActionsConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the classroom.seating.summary slot. */
export interface SeatingSummaryConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the whiteboard.autosave.status slot. */
export interface WhiteboardAutosaveStatusConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the whiteboard.autosave.action slot. */
export interface WhiteboardAutosaveActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the teacher.panel slot. */
export interface TeacherPanelConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the student.fullscreen slot. */
export interface StudentFullscreenConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the global.setting slot. */
export interface GlobalSettingConfig {
  id: string;
  title: string;
  description?: string;
  icon?: string;
}

/** A contribution to the nav.user_menu slot. */
export interface NavUserMenuConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the course.list.toolbar.action slot. */
export interface CourseListToolbarActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the course.card.action slot. */
export interface CourseCardActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the course.card.badge slot. */
export interface CourseCardBadgeConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the editor.segment.action slot. */
export interface EditorSegmentActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the classroom.cockpit.drawer.item slot. */
export interface ClassroomCockpitDrawerItemConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the classroom.alert.banner slot. */
export interface ClassroomAlertBannerConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the classroom.stage.display.ticker slot. */
export interface ClassroomStageDisplayTickerConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the classroom.post_class.exporter slot. */
export interface ClassroomPostClassExporterConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the timetable.toolbar.action slot. */
export interface TimetableToolbarActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the timetable.card.badge slot. */
export interface TimetableCardBadgeConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the computer_lab.toolbar.action slot. */
export interface ComputerLabToolbarActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the computer_lab.seat.overlay slot. */
export interface ComputerLabSeatOverlayConfig {
  id: string;
  label?: string;
  icon?: string;
}

/** A contribution to the student.dashboard.hero_widget slot. */
export interface StudentDashboardHeroWidgetConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the student.assignment.toolbar.action slot. */
export interface StudentAssignmentToolbarActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the student.lesson.notes_addon slot. */
export interface StudentLessonNotesAddonConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the student.lesson.toolbox slot. */
export interface StudentLessonToolboxConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the admin.dashboard.card slot. */
export interface AdminDashboardCardConfig {
  id: string;
  title: string;
  icon?: string;
}

/** A contribution to the admin.user.action slot. */
export interface AdminUserActionConfig {
  id: string;
  label: string;
  icon?: string;
  commandType?: string;
}

/** A contribution to the header.status_pill slot. */
export interface HeaderStatusPillConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the ai_sidebar.tab slot. */
export interface AISidebarTabConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the assignment.grade.toolbar.action slot. */
export interface AssignmentGradeToolbarActionConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the assignment.grade.item.addon slot. */
export interface AssignmentGradeItemAddonConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the assignment.grade.rubric.addon slot. */
export interface AssignmentGradeRubricAddonConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the student.segment.gate_fallback slot. */
export interface StudentSegmentGateFallbackConfig {
  id: string;
  label: string;
  icon?: string;
}

/** A contribution to the editor.segment.type_config slot. */
export interface EditorSegmentTypeConfigConfig {
  id: string;
  segmentType: string;
  label?: string;
  icon?: string;
}

/** Union of all contribution config shapes, keyed by slot name. */
export type ContributionConfig =
  | ClassroomToolConfig
  | TeacherTabConfig
  | DashboardWidgetConfig
  | StudentViewConfig
  | StudentLessonToolConfig
  | AnchorToolConfig
  | HelpDocConfig
  | QuickActivityConfig
  | TimelineSegmentConfig
  | PaletteItemContributionConfig
  | CockpitWidgetConfig
  | StageCardConfig
  | ClassroomTopbarActionConfig
  | ClassroomAttributionAwardConfig
  | StudentCompetencyDimensionConfig
  | StudentProfileWidgetConfig
  | CanvasWidgetConfig
  | BarometerMetricConfig
  | PeerReviewRubricConfig
  | PeerReviewBadgeConfig
  | PreclassPasscodeActionConfig
  | PreclassPasscodeAddonConfig
  | CommandPaletteItemConfig
  | QuickInsertItemConfig
  | AIPromptTemplateConfig
  | AISkillProviderConfig
  | ClassTabConfig
  | ClassBatchActionConfig
  | StudentRowPanelConfig
  | EditorHeaderActionConfig
  | PostClassWidgetConfig
  | CoursewareViewerToolbarConfig
  | CoursewareViewerOverlayConfig
  | PortalTelemetryConfig
  | PortalCourseBadgeConfig
  | PortalTeachingModeConfig
  | PortalInsightConfig
  | PortalPreflightConfig
  | PortalLaunchActionConfig
  | CountdownWidgetConfig
  | CountdownActionConfig
  | StudentCountdownConfig
  | StudentQuickActionsItemConfig
  | StudentQuickActionsActionConfig
  | StudentQuickActionsFabConfig
  | NotificationTabsConfig
  | PacingDashboardConfig
  | DiagnosticFeedConfig
  | CollabCanvasConfig
  | TopbarPillConfig
  | AttributionActionConfig
  | LeaderboardActionConfig
  | StudentProfileActionConfig
  | StudentProfileTimelineItemConfig
  | ClassroomHeaderActionConfig
  | ClassroomAgendaActionConfig
  | WhiteboardDockPluginConfig
  | ClassroomAuditEventConfig
  | PeerReviewActionConfig
  | PeerReviewShowcaseWidgetConfig
  | SeatingToolbarConfig
  | SeatingLegendConfig
  | SeatingSeatBadgeConfig
  | SeatingSeatActionsConfig
  | SeatingSummaryConfig
  | WhiteboardAutosaveStatusConfig
  | WhiteboardAutosaveActionConfig
  | TeacherPanelConfig
  | StudentFullscreenConfig
  | GlobalSettingConfig
  | NavUserMenuConfig
  | CourseListToolbarActionConfig
  | CourseCardActionConfig
  | CourseCardBadgeConfig
  | EditorSegmentActionConfig
  | ClassroomCockpitDrawerItemConfig
  | ClassroomAlertBannerConfig
  | ClassroomStageDisplayTickerConfig
  | ClassroomPostClassExporterConfig
  | TimetableToolbarActionConfig
  | TimetableCardBadgeConfig
  | ComputerLabToolbarActionConfig
  | ComputerLabSeatOverlayConfig
  | StudentDashboardHeroWidgetConfig
  | StudentAssignmentToolbarActionConfig
  | StudentLessonNotesAddonConfig
  | StudentLessonToolboxConfig
  | AdminDashboardCardConfig
  | AdminUserActionConfig
  | HeaderStatusPillConfig
  | AISidebarTabConfig
  | AssignmentGradeToolbarActionConfig
  | AssignmentGradeItemAddonConfig
  | AssignmentGradeRubricAddonConfig
  | StudentSegmentGateFallbackConfig
  | EditorSegmentTypeConfigConfig;

/** A human-readable summary of what a plugin contributes. */
export interface ContributionSummary {
  slot: string;
  count: number;
  items: Array<{ id: string; label: string }>;
}

/**
 * The shape of the manifest.contributes section.
 *
 * Loose boundary: keys are slot names (固定槽位 or `anchor:*` 锚点槽位).
 * Values are config arrays. Declared as `Record<string, unknown>` because the
 * zod schema `.passthrough()` preserves anchor:* keys without statically typing
 * them; validation of individual entries happens at runtime.
 */
export type ContributesSection = Record<string, unknown>;

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
      if (!Array.isArray(configs) || configs.length === 0) continue;

      if (!this.contributions.has(slot)) {
        this.contributions.set(slot, new Map());
      }
      this.contributions.get(slot)!.set(pluginId, configs as ContributionConfig[]);
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

  /**
   * Return all raw contribution entries for extension bridge synchronization.
   */
  listAll(): Array<{ slot: string; pluginId: string; configs: ContributionConfig[] }> {
    const result: Array<{ slot: string; pluginId: string; configs: ContributionConfig[] }> = [];
    for (const [slot, slotMap] of this.contributions) {
      for (const [pluginId, configs] of slotMap) {
        result.push({ slot, pluginId, configs });
      }
    }
    return result;
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
