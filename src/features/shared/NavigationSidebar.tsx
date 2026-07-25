import React from 'react';
import { Home, BookOpen, Presentation, Users, Calendar as CalendarIcon, LayoutTemplate, Puzzle, Shield, HelpCircle, Menu, ChevronLeft, Clock } from 'lucide-react';
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
  mainNavCollapsed, setMainNavCollapsed,
  teacherTab, setTeacherTab,
  lang, session, todaySchedules,
}: NavigationSidebarProps) {
  const extensionPoints = usePluginHostStore((s) => s.extensionPoints);
  const pluginTabs = extensionPoints.get('teacher.tab' as any) || [];
  const siteInfo = useAppStore((s) => s.siteInfo);

  return (
    <div id="navigation_sidebar" className={`${mainNavCollapsed ? 'w-16' : 'w-16 md:w-64'} bg-white border-r border-gray-200 flex flex-col transition-all duration-300`}>
      {/* Collapse/Expand Toggle */}
      <div className={`p-2 flex border-b border-gray-150/60 ${mainNavCollapsed ? 'justify-center' : 'justify-between items-center px-4'} min-h-[48px] shrink-0`}>
        {!mainNavCollapsed && (
          <span className="hidden md:inline text-[11px] font-black tracking-widest text-slate-400 uppercase select-none">
            {lang === 'zh' ? '系统导航' : 'NAVIGATION'}
          </span>
        )}
        <button
          onClick={() => setMainNavCollapsed(!mainNavCollapsed)}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-gray-500 hover:text-indigo-600 transition-colors cursor-pointer flex items-center justify-center shrink-0"
          title={mainNavCollapsed ? (lang === 'zh' ? '展开导航' : 'Expand Sidebar') : (lang === 'zh' ? '折叠导航' : 'Collapse Sidebar')}
        >
          {mainNavCollapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <div className={`p-2 ${mainNavCollapsed ? 'md:p-2' : 'md:p-4'} flex flex-col gap-3 overflow-y-auto flex-1`}>
        {/* Group 1: 教学工具 */}
        <NavGroupHeader label={lang === 'zh' ? '教学工具' : 'TEACHING'} mainNavCollapsed={mainNavCollapsed} />
        <NavButton icon={Home} label={lang === 'zh' ? '系统总览' : 'Dashboard'} tab="dashboard" {...{ teacherTab, setTeacherTab, mainNavCollapsed }} />
        <NavButton icon={BookOpen} label={lang === 'zh' ? '课程管理' : 'Courses'} tab="courses" {...{ teacherTab, setTeacherTab, mainNavCollapsed }} />
        <NavButton icon={Presentation} label={lang === 'zh' ? '互动课堂' : 'Live Class'} tab="live_class" {...{ teacherTab, setTeacherTab, mainNavCollapsed }} highlight />
        <NavButton icon={Users} label={lang === 'zh' ? '班级管理' : 'Classes & Students'} tab="classes" {...{ teacherTab, setTeacherTab, mainNavCollapsed }} />

        {/* Group 2: 系统管理 */}
        <NavGroupHeader label={lang === 'zh' ? '系统管理' : 'SYSTEM MANAGEMENT'} mainNavCollapsed={mainNavCollapsed} />
        <NavButton icon={CalendarIcon} label={lang === 'zh' ? '课表管理' : 'Timetable Routine'} tab="timetable" {...{ teacherTab, setTeacherTab, mainNavCollapsed }} />
        <NavButton icon={LayoutTemplate} label={lang === 'zh' ? '机房管理' : 'Computer Lab Seating'} tab="computer_labs" {...{ teacherTab, setTeacherTab, mainNavCollapsed }} />
        <NavButton icon={Puzzle} label={lang === 'zh' ? '插件中心' : 'App Store / Plugins'} tab="plugins" {...{ teacherTab, setTeacherTab, mainNavCollapsed }} />

        {session?.subRole === 'administrator' && (
          <button onClick={() => setTeacherTab('admin_directory')} id="nav_btn_admin_directory" className={`flex items-center gap-3 p-3 transition-colors text-sm font-medium text-indigo-700 hover:bg-indigo-50 border border-slate-200/50 rounded-xl ${teacherTab === 'admin_directory' ? 'bg-indigo-50/70 border-indigo-200' : 'bg-slate-50/50'} ${mainNavCollapsed ? 'justify-center px-2' : ''}`} title={lang === 'zh' ? '管理后台' : '⭐ Admin Center'}>
            <Shield size={20} className="shrink-0 text-indigo-600 animate-pulse" />
            <span className={mainNavCollapsed ? 'hidden' : 'hidden md:block font-bold text-indigo-850'}>{lang === 'zh' ? '管理后台' : '⭐ Admin Center'}</span>
          </button>
        )}

        {/* Group 3: 扩展应用 (Dynamic plugin-registered tab buttons) */}
        {pluginTabs.length > 0 && (
          <>
            <NavGroupHeader label={lang === 'zh' ? '扩展应用' : 'EXTENSIONS'} mainNavCollapsed={mainNavCollapsed} />
            <ExtensionPointRenderer slot="teacher.tab" slotProps={{ renderType: "button", mainNavCollapsed, teacherTab, setTeacherTab }} />
          </>
        )}

        <NavGroupHeader label={lang === 'zh' ? '帮助与支持' : 'HELP & SUPPORT'} mainNavCollapsed={mainNavCollapsed} />
        <NavButton icon={HelpCircle} label={lang === 'zh' ? '帮助文档' : 'System Commands / Help'} tab="help" {...{ teacherTab, setTeacherTab, mainNavCollapsed }} />
      </div>

      {/* Today's Schedules Sidebar Widget */}
      {(() => {
        const upcoming = todaySchedules.filter(isScheduleUpcoming);
        const remaining = upcoming.length;
        if (mainNavCollapsed || todaySchedules.length === 0) return null;
        return (
          <div className="mt-auto p-3 m-3 bg-indigo-50/55 rounded-xl border border-indigo-105 hidden md:block select-none shadow-3xs" id="today_schedule_sidebar_panel">
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 mb-1.5">
              <Clock size={12} className="text-indigo-600 animate-pulse shrink-0" />
              {lang === 'zh' ? '本堂余课' : 'Classes Remaining'}
            </div>
            <div className="text-[11px] text-gray-500 mb-2">
              {lang === 'zh' ? `今天还有 ${remaining} 节课面授` : `${remaining} more classes left today`}
            </div>
            {upcoming.length > 0 && (
              <div className="max-h-[140px] overflow-y-auto space-y-1 pr-1">
                {upcoming.map((sch: any) => (
                  <div key={sch.id} className="text-[10px] p-1.5 bg-white rounded border border-indigo-100/60 shadow-3xs hover:border-indigo-200 transition-colors">
                    <div className="font-bold text-gray-750 truncate" title={sch.lesson_title}>{sch.lesson_title}</div>
                    <div className="text-[9px] text-gray-450 truncate flex justify-between mt-0.5">
                      <span className="font-medium text-slate-500 truncate max-w-[60px]">{sch.class_name}</span>
                      <span className="font-mono text-indigo-700 font-semibold">{sch.time_slot}</span>
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

// ── Helper: Group Header Label ───────────────────────────────────────────

function NavGroupHeader({ label, mainNavCollapsed }: { label: string; mainNavCollapsed: boolean }) {
  if (mainNavCollapsed) return <div className="h-px bg-gray-200 my-1 w-full" />;
  return (
    <div className="px-3 pt-2 text-[10px] font-bold text-slate-400 tracking-wider uppercase hidden md:block select-none">
      {label}
    </div>
  );
}

// ── Helper: single nav button ────────────────────────────────────────────

function NavButton({
  icon: Icon, label, tab,
  teacherTab, setTeacherTab, mainNavCollapsed,
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
      className={`flex items-center gap-3 p-3 transition-colors text-sm font-medium rounded-xl ${
        isActive
          ? 'bg-indigo-50 text-indigo-700 font-bold' + (highlight ? ' shadow-sm border border-indigo-100' : '')
          : 'text-gray-600 hover:bg-gray-50'
      } ${mainNavCollapsed ? 'justify-center px-2' : ''}`}
      title={label}
    >
      <Icon size={20} className={`shrink-0 ${highlight && !isActive ? 'text-indigo-550' : ''}`} />
      <span className={mainNavCollapsed ? 'hidden' : 'hidden md:block'}>{label}</span>
    </button>
  );
}
