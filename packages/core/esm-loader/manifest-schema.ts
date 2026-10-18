/**
 * manifest-schema.ts — manifest.json 的 zod schema 运行时校验。
 *
 * Phase 3 schema (D-04, D-10):
 *   必需字段 id、name、version、main
 *   可选字段 requires、optional、capabilitiesProposed（纯字符串数组）
 *
 * Phase 6 扩展 (D-09, D-10):
 *   requires/optional 条目支持 @scope:IServiceName@^version 格式
 *   旧版 manifestSchemaV3 导出供 Phase 3-5 遗留代码继续使用
 *
 * 在插件安装/激活时校验 manifest.json，早失败并提供精确错误消息。
 */
import { z } from 'zod';

// ── V3.0: Contribution schemas ───────────────────────────────────────────

const classroomToolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().optional(),
  description: z.string().optional(),
  commandType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

// ── V5.x：与 contribution-registry.ts 的 ContributionConfig 联合类型一一对应 ──
//
// 审计 E-1：此前本 schema 只枚举 6 个 slot，其余全部落到顶层 `.passthrough()`
// 原样入库 —— 「安装期 schema 校验、而非运行时」的设计承诺对多数 slot 不成立：
// 插件 manifest 里写坏形状的 timeline.segments / palette.items / peer_review.*
// 不会在安装时被拒，而要等到前端渲染对应组件时才炸，排查时现象与病因离得很远。
//
// 下面补全 contribution-registry.ts 已定义的全部 slot。**新增 slot 时请同步
// 两处**（此处校验 + registry 的 Config 接口），并优先在本文件加 zod schema。
// anchor:* 为开放命名空间（宿主公布锚点 id），继续由 passthrough 透传。

const helpDocSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  markdownUrl: z.string().optional(),
});

const quickActivitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  commandType: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const timelineSegmentSchema = z.object({
  id: z.string().min(1),
  labelZh: z.string().min(1),
  labelEn: z.string().min(1),
  icon: z.string().optional(),
  color: z.string().optional(),
  defaultDurationMin: z.number().optional(),
});

const paletteItemSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  labelZh: z.string().min(1),
  labelEn: z.string().min(1),
  icon: z.string().optional(),
  category: z.enum(['media', 'interactive', 'container', 'custom']).optional(),
  defaultData: z.record(z.string(), z.unknown()).optional(),
});

const cockpitWidgetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
  position: z.number().int().optional(),
  width: z.enum(['full', 'half', 'third']).optional(),
});

const stageCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
  theme: z.enum(['dark', 'light', 'accent']).optional(),
});

const classroomTopbarActionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().optional(),
  description: z.string().optional(),
  badge: z.union([z.string(), z.number()]).optional(),
  commandType: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const classroomAttributionAwardSchema = z.object({
  id: z.string().min(1),
  dimensionId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().optional(),
  defaultDeltaPoints: z.number(),
});

const studentCompetencyDimensionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  key: z.string().min(1),
  maxScore: z.number().optional(),
  defaultWeight: z.number().optional(),
  icon: z.string().optional(),
  category: z.enum(['cognitive', 'practice', 'collaboration', 'focus', 'custom']).optional(),
});

const studentProfileWidgetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  placement: z.enum(['sidebar', 'content', 'footer']).optional(),
  order: z.number().int().optional(),
});

const canvasWidgetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  component: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  defaultWidth: z.number().optional(),
  defaultHeight: z.number().optional(),
  resizable: z.boolean().optional(),
});

const barometerMetricSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  valueSource: z.string().optional(),
  color: z.string().optional(),
  tooltip: z.string().optional(),
});

const peerReviewRubricSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  maxScore: z.number().optional(),
  weight: z.number().optional(),
  icon: z.string().optional(),
  targetMetric: z.string().optional(),
});

const peerReviewBadgeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  emoji: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  points: z.number().optional(),
});

const preclassPasscodeActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  order: z.number().int().optional(),
  command: z.string().optional(),
});

const preclassPasscodeAddonSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int().optional(),
});

const commandPaletteItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  commandType: z.string().optional(),
  shortcut: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const quickInsertItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  commandType: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const aiPromptTemplateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  prompt: z.string().min(1),
  parameters: z
    .array(
      z.object({
        name: z.string().min(1),
        label: z.string().min(1),
        default: z.string().optional(),
      }),
    )
    .optional(),
});

const aiSkillProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  parametersSchema: z.record(z.string(), z.unknown()).optional(),
  commandType: z.string().optional(),
});

const classTabSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  position: z.number().int().optional(),
});

const classBatchActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const studentRowPanelSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const editorHeaderActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const postClassWidgetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
  position: z.number().int().optional(),
});

const coursewareViewerToolbarSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const coursewareViewerOverlaySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const portalTelemetrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  valueSource: z.string().optional(),
});

const portalCourseBadgeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
});

const portalTeachingModeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
});

const portalInsightSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
});

const portalPreflightSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

const portalLaunchActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const countdownWidgetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const countdownActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const studentCountdownSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

const studentQuickActionsItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const studentQuickActionsActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const studentQuickActionsFabSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
});

const notificationTabsSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
});

const pacingDashboardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const diagnosticFeedSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const collabCanvasSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
});

const topbarPillSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
});

const attributionActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const leaderboardActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const studentProfileActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const studentProfileTimelineItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const classroomHeaderActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const classroomAgendaActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const whiteboardDockPluginSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const classroomAuditEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const peerReviewActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const peerReviewShowcaseWidgetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const seatingToolbarSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const seatingLegendSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
  icon: z.string().optional(),
});

const seatingSeatBadgeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
});

const seatingSeatActionsSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const seatingSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const whiteboardAutosaveStatusSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
});

const whiteboardAutosaveActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

const teacherPanelSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const studentFullscreenSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const globalSettingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
});

const navUserMenuSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  commandType: z.string().optional(),
});

/**
 * 前端专属 / 演进中的 slot。
 *
 * 这些 slot 的条目不进服务端 ContributionRegistry（由前端
 * `registerExtensionPoint` 消费），但同样声明在 manifest.contributes 里。
 * 校验保持宽松：`id` 必填、其余透传 —— 前端的 ExtensionPointConfig
 * 校验发生在注册时，此处只拦「缺 id」这类结构性错误。
 * 与上方固定 slot 的分工：服务端消费的严格校验，前端消费的宽松兜底。
 *
 * 显式列出而不 spread Object.fromEntries —— spread 进来的值是
 * `ZodArray | undefined`，不满足 zod shape（ZodRawShape）的类型约束。
 */
const frontendSlotEntrySchema = z
  .object({
    id: z.string().min(1),
  })
  .passthrough();

