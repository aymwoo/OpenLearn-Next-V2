export type DashboardWidgetId =
  | 'quick-stats'
  | 'progress-trends'
  | 'upcoming-assignments'
  | 'course-progress'
  | 'schedules'
  | 'academic-trajectory'
  | 'extension-views';

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

export const SIZE_LABELS: Record<WidgetSize, { zh: string; en: string }> = {
  third: { zh: '1/3 窄栏', en: '1/3 Narrow' },
  half: { zh: '1/2 半宽', en: '1/2 Half' },
  'two-thirds': { zh: '2/3 宽栏', en: '2/3 Wide' },
  full: { zh: '整行全宽', en: 'Full Width' },
};

export const DEFAULT_WIDGET_LAYOUT: WidgetLayoutConfig[] = [
  { id: 'quick-stats', size: 'full', visible: true },
  { id: 'progress-trends', size: 'two-thirds', visible: true },
  { id: 'upcoming-assignments', size: 'third', visible: true },
  { id: 'course-progress', size: 'half', visible: true },
  { id: 'schedules', size: 'half', visible: true },
  { id: 'academic-trajectory', size: 'full', visible: true },
  { id: 'extension-views', size: 'full', visible: true },
];

export const LAYOUT_PRESETS: Record<string, { label: { zh: string; en: string }; layout: WidgetLayoutConfig[] }> = {
  default: {
    label: { zh: '默认布局 (推荐)', en: 'Default (Balanced)' },
    layout: DEFAULT_WIDGET_LAYOUT,
  },
  assignments_focus: {
    label: { zh: '作业攻坚模式', en: 'Assignments Focus' },
    layout: [
      { id: 'quick-stats', size: 'full', visible: true },
      { id: 'upcoming-assignments', size: 'full', visible: true },
      { id: 'progress-trends', size: 'half', visible: true },
      { id: 'schedules', size: 'half', visible: true },
      { id: 'course-progress', size: 'half', visible: true },
      { id: 'academic-trajectory', size: 'half', visible: true },
      { id: 'extension-views', size: 'full', visible: true },
    ],
  },
  analytics_focus: {
    label: { zh: '学情走势大屏', en: 'Progress Trends Focus' },
    layout: [
      { id: 'progress-trends', size: 'full', visible: true },
      { id: 'quick-stats', size: 'full', visible: true },
      { id: 'academic-trajectory', size: 'full', visible: true },
      { id: 'upcoming-assignments', size: 'half', visible: true },
      { id: 'schedules', size: 'half', visible: true },
      { id: 'course-progress', size: 'full', visible: true },
      { id: 'extension-views', size: 'full', visible: true },
    ],
  },
  symmetric_compact: {
    label: { zh: '双列紧凑并排', en: 'Two-Column Compact' },
    layout: [
      { id: 'quick-stats', size: 'full', visible: true },
      { id: 'progress-trends', size: 'half', visible: true },
      { id: 'upcoming-assignments', size: 'half', visible: true },
      { id: 'course-progress', size: 'half', visible: true },
      { id: 'schedules', size: 'half', visible: true },
      { id: 'academic-trajectory', size: 'full', visible: true },
      { id: 'extension-views', size: 'full', visible: true },
    ],
  },
};
