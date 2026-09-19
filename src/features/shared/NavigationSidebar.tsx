import React, { useState } from 'react';
import {
  Home,
  BookOpen,
  Presentation,
  Users,
  Calendar as CalendarIcon,
  LayoutTemplate,
  Puzzle,
  Shield,
  HelpCircle,
  Menu,
  ChevronLeft,
  ChevronDown,
  Clock,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';
import type { SessionType, ScheduleType } from '../../store/appStore';
import { useAppStore } from '../../store/appStore';

interface NavigationSidebarProps {
  mainNavCollapsed: boolean;
  setMainNavCollapsed: (v: boolean) => void;
  teacherTab: string;
  setTeacherTab: (tab: string) => void;
  lang: string;
  session: SessionType | null;
  todaySchedules: ScheduleType[];
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

export function NavigationSidebar({
  mainNavCollapsed,
  setMainNavCollapsed,
  teacherTab,
  setTeacherTab,
  lang,
  session,
  todaySchedules,
}: NavigationSidebarProps) {
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

  return (
    <div
      id="navigation_sidebar"
      className={`${mainNavCollapsed ? 'w-16' : 'w-16 md:w-44'} bg-surface border-r border-theme text-main flex flex-col transition-all duration-300`}
    >
      {/* Collapse/Expand Toggle */}
      <div
        className={`p-2 flex border-b border-theme-subtle ${mainNavCollapsed ? 'justify-center' : 'justify-between items-center px-3'} min-h-[48px] shrink-0`}
      >
        {!mainNavCollapsed && (
          <span className="hidden md:inline text-xs font-black tracking-widest text-muted uppercase select-none">
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
        {/* Group 1: 教学工具 */}
        <NavGroupHeader
          label={lang === 'zh' ? '教学工具' : 'TEACHING'}
          groupKey="teaching"
          mainNavCollapsed={mainNavCollapsed}
          isCollapsed={!!collapsedGroups['teaching']}
          onToggle={() => toggleGroup('teaching')}
          lang={lang}
        />
        {(!collapsedGroups['teaching'] || mainNavCollapsed) && (
          <div className="flex flex-col gap-1">
            <NavButton
              icon={BookOpen}
              label={lang === 'zh' ? '课程管理' : 'Courses'}
              tab="courses"
              {...{ teacherTab, setTeacherTab, mainNavCollapsed }}
            />
            <NavButton
              icon={Presentation}
              label={lang === 'zh' ? '互动课堂' : 'Live Class'}
              tab="live_class"
              {...{ teacherTab, setTeacherTab, mainNavCollapsed }}
              highlight
            />
            <NavButton
              icon={Users}
              label={lang === 'zh' ? '班级管理' : 'Classes & Students'}
              tab="classes"
              {...{ teacherTab, setTeacherTab, mainNavCollapsed }}
            />
          </div>
        )}

        {/* Group 2: 系统管理 */}
        <NavGroupHeader
          label={lang === 'zh' ? '系统管理' : 'SYSTEM MANAGEMENT'}
          groupKey="system"
          mainNavCollapsed={mainNavCollapsed}
          isCollapsed={!!collapsedGroups['system']}
          onToggle={() => toggleGroup('system')}
          lang={lang}
        />
        {(!collapsedGroups['system'] || mainNavCollapsed) && (
          <div className="flex flex-col gap-1">
            <NavButton
              icon={CalendarIcon}
              label={lang === 'zh' ? '课表管理' : 'Timetable Routine'}
              tab="timetable"
              {...{ teacherTab, setTeacherTab, mainNavCollapsed }}
            />
            <NavButton
              icon={LayoutTemplate}
              label={lang === 'zh' ? '机房管理' : 'Computer Lab Seating'}
              tab="computer_labs"
              {...{ teacherTab, setTeacherTab, mainNavCollapsed }}
            />
            <NavButton
              icon={Puzzle}
              label={lang === 'zh' ? '插件中心' : 'App Store / Plugins'}
              tab="plugins"
              {...{ teacherTab, setTeacherTab, mainNavCollapsed }}
            />

            {session?.subRole === 'administrator' && (
              <button
                onClick={() => setTeacherTab('admin_directory')}
                id="nav_btn_admin_directory"
                className={`flex items-center gap-2.5 px-2.5 py-2 transition-colors text-sm font-medium text-indigo-700 hover:bg-indigo-50 border border-indigo-100/80 dark:border-indigo-950/40 rounded-xl ${
                  teacherTab === 'admin_directory' ? 'bg-indigo-50/70 border-indigo-200' : 'bg-slate-50/50 dark:bg-slate-900/30'
                } ${mainNavCollapsed ? 'justify-center px-2' : ''}`}
                title={lang === 'zh' ? '管理后台' : '⭐ Admin Center'}
              >
                <Shield size={18} className="shrink-0 text-indigo-600 animate-pulse" />
                <span className={mainNavCollapsed ? 'hidden' : 'hidden md:block font-bold text-indigo-850 truncate'}>
                  {lang === 'zh' ? '管理后台' : '⭐ Admin Center'}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Group 3: 扩展应用 (Dynamic plugin-registered tab buttons) */}
        {pluginTabs.length > 0 && (
          <>
            <NavGroupHeader
              label={lang === 'zh' ? '扩展应用' : 'EXTENSIONS'}
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
                  slotProps={{ renderType: 'button', mainNavCollapsed, teacherTab, setTeacherTab }}
                />
              </div>
            )}
          </>
        )}

        {/* Group 4: 帮助支持 */}
        <NavGroupHeader
          label={lang === 'zh' ? '帮助支持' : 'HELP & SUPPORT'}
          groupKey="support"
          mainNavCollapsed={mainNavCollapsed}
          isCollapsed={!!collapsedGroups['support']}
          onToggle={() => toggleGroup('support')}
          lang={lang}
        />
        {(!collapsedGroups['support'] || mainNavCollapsed) && (
          <div className="flex flex-col gap-1">
            <NavButton
              icon={HelpCircle}
              label={lang === 'zh' ? '帮助文档' : 'System Commands / Help'}
              tab="help"
              {...{ teacherTab, setTeacherTab, mainNavCollapsed }}
            />
          </div>
        )}
      </div>

      {/* Today's Schedules Sidebar Widget */}
      {(() => {
        const upcoming = todaySchedules.filter(isScheduleUpcoming);
        const remaining = upcoming.length;
        if (mainNavCollapsed || todaySchedules.length === 0) return null;
        return (
          <div
            className="mt-auto p-2.5 m-2 bg-indigo-50/55 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-900/30 hidden md:block select-none shadow-3xs"
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

function NavGroupHeader({
  label,
  groupKey,
  mainNavCollapsed,
  isCollapsed,
  onToggle,
  lang,
}: NavGroupHeaderProps) {
  if (mainNavCollapsed) return <div className="h-px bg-border-theme-subtle my-1 w-full opacity-60" />;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!isCollapsed}
      data-testid={`nav_group_${groupKey}`}
      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-secondary/40 hover:bg-surface-secondary/80 border-0 text-xs font-semibold text-muted hover:text-main cursor-pointer transition-all duration-150 select-none group mt-1.5"
      title={`${label} (${isCollapsed ? (lang === 'zh' ? '点击展开' : 'Click to expand') : (lang === 'zh' ? '点击折叠' : 'Click to collapse')})`}
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
}: {
  icon: React.ElementType;
  label: string;
  tab: string;
  teacherTab: string;
  setTeacherTab: (t: string) => void;
  mainNavCollapsed: boolean;
  highlight?: boolean;
}) {
  const isActive = teacherTab === tab;
  return (
    <button
      onClick={() => setTeacherTab(tab)}
      id={`nav_btn_${tab}`}
      className={`flex items-center gap-2.5 px-2.5 py-2 transition-colors text-sm font-medium rounded-xl cursor-pointer ${
        isActive
          ? 'bg-primary-theme-light text-primary-theme font-bold' + (highlight ? ' shadow-xs border border-theme' : '')
          : 'text-muted hover:bg-surface-secondary hover:text-main'
      } ${mainNavCollapsed ? 'justify-center px-2' : ''}`}
      title={label}
    >
      <Icon size={18} className={`shrink-0 ${highlight && !isActive ? 'text-primary-theme' : ''}`} />
      <span className={mainNavCollapsed ? 'hidden' : 'hidden md:block truncate'}>{label}</span>
    </button>
  );
}
