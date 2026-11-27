import type { StudentDashboardWidgetId } from '../../../../packages/core/student-ui-policy/index';

export type DashboardWidgetId = StudentDashboardWidgetId;

export type WidgetSize = 'third' | 'half' | 'two-thirds' | 'full';

export interface WidgetLayoutConfig {
  id: DashboardWidgetId;
  size: WidgetSize;
  visible: boolean;
  collapsed?: boolean;
}

export const SIZE_TO_COL_SPAN: Record<WidgetSize, string> = {
  third: 'lg:col-span-4 col-span-1',
  half: 'lg:col-span-6 col-span-1',
  'two-thirds': 'lg:col-span-8 col-span-1',
  full: 'lg:col-span-12 col-span-1',
};

/**
 * 默认布局按「学习路径」排序（Issue IKVKVF）：
 * 待办作业 → 最近课节 → 在学课程 → 学情概览 → 测评 ↔ 成绩走势（各占 1/2，左右对称对齐）
 * → 长期学业 → 插件扩展。
 *
 * 学生首页固定使用这一份布局，不再提供预设、拖拽、尺寸与折叠等自定义。
 */
export const DEFAULT_WIDGET_LAYOUT: WidgetLayoutConfig[] = [
  { id: 'upcoming-assignments', size: 'two-thirds', visible: true },
  { id: 'schedules', size: 'third', visible: true },
  { id: 'course-progress', size: 'half', visible: true },
  { id: 'quick-stats', size: 'half', visible: true },
  // assessments ↔ progress-trends 同为 half：宽度对称，视觉对齐（Issue IKVKVF follow-up）
  { id: 'assessments', size: 'half', visible: true },
  { id: 'progress-trends', size: 'half', visible: true },
  { id: 'academic-trajectory', size: 'full', visible: true },
  { id: 'academic-comparison', size: 'full', visible: true },
  { id: 'extension-views', size: 'full', visible: true },
];
