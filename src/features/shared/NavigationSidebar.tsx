import React, { useMemo, useState } from 'react';
import { Menu, ChevronLeft, ChevronDown, Clock, ExternalLink } from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';
import { openTeacherTabInNewTab } from '../../utils/teacherTabHash';
import { translations } from '../../i18n';
import type { Language } from '../../i18n';
import {
  resolveBuiltinNavigationItems,
  resolveGroupLabel,
  type NavigationGroupKey,
} from '../navigation/navigation-registry';

/** Narrow an untyped lang string to the i18n literal union, defaulting to 'zh'. */
function narrowLang(lang: string | undefined): Language {
  return lang === 'en' ? 'en' : 'zh';
}
import type { SessionType, ScheduleType } from '../../store/appStore';
import { useAppStore } from '../../store/appStore';
import { useOptionalAppData } from '../../context/AppDataContext';

export interface NavigationSidebarProps {
  mainNavCollapsed?: boolean;
  setMainNavCollapsed?: (v: boolean) => void;
  teacherTab?: string;
  setTeacherTab?: (tab: string) => void;
  lang?: string;
  session?: SessionType | null;
  todaySchedules?: ScheduleType[];
}

const STORAGE_KEY = 'openlearn_nav_collapsed_groups';

const isScheduleUpcoming = (sch: any) => {
  if (sch.status === 'cancelled' || sch.status === 'holiday') return false;
  if (!sch.time_slot) return true;
  try {
    const parts = sch.time_slot.split('-');
    if (parts.length < 2) return true;
    const endTimeStr = parts[1].trim();
    const [endHour, endMin] = endTimeStr.split(':').map(Number);
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    if (currentHour > endHour) return false;
    if (currentHour === endHour && currentMin >= endMin) return false;
    return true;
  } catch {
    return true;
  }
};

