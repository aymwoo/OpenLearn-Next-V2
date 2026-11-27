import React from 'react';
import type { WidgetSize, DashboardWidgetId } from '../types/dashboardLayout';
import { SIZE_TO_COL_SPAN } from '../types/dashboardLayout';

export interface DashboardWidgetCardProps {
  id: DashboardWidgetId;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  /** 固定由默认布局决定，卡片本身不再提供尺寸调节。 */
  size: WidgetSize;
  lang?: 'zh' | 'en';
  children: React.ReactNode;
  headerRightExtra?: React.ReactNode;
  /** Gitee Issue IKW5KV：教师收敛提示文案时隐藏组件副标题。 */
  hideSubtitle?: boolean;
}

/**
 * 学生首页卡片外壳。
 *
 * 只负责「标题 + 内容」：尺寸/顺序/折叠一律沿用默认布局，
 * 不再提供 1/3、1/2 宽度切换、前后移动、折叠展开与拖拽排序等控件。
 */
export function DashboardWidgetCard({
  id,
  title,
  subtitle,
  icon,
  size,
  children,
  headerRightExtra,
  hideSubtitle = false,
}: DashboardWidgetCardProps) {
  const colSpanClass = SIZE_TO_COL_SPAN[size] || 'lg:col-span-6 col-span-1';

  return (
    <div
      id={`widget-${id}`}
      data-widget-id={id}
      data-widget-size={size}
      className={`flex flex-col bg-white rounded-2xl border border-slate-200/90 shadow-2xs ${colSpanClass}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2.5 select-none rounded-t-2xl sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && <div className="text-indigo-600 shrink-0">{icon}</div>}
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800 tracking-tight truncate">{title}</h3>
            {subtitle && !hideSubtitle && <p className="text-2xs text-slate-450 truncate">{subtitle}</p>}
          </div>
        </div>
        {headerRightExtra ? <div className="flex shrink-0 items-center gap-1">{headerRightExtra}</div> : null}
      </div>

      {/* Widget Body Content：@container 让内部布局按卡片自身宽度（而非视口）自适应 */}
      <div className="@container flex flex-1 flex-col p-3.5 sm:p-4">{children}</div>
    </div>
  );
}