const frontendSlotsShape = {
  'header.action': z.array(frontendSlotEntrySchema).optional(),
  'statusbar.item': z.array(frontendSlotEntrySchema).optional(),
  'stage.display.overlay': z.array(frontendSlotEntrySchema).optional(),
  'stage.display.action': z.array(frontendSlotEntrySchema).optional(),
  'assignment.submission.preview': z.array(frontendSlotEntrySchema).optional(),
  'student.classroom.overlay': z.array(frontendSlotEntrySchema).optional(),
  'student.profile.tab': z.array(frontendSlotEntrySchema).optional(),
  'whiteboard.renderer': z.array(frontendSlotEntrySchema).optional(),
  'timetable.tab': z.array(frontendSlotEntrySchema).optional(),
  'admin.tab': z.array(frontendSlotEntrySchema).optional(),
  'workspace.view': z.array(frontendSlotEntrySchema).optional(),
  // ── 新增 20 个全域业务扩展槽 ──
  'course.list.toolbar.action': z.array(frontendSlotEntrySchema).optional(),
  'course.card.action': z.array(frontendSlotEntrySchema).optional(),
  'course.card.badge': z.array(frontendSlotEntrySchema).optional(),
  'editor.segment.action': z.array(frontendSlotEntrySchema).optional(),
  'classroom.cockpit.drawer.item': z.array(frontendSlotEntrySchema).optional(),
  'classroom.alert.banner': z.array(frontendSlotEntrySchema).optional(),
  'classroom.stage.display.ticker': z.array(frontendSlotEntrySchema).optional(),
  'classroom.post_class.exporter': z.array(frontendSlotEntrySchema).optional(),
  'timetable.toolbar.action': z.array(frontendSlotEntrySchema).optional(),
  'timetable.card.badge': z.array(frontendSlotEntrySchema).optional(),
  'computer_lab.toolbar.action': z.array(frontendSlotEntrySchema).optional(),
  'computer_lab.seat.overlay': z.array(frontendSlotEntrySchema).optional(),
  'computer_lab.seating.toolbar': z.array(frontendSlotEntrySchema).optional(),
  'computer_lab.unassigned.item': z.array(frontendSlotEntrySchema).optional(),
  'computer_lab.seating.sidebar': z.array(frontendSlotEntrySchema).optional(),
  'student.dashboard.hero_widget': z.array(frontendSlotEntrySchema).optional(),
  'student.assignment.toolbar.action': z.array(frontendSlotEntrySchema).optional(),
  'student.lesson.notes_addon': z.array(frontendSlotEntrySchema).optional(),
  'student.lesson.toolbox': z.array(frontendSlotEntrySchema).optional(),
  'admin.dashboard.card': z.array(frontendSlotEntrySchema).optional(),
  'admin.user.action': z.array(frontendSlotEntrySchema).optional(),
  'header.status_pill': z.array(frontendSlotEntrySchema).optional(),
  'ai_sidebar.tab': z.array(frontendSlotEntrySchema).optional(),
} as const;

export const pluginLocalesSchema = z
  .record(
    z.string().min(1, { error: '语言代码不能为空' }),
    z.union([
      z.string().min(1, { error: '语言包文件路径不能为空' }),
      z.record(z.string().min(1), z.string()),
    ]),
  )
  .optional();