export function NavigationSidebar(props: NavigationSidebarProps = {}) {
  const appData = useOptionalAppData();
  const mainNavCollapsed = props.mainNavCollapsed ?? appData?.mainNavCollapsed ?? false;
  const setMainNavCollapsed = props.setMainNavCollapsed ?? appData?.setMainNavCollapsed ?? (() => {});
  const teacherTab = props.teacherTab ?? appData?.teacherTab ?? 'dashboard';
  const setTeacherTab = props.setTeacherTab ?? appData?.setTeacherTab ?? (() => {});
  const lang = props.lang ?? appData?.lang ?? 'zh';
  const session = props.session !== undefined ? props.session : (appData?.session ?? null);
  const todaySchedules = props.todaySchedules ?? appData?.todaySchedules ?? [];

  const extensionPoints = usePluginHostStore((s) => s.extensionPoints);
  const pluginTabs = extensionPoints.get('teacher.tab' as any) || [];
  const siteInfo = useAppStore((s) => s.siteInfo);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [groupKey]: !prev[groupKey] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore localStorage quota/security errors
      }
      return next;
    });
  };

  // 内置入口的**唯一数据源**是 navigation registry —— 组件只负责按数据渲染，
  // 组标题、顺序、图标、文案、角色可见性都不再散落在 JSX 里。
  const navItems = useMemo(
    () =>
      resolveBuiltinNavigationItems(
        session?.subRole === 'administrator' ? 'administrator' : 'teacher',
        lang === 'en' ? 'en' : 'zh',
      ),
    [session?.subRole, lang],
  );

  const itemsByGroup = (groupKey: NavigationGroupKey) => navItems.filter((item) => item.group === groupKey);

  return (
    <div
      id="navigation_sidebar"
      className={`${mainNavCollapsed ? 'w-16' : 'w-44 md:w-44'} shrink-0 bg-surface border-r border-theme text-main flex flex-col transition-all duration-300`}
    >
      {/* Collapse/Expand Toggle */}
      <div
        className={`p-2 flex border-b border-theme-subtle ${mainNavCollapsed ? 'justify-center' : 'justify-between items-center px-3'} min-h-[48px] shrink-0`}
      >
        {!mainNavCollapsed && (
          <span className="inline text-xs font-black tracking-widest text-muted uppercase select-none">
            {lang === 'zh' ? '系统导航' : 'NAVIGATION'}
          </span>
        )}
        <button
          onClick={() => setMainNavCollapsed(!mainNavCollapsed)}
          className="p-1.5 rounded-lg hover:bg-surface-secondary text-muted hover:text-primary-theme transition-colors cursor-pointer flex items-center justify-center shrink-0"
          title={
            mainNavCollapsed
              ? lang === 'zh'
                ? '展开导航'
                : 'Expand Sidebar'
              : lang === 'zh'
                ? '折叠导航'
                : 'Collapse Sidebar'
          }
        >
          {mainNavCollapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <div className={`p-2 ${mainNavCollapsed ? 'md:p-2' : 'md:p-2.5'} flex flex-col gap-2 overflow-y-auto flex-1`}>
        {/* 分组按 registry 的 position 顺序渲染：teaching → system → extensions → support */}
        {(['teaching', 'system', 'extensions', 'support'] as NavigationGroupKey[]).map((groupKey) => {
          // 扩展应用分组的内容来自插件贡献（slot teacher.tab），由 ExtensionPointRenderer 渲染
          if (groupKey === 'extensions') {
            if (pluginTabs.length === 0) return null;
            return (
              <React.Fragment key={groupKey}>
                <NavGroupHeader
                  label={resolveGroupLabel('extensions', lang === 'en' ? 'en' : 'zh')}
                  groupKey="extensions"
                  mainNavCollapsed={mainNavCollapsed}
                  isCollapsed={!!collapsedGroups['extensions']}
                  onToggle={() => toggleGroup('extensions')}
                  lang={lang}
                />
                {(!collapsedGroups['extensions'] || mainNavCollapsed) && (
                  <div className="flex flex-col gap-1">
                    <ExtensionPointRenderer
                      slot="teacher.tab"
                      slotProps={{ renderType: 'button', mainNavCollapsed, teacherTab, setTeacherTab, lang }}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          }

          const groupItems = itemsByGroup(groupKey);
          if (groupItems.length === 0) return null;
          return (
            <React.Fragment key={groupKey}>
              <NavGroupHeader
                label={resolveGroupLabel(groupKey, lang === 'en' ? 'en' : 'zh')}
                groupKey={groupKey}
                mainNavCollapsed={mainNavCollapsed}
                isCollapsed={!!collapsedGroups[groupKey]}
                onToggle={() => toggleGroup(groupKey)}
                lang={lang}
              />
              {(!collapsedGroups[groupKey] || mainNavCollapsed) && (
                <div className="flex flex-col gap-1">
                  {groupItems.map((item) => (
                    <NavButton
                      key={item.id}
                      icon={item.icon}
                      label={item.label}
                      tab={item.tab}
                      highlight={item.highlight}
                      isAdmin={item.administratorOnly}
                      {...{ teacherTab, setTeacherTab, mainNavCollapsed, lang }}
                    />
                  ))}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Today's Schedules Sidebar Widget */}
      {(() => {
        const upcoming = todaySchedules.filter(isScheduleUpcoming);
        const remaining = upcoming.length;
        if (mainNavCollapsed || todaySchedules.length === 0) return null;
        return (
          <div
            className="mt-auto p-2.5 m-2 bg-indigo-50/55 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-900/30 block select-none shadow-3xs"
            id="today_schedule_sidebar_panel"
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 mb-1">
              <Clock size={12} className="text-indigo-600 animate-pulse shrink-0" />
              <span className="truncate">{lang === 'zh' ? '本堂余课' : 'Classes Remaining'}</span>
            </div>
            <div className="text-xs text-gray-500 mb-1.5 truncate">
              {lang === 'zh' ? `今天还有 ${remaining} 节课` : `${remaining} more classes left`}
            </div>
            {upcoming.length > 0 && (
              <div className="max-h-[130px] overflow-y-auto space-y-1 pr-0.5">
                {upcoming.map((sch: any) => (
                  <div
                    key={sch.id}
                    className="text-xs p-1.5 bg-white rounded border border-indigo-100/60 shadow-3xs hover:border-indigo-200 transition-colors"
                  >
                    <div className="font-bold text-gray-750 truncate" title={sch.lesson_title}>
                      {sch.lesson_title}
                    </div>
                    <div className="text-xs text-gray-450 truncate flex justify-between items-center mt-0.5 gap-1">
                      <span className="font-medium text-slate-500 truncate max-w-[55px]">{sch.class_name}</span>
                      <span className="font-mono text-indigo-700 font-semibold shrink-0">{sch.time_slot}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Helper: Group Header Component ───────────────────────────────────────

interface NavGroupHeaderProps {
  label: string;
  groupKey: string;
  mainNavCollapsed: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
  lang: string;
}

function NavGroupHeader({ label, groupKey, mainNavCollapsed, isCollapsed, onToggle, lang }: NavGroupHeaderProps) {
  if (mainNavCollapsed) return <div className="h-px bg-border-theme-subtle my-1 w-full opacity-60" />;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!isCollapsed}
      data-testid={`nav_group_${groupKey}`}
      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-secondary/40 hover:bg-surface-secondary/80 border-0 text-xs font-semibold text-muted hover:text-main cursor-pointer transition-all duration-150 select-none group mt-1.5"
      title={`${label} (${isCollapsed ? (lang === 'zh' ? '点击展开' : 'Click to expand') : lang === 'zh' ? '点击折叠' : 'Click to collapse'})`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-1 h-3 rounded-full bg-primary-theme/75 group-hover:bg-primary-theme transition-colors shrink-0" />
        <span className="truncate tracking-wide text-xs">{label}</span>
      </div>
      <ChevronDown
        size={13}
        className={`text-muted/60 group-hover:text-main transition-transform duration-200 shrink-0 ${
          isCollapsed ? '-rotate-90' : 'rotate-0'
        }`}
      />
    </button>
  );
}

// ── Helper: single nav button ────────────────────────────────────────────

function NavButton({
  icon: Icon,
  label,
  tab,
  teacherTab,
  setTeacherTab,
  mainNavCollapsed,
  highlight,
  isAdmin,
  lang,
}: {
  icon: React.ElementType;
  label: string;
  tab: string;
  teacherTab: string;
  setTeacherTab: (t: string) => void;
  mainNavCollapsed: boolean;
  highlight?: boolean;
  isAdmin?: boolean;
  lang?: string;
}) {
  const isActive = teacherTab === tab;
  const langNarrow = narrowLang(lang);
  const t = translations[langNarrow];
  const newTabLabel = langNarrow === 'zh' ? `在新标签页打开"${label}"` : `Open "${label}" in a new tab`;

  return (
    <div
      className={`group relative flex items-center rounded-xl transition-all duration-150 ${
        isActive
          ? 'bg-primary-theme-light text-primary-theme font-bold border border-primary-theme/25 shadow-3xs'
          : 'border border-transparent text-muted hover:bg-surface-secondary hover:text-main'
      } ${mainNavCollapsed ? 'justify-center' : ''}`}
      title={label}
    >
      <button
        type="button"
        onClick={() => setTeacherTab(tab)}
        id={`nav_btn_${tab}`}
        // 折叠态 / <md 窄屏时标签 span 会被 hidden，按钮就只剩一个无语义的图标 ——
        // 补 aria-label 保证任何宽度下都有可访问名（axe: button-name）。
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        className={`flex items-center gap-2.5 py-2 flex-1 min-w-0 text-sm font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-theme/50 rounded-lg ${
          isActive ? 'font-bold' : ''
        } ${mainNavCollapsed ? 'justify-center px-2' : 'pl-2.5 pr-8'}`}
      >
        <Icon
          size={18}
          className={`shrink-0 transition-colors ${
            isActive
              ? 'text-primary-theme'
              : highlight
                ? 'text-primary-theme'
                : isAdmin
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : ''
          }`}
        />
        <span className={mainNavCollapsed ? 'hidden' : 'block truncate'}>{label}</span>
      </button>
      {!mainNavCollapsed && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openTeacherTabInNewTab(tab);
          }}
          id={`nav_btn_${tab}_newtab`}
          aria-label={newTabLabel}
          title={t.openInNewTab}
          data-testid={`nav_newtab_${tab}`}
          className="absolute right-1.5 p-1 rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/10 dark:hover:bg-white/15 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-theme/50 transition-opacity text-current"
        >
          <ExternalLink size={12} className="shrink-0" />
        </button>
      )}
    </div>
  );
}