const contributesSchema = z
  .object({
    locales: pluginLocalesSchema,
    'classroom.tool': z.array(classroomToolSchema).optional(),
    'teacher.tab': z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          icon: z.string().optional(),
          position: z.number().int().optional(),
        }),
      )
      .optional(),
    'teacher.dashboard.widget': z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          icon: z.string().optional(),
          position: z.number().int().optional(),
        }),
      )
      .optional(),
    'student.view': z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          icon: z.string().optional(),
          route: z.string().optional(),
        }),
      )
      .optional(),
    'student.lesson.tool': z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          icon: z.string().optional(),
        }),
      )
      .optional(),
    // E-1：补全 contribution-registry.ts 已定义的全部服务端 slot
    'classroom.quick_activity': z.array(quickActivitySchema).optional(),
    'timeline.segments': z.array(timelineSegmentSchema).optional(),
    'palette.items': z.array(paletteItemSchema).optional(),
    'teacher.cockpit.widget': z.array(cockpitWidgetSchema).optional(),
    'stage.display.card': z.array(stageCardSchema).optional(),
    'classroom.topbar.action': z.array(classroomTopbarActionSchema).optional(),
    'classroom.attribution.award': z.array(classroomAttributionAwardSchema).optional(),
    'student.profile.dimension': z.array(studentCompetencyDimensionSchema).optional(),
    'student.profile.card': z.array(studentProfileWidgetSchema).optional(),
    'whiteboard.canvas.widget': z.array(canvasWidgetSchema).optional(),
    'classroom.barometer.metric': z.array(barometerMetricSchema).optional(),
    'peer_review.rubric.dimension': z.array(peerReviewRubricSchema).optional(),
    'peer_review.badge': z.array(peerReviewBadgeSchema).optional(),
    'classroom.preclass.passcode_action': z.array(preclassPasscodeActionSchema).optional(),
    'classroom.preclass.passcode_addon': z.array(preclassPasscodeAddonSchema).optional(),
    'help.plugin_docs': z.array(helpDocSchema).optional(),
    // 新增核心能力槽位
    'command_palette.item': z.array(commandPaletteItemSchema).optional(),
    'quick_insert.item': z.array(quickInsertItemSchema).optional(),
    'ai.prompt.template': z.array(aiPromptTemplateSchema).optional(),
    'ai.skill.provider': z.array(aiSkillProviderSchema).optional(),
    // 补齐宿主 UI 槽位
    'class.tab': z.array(classTabSchema).optional(),
    'class.batch.action': z.array(classBatchActionSchema).optional(),
    'student.row.panel': z.array(studentRowPanelSchema).optional(),
    'editor.header.action': z.array(editorHeaderActionSchema).optional(),
    'classroom.post_class.widget': z.array(postClassWidgetSchema).optional(),
    'courseware.viewer.toolbar': z.array(coursewareViewerToolbarSchema).optional(),
    'courseware.viewer.overlay': z.array(coursewareViewerOverlaySchema).optional(),
    'classroom.portal.telemetry': z.array(portalTelemetrySchema).optional(),
    'classroom.portal.course_badge': z.array(portalCourseBadgeSchema).optional(),
    'classroom.portal.teaching_mode': z.array(portalTeachingModeSchema).optional(),
    'classroom.portal.insight': z.array(portalInsightSchema).optional(),
    'classroom.portal.preflight': z.array(portalPreflightSchema).optional(),
    'classroom.portal.launch_action': z.array(portalLaunchActionSchema).optional(),
    'classroom.countdown.widget': z.array(countdownWidgetSchema).optional(),
    'classroom.countdown.action': z.array(countdownActionSchema).optional(),
    'student.classroom.countdown': z.array(studentCountdownSchema).optional(),
    'student.quick_actions.item': z.array(studentQuickActionsItemSchema).optional(),
    'student.quick_actions.action': z.array(studentQuickActionsActionSchema).optional(),
    'student.quick_actions.fab': z.array(studentQuickActionsFabSchema).optional(),
    'classroom.notification.tabs': z.array(notificationTabsSchema).optional(),
    'classroom.pacing.dashboard': z.array(pacingDashboardSchema).optional(),
    'classroom.diagnostic.feed': z.array(diagnosticFeedSchema).optional(),
    'classroom.collab.canvas': z.array(collabCanvasSchema).optional(),
    'classroom.topbar.pill': z.array(topbarPillSchema).optional(),
    'classroom.attribution.action': z.array(attributionActionSchema).optional(),
    'classroom.leaderboard.action': z.array(leaderboardActionSchema).optional(),
    'student.profile.action': z.array(studentProfileActionSchema).optional(),
    'student.profile.timeline_item': z.array(studentProfileTimelineItemSchema).optional(),
    'classroom.header.action': z.array(classroomHeaderActionSchema).optional(),
    'classroom.agenda.action': z.array(classroomAgendaActionSchema).optional(),
    'whiteboard.dock.plugin': z.array(whiteboardDockPluginSchema).optional(),
    'classroom.audit.event': z.array(classroomAuditEventSchema).optional(),
    'peer_review.action': z.array(peerReviewActionSchema).optional(),
    'peer_review.showcase.widget': z.array(peerReviewShowcaseWidgetSchema).optional(),
    'classroom.seating.toolbar': z.array(seatingToolbarSchema).optional(),
    'classroom.seating.legend': z.array(seatingLegendSchema).optional(),
    'classroom.seating.seat_badge': z.array(seatingSeatBadgeSchema).optional(),
    'classroom.seating.seat_actions': z.array(seatingSeatActionsSchema).optional(),
    'classroom.seating.summary': z.array(seatingSummarySchema).optional(),
    'whiteboard.autosave.status': z.array(whiteboardAutosaveStatusSchema).optional(),
    'whiteboard.autosave.action': z.array(whiteboardAutosaveActionSchema).optional(),
    'teacher.panel': z.array(teacherPanelSchema).optional(),
    'student.fullscreen': z.array(studentFullscreenSchema).optional(),
    'global.setting': z.array(globalSettingSchema).optional(),
    'nav.user_menu': z.array(navUserMenuSchema).optional(),
    // 前端专属/演进 slot：宽松兜底（结构性错误仍会被拒）
    ...frontendSlotsShape,
    // v0.2.6: 锚点槽位（anchor:*）为开放命名空间，由宿主公布锚点 id。
    // .passthrough() 保留任意 anchor:* 键（运行时透传），避免被 zod 默认 strip。
    // 锚点条目的运行时校验由前端注册时（ExtensionPointConfig）完成。
  })
  .passthrough()
  .optional();

const deploySchema = z
  .object({
    script: z.string().min(1, { error: 'deploy.script 不能为空' }).optional(),
    staticRoute: z.string().optional(),
    staticDir: z.string().optional(),
  })
  .optional();

// ── V5.2: RESTful API schema ──────────────────────────────────────────

export const apiRouteSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1, { error: 'api route path 不能为空' }),
  auth: z.boolean().optional(),
  roles: z.array(z.string()).optional(),
  rateLimit: z
    .object({
      windowMs: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
});

export const apiSchema = z
  .object({
    /**
     * 声明式 baseRoute —— **无路由作用**（审计 P1）。
     *
     * 全仓无任何代码按此字段挂载或匹配路由：插件 REST 端点的真实路径固定为
     * `/api/plugins/{manifest.id}/*`（见 `server/routes/plugin-api-gateway.ts`）。
     * 该字段历史上暗示「可自选挂载前缀」，实际不生效 —— 误导插件作者把
     * `baseRoute` 当能力用（如声明 `/api/plugins/exam-bank` 而真实路径是
     * `/api/plugins/@teacher/plugin-exam-bank`）。
     *
     * 安装时宿主会对声明了它的 manifest 输出一次告警。将来若实现「按
     * baseRoute 挂载」，告警与本节注释同步移除；若不再需要，下个 major 移除。
     */
    baseRoute: z.string().optional(),
    routes: z.array(apiRouteSchema).optional(),
  })
  .optional();

// ── Version 4 schema (Phase 6+) ──────────────────────────────────────────

/**
 * requiresItemSchema — requires/optional 条目的 zod 正则校验。
 *
 * 支持两种格式：
 * 1. `@scope:IServiceName`（无版本——Phase 3 格式，向后兼容）
 * 2. `@scope:IServiceName@^1.0.0`（带语义化版本范围——Phase 6 格式）
 *
 * 版本范围支持：^x.y.z, ~x.y.z, x.y.z（精确）, x.y.z-pre（pre-release）
 * 正则模式为线性（无嵌套量词），无 ReDoS 风险。
 */
const requiresItemSchema = z.string().regex(/^@[\w-]+\/[\w-]+:I\w+(?:@[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)?$/, {
  message: 'requires/optional 条目格式无效。需要 @scope/domain:IServiceName 或 @scope/domain:IServiceName@^x.y.z',
});

/**
 * manifestSchema — 插件 manifest.json 的 zod 运行时校验 schema（Phase 6+ 增强版）。
 *
 * 与 Phase 3 的 manifestSchemaV3 的区别：
 * - requires/optional 条目通过 requiresItemSchema 正则约束，支持 @version
 * - 其他字段与 V3 完全一致
 */
export const manifestSchema = z
  .object({
    // v0.6.1 审计 C-3：禁止 ':' —— 插件内核 actor 为 `plugin:${manifest.id}`，
    // id 含 ':' 可伪造出 `plugin:@evil:admin` 这类命中 admin 启发式的 actor
    // （角色回退已同时收紧为仅 user: 形态，此处从源头再堵一层）。
    id: z
      .string()
      .min(1, { error: 'manifest.id 不能为空' })
      .refine((v) => !v.includes(':'), { error: 'manifest.id 不能包含 ":"（actor 命名空间保护）' }),
    name: z.string().min(1, { error: 'manifest.name 不能为空' }),
    version: z.string().min(1, { error: 'manifest.version 不能为空' }),
    main: z.string().min(1, { error: 'manifest.main 必须指定入口文件路径' }),
    icon: z.string().optional(),
    description: z.string().optional(),
    author: z.string().optional(),
    requires: z.array(requiresItemSchema).optional(),
    optional: z.array(requiresItemSchema).optional(),
    capabilitiesProposed: z.array(z.string()).optional(),
    network: z
      .object({
        outbound: z.array(z.string().min(1)).optional(),
      })
      .optional(),
    engines: z
      .object({
        openlearn: z.string().min(1),
      })
      .optional(),
    pluginDependencies: z.array(z.string().min(1)).optional(),
    provides: z.array(z.string().min(1)).optional(),
    configuration: z
      .object({
        properties: z
          .record(
            z.string(),
            z.object({
              type: z.enum(['string', 'number', 'boolean', 'integer']),
              default: z.unknown().optional(),
              description: z.string().optional(),
              enum: z.array(z.unknown()).optional(),
              minimum: z.number().optional(),
              maximum: z.number().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    contributes: contributesSchema,
    classroomTools: z.array(z.unknown()).optional(),
    deploy: deploySchema,
    api: apiSchema,
  })
  .passthrough();

/**
 * Manifest 类型 — 由 manifestSchema 推导出的 TypeScript 类型。
 */
export type Manifest = z.infer<typeof manifestSchema>;

// ── Version 3 schema (Phase 3-5 backward compatibility) ──────────────────

/**
 * requiresItemV3Schema — Phase 3-5 格式的 requires 条目正则。
 *
 * 仅匹配 @scope:IServiceName（无 @version 后缀）。
 * 供 Phase 8 迁移完成前的遗留代码使用。
 */
const requiresItemV3Schema = z
  .string()
  .regex(/^@[\w-]+\/[\w-]+:I\w+$/, { message: 'requires/optional 条目格式无效。需要 @scope/domain:IServiceName' });

/**
 * manifestSchemaV3 — Phase 3-5 的旧版 manifest schema（无 @version 支持）。
 *
 * 与 manifestSchema 的唯一区别：requires/optional 使用 requiresItemV3Schema
 * （严格无 @version 后缀格式）。
 *
 * 用途：
 * - Phase 3-5 的代码和测试继续使用此 schema
 * - Phase 8 迁移完成后可移除
 */
export const manifestSchemaV3 = z
  .object({
    id: z.string().min(1, { error: 'manifest.id 不能为空' }),
    name: z.string().min(1, { error: 'manifest.name 不能为空' }),
    version: z.string().min(1, { error: 'manifest.version 不能为空' }),
    main: z.string().min(1, { error: 'manifest.main 必须指定入口文件路径' }),
    icon: z.string().optional(),
    description: z.string().optional(),
    requires: z.array(requiresItemV3Schema).optional(),
    optional: z.array(requiresItemV3Schema).optional(),
    capabilitiesProposed: z.array(z.string()).optional(),
    network: z
      .object({
        outbound: z.array(z.string().min(1)).optional(),
      })
      .optional(),
  })
  .passthrough();

/**
 * ManifestV3 类型 — 由 manifestSchemaV3 推导的类型，保留供引用。
 */
export type ManifestV3 = z.infer<typeof manifestSchemaV3>;
