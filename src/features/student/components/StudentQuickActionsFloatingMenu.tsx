import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import * as Icons from 'lucide-react';
import {
  Zap,
  X,
  Radio,
  ClipboardList,
  Bell,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Clock,
  BookOpen,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { useScreenResize, ScreenResizeInfo } from '../../../hooks/useScreenResize';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import {
  StudentQuickActionItem,
  studentQuickActionsRegistry,
  QuickActionBadgeVariant,
} from '../types/quickActions';

export type { StudentQuickActionItem, QuickActionBadgeVariant };

export interface StudentQuickActionsFloatingMenuProps {
  studentDashboardData: any;
  activeStudentId: string | null;
  readNotifications: Set<string>;
  setReadNotifications: (updater: (prev: Set<string>) => Set<string>) => void;
  setSelectedLesson: (lessonId: string) => void;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedAssignment: (ast: any) => void;
  addToast?: (title: string, description: string, type?: string) => void;
  lang?: 'zh' | 'en';
  onExpandWidget?: (widgetId: string) => void;

  /**
   * Force compact mode externally (true: icon-only FAB, false: expanded pill)
   */
  compactMode?: boolean;

  /**
   * Automatically collapse open popover into compact state when mobile threshold is entered (default: true)
   */
  autoCollapseOnMobile?: boolean;

  /**
   * Screen width threshold in pixels for mobile detection (default: 768)
   */
  mobileBreakpoint?: number;

  /**
   * Additional third-party plugin actions provided directly as props
   */
  pluginActions?: StudentQuickActionItem[];

  /**
   * Callback fired when compact state changes
   */
  onCompactChange?: (isCompact: boolean) => void;

  /**
   * Custom FAB renderer override for advanced third-party plugins
   */
  customFabRenderer?: (props: {
    isCompact: boolean;
    isOpen: boolean;
    toggle: () => void;
    urgentCount: number;
    screenInfo: ScreenResizeInfo;
  }) => React.ReactNode;

  /**
   * Whether to listen to global third-party plugin action registry (default: true)
   */
  enablePluginRegistry?: boolean;
}

/**
 * Render dynamic icon for plugin actions
 */
function renderActionIcon(icon: string | React.ReactNode | undefined) {
  if (!icon) return <Sparkles size={18} />;
  if (typeof icon !== 'string') return icon;
  const IconComp = (Icons as any)[icon];
  if (IconComp) return <IconComp size={18} />;
  return <span className="text-sm font-bold">{icon}</span>;
}

/**
 * Resolve badge color classes
 */
function getBadgeColorClasses(variant?: QuickActionBadgeVariant): string {
  switch (variant) {
    case 'rose':
      return 'bg-rose-100 text-rose-700 border-rose-200';
    case 'amber':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'emerald':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'blue':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'slate':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'indigo':
    default:
      return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  }
}

export function StudentQuickActionsFloatingMenu({
  studentDashboardData,
  activeStudentId,
  readNotifications,
  setReadNotifications,
  setSelectedLesson,
  setStudentViewStatus,
  setSelectedAssignment,
  addToast,
  lang = 'zh',
  onExpandWidget,
  compactMode,
  autoCollapseOnMobile = true,
  mobileBreakpoint = 768,
  pluginActions,
  onCompactChange,
  customFabRenderer,
  enablePluginRegistry = true,
}: StudentQuickActionsFloatingMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'menu' | 'notifications'>('menu');
  const [userCompactOverride, setUserCompactOverride] = useState<boolean | null>(null);
  const [registryActions, setRegistryActions] = useState<StudentQuickActionItem[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  // Monitor screen resizing via useScreenResize hook
  const screenInfo = useScreenResize({
    mobileBreakpoint,
    debounceMs: 50,
    onMobileEnter: () => {
      if (autoCollapseOnMobile) {
        setIsOpen(false);
        studentQuickActionsRegistry.collapseMenu('auto_collapse_on_mobile_enter');
      }
    },
  });

  // Calculate effective compact mode:
  // 1. prop compactMode takes priority if explicitly set
  // 2. user manual override in UI takes second priority
  // 3. defaults to true on mobile devices (screenInfo.isMobile) to preserve screen real estate
  const isCompact = useMemo(() => {
    if (typeof compactMode === 'boolean') return compactMode;
    if (userCompactOverride !== null) return userCompactOverride;
    return screenInfo.isMobile;
  }, [compactMode, userCompactOverride, screenInfo.isMobile]);

  // Sync compact mode changes with listeners & registry
  useEffect(() => {
    onCompactChange?.(isCompact);
    studentQuickActionsRegistry.setCompactMode(isCompact);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('openlearn:student_quick_actions:compact_changed', {
          detail: {
            isCompact,
            isMobile: screenInfo.isMobile,
            width: screenInfo.width,
            height: screenInfo.height,
          },
        }),
      );
    }
  }, [isCompact, screenInfo.isMobile, screenInfo.width, screenInfo.height, onCompactChange]);

  // Subscribe to third-party plugin global action registry
  useEffect(() => {
    if (!enablePluginRegistry) return;
    const unsub = studentQuickActionsRegistry.subscribe((actions) => {
      setRegistryActions(actions);
    });
    return unsub;
  }, [enablePluginRegistry]);

  // Listen to programmatic DOM events from plugins
  useEffect(() => {
    const handleCollapse = () => setIsOpen(false);
    const handleOpen = () => setIsOpen(true);
    const handleToggleCompact = () =>
      setUserCompactOverride((prev) => (prev === null ? !screenInfo.isMobile : !prev));
    const handleRegisterAction = (e: Event) => {
      const customEvent = e as CustomEvent<StudentQuickActionItem>;
      if (customEvent.detail && customEvent.detail.id) {
        studentQuickActionsRegistry.registerAction(customEvent.detail);
      }
    };

    window.addEventListener('openlearn:student_quick_actions:collapse', handleCollapse);
    window.addEventListener('openlearn:student_quick_actions:open', handleOpen);
    window.addEventListener('openlearn:student_quick_actions:toggle_compact', handleToggleCompact);
    window.addEventListener('openlearn:student_quick_action:register', handleRegisterAction);

    return () => {
      window.removeEventListener('openlearn:student_quick_actions:collapse', handleCollapse);
      window.removeEventListener('openlearn:student_quick_actions:open', handleOpen);
      window.removeEventListener('openlearn:student_quick_actions:toggle_compact', handleToggleCompact);
      window.removeEventListener('openlearn:student_quick_action:register', handleRegisterAction);
    };
  }, [screenInfo.isMobile]);

  const schedules = studentDashboardData?.schedules || [];
  const assignments = studentDashboardData?.assignments || [];
  const rollcalls = studentDashboardData?.rollcalls || [];
  const progress = studentDashboardData?.progress || [];

  // Urgent items counters
  const unreadRollcalls = useMemo(
    () => rollcalls.filter((r: any) => !readNotifications.has(r.id)),
    [rollcalls, readNotifications],
  );

  const pendingAssignments = useMemo(
    () => assignments.filter((a: any) => !a.submission_status),
    [assignments],
  );

  // Active / next live session
  const activeSessionSchedule = useMemo(() => {
    if (schedules.length > 0) {
      return schedules.find((s: any) => s.attendance_status === 'present' || s.status === 'scheduled') || schedules[0];
    }
    if (progress.length > 0) {
      return {
        lesson_id: progress[0].lesson_id,
        lesson_title: progress[0].lesson_title,
        class_name: lang === 'zh' ? '正在进行的课程' : 'In-progress course',
      };
    }
    return null;
  }, [schedules, progress, lang]);

  // Combine plugin actions from props and registry
  const combinedPluginActions = useMemo(() => {
    const map = new Map<string, StudentQuickActionItem>();
    for (const a of registryActions) {
      map.set(a.id, a);
    }
    if (pluginActions) {
      for (const a of pluginActions) {
        map.set(a.id, a);
      }
    }
    return Array.from(map.values())
      .filter((a) => {
        if (a.visibleOnMobile === false && isCompact) return false;
        return true;
      })
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }, [registryActions, pluginActions, isCompact]);

  const totalUrgentCount = unreadRollcalls.length + pendingAssignments.length + (activeSessionSchedule ? 1 : 0);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // 1. Action: Join Live Session
  const handleJoinLiveSession = () => {
    const targetLessonId = activeSessionSchedule?.lesson_id || (progress[0]?.lesson_id ?? null);
    if (targetLessonId) {
      setSelectedLesson(targetLessonId);
      setStudentViewStatus('lesson');
      setIsOpen(false);
      addToast?.(
        lang === 'zh' ? '已进入面授课堂' : 'Joining Live Session',
        lang === 'zh'
          ? `已成功接入「${activeSessionSchedule?.lesson_title || '面授课程'}」实时白板与互动系统`
          : `Connected to "${activeSessionSchedule?.lesson_title || 'Classroom'}"`,
        'success',
      );
    } else {
      addToast?.(
        lang === 'zh' ? '暂无可接入的课堂' : 'No Live Session',
        lang === 'zh' ? '当前暂无正在进行的课节，请查看课表安排' : 'No ongoing classroom session scheduled',
        'info',
      );
    }
  };

  // 2. Action: View Latest Assignments
  const handleViewLatestAssignments = () => {
    setIsOpen(false);
    onExpandWidget?.('upcoming-assignments');

    const widgetEl = document.getElementById('widget-upcoming-assignments');
    if (widgetEl) {
      widgetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      widgetEl.classList.add('ring-4', 'ring-indigo-500/40');
      setTimeout(() => {
        widgetEl.classList.remove('ring-4', 'ring-indigo-500/40');
      }, 2000);
    } else if (pendingAssignments.length > 0) {
      setSelectedAssignment(pendingAssignments[0]);
      setStudentViewStatus('assignment');
    }
  };

  // 2b. Direct Jump into first pending assignment
  const handleDirectOpenAssignment = (ast: any) => {
    setSelectedAssignment(ast);
    setStudentViewStatus('assignment');
    setIsOpen(false);
  };

  // 3. Action: Check Notifications / Roll-Call
  const handleAcknowledgeRollCall = async (rollcallId: string) => {
    try {
      if (activeStudentId) {
        await fetch(`/api/students/${activeStudentId}/read_notifications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationId: rollcallId }),
        });
      }
    } catch {
      // Ignore network errors
    }
    setReadNotifications((prev) => {
      const next = new Set(prev);
      next.add(rollcallId);
      return next;
    });
    addToast?.(
      lang === 'zh' ? '点名确认成功' : 'Roll Call Confirmed',
      lang === 'zh' ? '已向教师端大屏同步您的参与状态' : 'Attendance signal sent to teacher',
      'success',
    );
  };

  // 4. Plugin Action Click Handler
  const handlePluginActionClick = (action: StudentQuickActionItem) => {
    if (action.disabled) return;
    setIsOpen(false);
    if (action.onClick) {
      action.onClick({
        activeStudentId,
        lessonId: activeSessionSchedule?.lesson_id,
        assignments,
        schedules,
        rollcalls,
        lang,
      });
    } else if (action.commandType) {
      try {
        (window as any).openlearn?.commandBus?.execute({
          type: action.commandType,
          payload: action.commandPayload,
          actorId: activeStudentId,
        });
      } catch (err) {
        console.warn('[StudentQuickActions] Failed to dispatch plugin command:', err);
      }
    }
  };

  return (
    <div
      ref={menuRef}
      id="student-quick-actions-container"
      data-compact={isCompact ? 'true' : 'false'}
      data-is-mobile={screenInfo.isMobile ? 'true' : 'false'}
      className="fixed bottom-6 right-6 z-50 flex flex-col items-end pointer-events-auto"
    >
      {/* Expanded Floating Popover Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 15 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="mb-3 w-[calc(100vw-2.5rem)] max-w-[340px] sm:w-[380px] bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-900 to-indigo-950 text-white">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/30 flex items-center justify-center text-indigo-300 shrink-0">
                  <Zap size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-100 truncate">
                      {lang === 'zh' ? '学生快捷指令 (Quick Actions)' : 'Quick Actions'}
                    </h4>
                    {isCompact && (
                      <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-indigo-500/40 text-indigo-200 shrink-0">
                        {lang === 'zh' ? '紧凑' : 'Compact'}
                      </span>
                    )}
                  </div>
                  <p className="text-2xs text-slate-400 truncate">
                    {lang === 'zh' ? '一键直达课堂、作业与插件扩展' : 'Fast navigation & plugin actions'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                {/* Manual Compact Mode Toggle */}
                <button
                  type="button"
                  onClick={() => setUserCompactOverride((prev) => (prev === null ? !screenInfo.isMobile : !prev))}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title={
                    isCompact
                      ? lang === 'zh'
                        ? '恢复标准模式'
                        : 'Expanded FAB'
                      : lang === 'zh'
                        ? '切换紧凑图标模式'
                        : 'Compact FAB'
                  }
                >
                  {isCompact ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title={lang === 'zh' ? '关闭' : 'Close'}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Sub-view: Main Menu or Notifications */}
            {activeTab === 'menu' ? (
              <div className="p-3.5 flex flex-col gap-2.5 max-h-[460px] overflow-y-auto">
                {/* 1. Action Card: Join Live Session */}
                <div
                  id="qa-action-join-live"
                  onClick={handleJoinLiveSession}
                  className="group/item flex items-center justify-between p-3 rounded-xl border border-slate-200/80 bg-slate-50/70 hover:bg-indigo-50/60 hover:border-indigo-300 transition-all cursor-pointer shadow-3xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-500 to-orange-400 text-white flex items-center justify-center shrink-0 shadow-xs relative">
                      <Radio size={18} className="animate-pulse" />
                      <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-black text-slate-800 tracking-tight group-hover/item:text-indigo-900 transition-colors">
                          {lang === 'zh' ? '进入实时课堂' : 'Join Live Session'}
                        </span>
                        <span className="text-2xs font-extrabold px-1.5 py-0.2 rounded bg-rose-100 text-rose-700">
                          LIVE
                        </span>
                      </div>
                      <p className="text-2xs text-slate-500 truncate mt-0.5">
                        {activeSessionSchedule
                          ? activeSessionSchedule.lesson_title || activeSessionSchedule.title || '当前课堂'
                          : lang === 'zh'
                            ? '点击接入今日课堂与互动白板'
                            : 'Connect to live interactive lesson'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight
                    size={16}
                    className="text-slate-400 group-hover/item:text-indigo-600 group-hover/item:translate-x-0.5 transition-all shrink-0"
                  />
                </div>

                {/* 2. Action Card: View Latest Assignments */}
                <div
                  id="qa-action-view-assignments"
                  onClick={handleViewLatestAssignments}
                  className="group/item flex items-center justify-between p-3 rounded-xl border border-slate-200/80 bg-slate-50/70 hover:bg-teal-50/60 hover:border-teal-300 transition-all cursor-pointer shadow-3xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-400 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <ClipboardList size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-black text-slate-800 tracking-tight group-hover/item:text-teal-900 transition-colors">
                          {lang === 'zh' ? '查看待办作业' : 'View Latest Assignments'}
                        </span>
                        {pendingAssignments.length > 0 && (
                          <span className="text-2xs font-extrabold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                            {pendingAssignments.length} {lang === 'zh' ? '待提交' : 'pending'}
                          </span>
                        )}
                      </div>
                      <p className="text-2xs text-slate-500 truncate mt-0.5">
                        {pendingAssignments.length > 0
                          ? `${pendingAssignments[0].title} · ${lang === 'zh' ? '未提交' : 'pending'}`
                          : lang === 'zh'
                            ? '全部作业已完成或待批改'
                            : 'All assignments submitted'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight
                    size={16}
                    className="text-slate-400 group-hover/item:text-teal-600 group-hover/item:translate-x-0.5 transition-all shrink-0"
                  />
                </div>

                {/* Quick direct access to pending assignment */}
                {pendingAssignments.length > 0 && (
                  <div className="bg-amber-50/70 border border-amber-200/70 rounded-xl p-2.5 flex items-center justify-between text-2xs">
                    <div className="flex items-center gap-1.5 text-amber-900 font-semibold truncate mr-2">
                      <Clock size={12} className="text-amber-600 shrink-0" />
                      <span className="truncate">{pendingAssignments[0].title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDirectOpenAssignment(pendingAssignments[0])}
                      className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold shrink-0 transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                    >
                      <span>{lang === 'zh' ? '直接答题' : 'Open'}</span>
                      <ArrowRight size={10} />
                    </button>
                  </div>
                )}

                {/* 3. Action Card: Check Notifications */}
                <div
                  id="qa-action-check-notifications"
                  onClick={() => setActiveTab('notifications')}
                  className="group/item flex items-center justify-between p-3 rounded-xl border border-slate-200/80 bg-slate-50/70 hover:bg-blue-50/60 hover:border-blue-300 transition-all cursor-pointer shadow-3xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-500 text-white flex items-center justify-center shrink-0 shadow-xs relative">
                      <Bell size={18} />
                      {unreadRollcalls.length > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-black">
                          {unreadRollcalls.length}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-black text-slate-800 tracking-tight group-hover/item:text-blue-900 transition-colors">
                          {lang === 'zh' ? '检查消息与点名' : 'Check Notifications'}
                        </span>
                        {unreadRollcalls.length > 0 ? (
                          <span className="text-2xs font-extrabold px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 animate-pulse">
                            {lang === 'zh' ? '提问点名待应答' : 'Roll Call Alarm'}
                          </span>
                        ) : (
                          <span className="text-2xs font-medium text-slate-400">
                            {lang === 'zh' ? '无未读' : 'All clear'}
                          </span>
                        )}
                      </div>
                      <p className="text-2xs text-slate-500 truncate mt-0.5">
                        {unreadRollcalls.length > 0
                          ? lang === 'zh'
                            ? `有 ${unreadRollcalls.length} 条课堂点名提问等待回应`
                            : `${unreadRollcalls.length} active roll-call alarms`
                          : lang === 'zh'
                            ? '查看历史点名出勤与批改反馈'
                            : 'View notifications & alerts'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight
                    size={16}
                    className="text-slate-400 group-hover/item:text-blue-600 group-hover/item:translate-x-0.5 transition-all shrink-0"
                  />
                </div>

                {/* 4. Third-Party Plugin Contributed Quick Actions */}
                {combinedPluginActions.length > 0 && (
                  <div className="flex flex-col gap-2 pt-1 border-t border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {lang === 'zh' ? '插件扩展指令' : 'Plugin Actions'}
                    </span>
                    {combinedPluginActions.map((action) => {
                      if (action.customRenderer) {
                        return (
                          <React.Fragment key={action.id}>
                            {action.customRenderer(action, {
                              activeStudentId,
                              lessonId: activeSessionSchedule?.lesson_id,
                              lang,
                              closeMenu: () => setIsOpen(false),
                            })}
                          </React.Fragment>
                        );
                      }

                      return (
                        <div
                          key={action.id}
                          id={`qa-action-plugin-${action.id}`}
                          onClick={() => handlePluginActionClick(action)}
                          className={`group/item flex items-center justify-between p-3 rounded-xl border border-slate-200/80 bg-slate-50/70 hover:bg-indigo-50/60 hover:border-indigo-300 transition-all cursor-pointer shadow-3xs ${
                            action.disabled ? 'opacity-50 pointer-events-none' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                              {renderActionIcon(action.icon)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-black text-slate-800 tracking-tight group-hover/item:text-indigo-900 transition-colors truncate">
                                  {action.title}
                                </span>
                                {action.badge && (
                                  <span
                                    className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded border ${getBadgeColorClasses(
                                      action.badgeVariant,
                                    )}`}
                                  >
                                    {action.badge}
                                  </span>
                                )}
                              </div>
                              {action.description && (
                                <p className="text-2xs text-slate-500 truncate mt-0.5">{action.description}</p>
                              )}
                            </div>
                          </div>
                          <ChevronRight
                            size={16}
                            className="text-slate-400 group-hover/item:text-indigo-600 group-hover/item:translate-x-0.5 transition-all shrink-0"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Third-party Plugin Extension Slot: student.quick_actions.item */}
                <ExtensionPointRenderer
                  slot="student.quick_actions.item"
                  slotProps={{
                    studentId: activeStudentId,
                    lessonId: activeSessionSchedule?.lesson_id,
                    lang,
                    isCompact,
                    closeMenu: () => setIsOpen(false),
                  }}
                />

                {/* Third-party Plugin Extension Slot: student.quick_actions.action */}
                <ExtensionPointRenderer
                  slot="student.quick_actions.action"
                  slotProps={{
                    studentId: activeStudentId,
                    lang,
                    isCompact,
                  }}
                />
              </div>
            ) : (
              /* Sub-view: Notifications & Roll Calls Drawer */
              <div className="p-3.5 flex flex-col gap-3 max-h-[360px] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Bell size={13} className="text-indigo-600" />
                    <span>{lang === 'zh' ? '消息与点名通知清单' : 'Notifications & Alarms'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('menu')}
                    className="text-2xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                  >
                    {lang === 'zh' ? '返回主菜单' : 'Back to menu'}
                  </button>
                </div>

                {unreadRollcalls.length > 0 ? (
                  <div className="space-y-2">
                    <span className="text-2xs font-bold text-rose-600 uppercase tracking-wider">
                      {lang === 'zh' ? '🔴 紧急课堂点名' : 'Urgent Roll Calls'}
                    </span>
                    {unreadRollcalls.map((rc: any) => (
                      <div
                        key={rc.id}
                        className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 flex flex-col gap-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-bold text-amber-900">
                              {lang === 'zh' ? '⚡️ 老师向您发起了随堂提问点名' : 'Teacher Roll Call Alarm'}
                            </div>
                            <div className="text-2xs text-amber-800 mt-0.5">
                              {rc.lesson_title || (lang === 'zh' ? '面授课堂' : 'Classroom')}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAcknowledgeRollCall(rc.id)}
                          className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-2xs font-extrabold flex items-center justify-center gap-1 shadow-2xs transition-colors cursor-pointer"
                        >
                          <CheckCircle2 size={12} />
                          <span>{lang === 'zh' ? '立即确认签到回应' : 'Confirm Presence'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-slate-400 text-xs italic">
                    {lang === 'zh' ? '🎉 太棒了，当前没有未处理的点名与紧急通知' : 'No unread roll-call alarms.'}
                  </div>
                )}

                {/* Graded Assignments Feed */}
                <div className="space-y-1.5 border-t border-slate-100 pt-2">
                  <span className="text-2xs font-bold text-slate-450 uppercase tracking-wider block">
                    {lang === 'zh' ? '最新作业评定情况' : 'Recent Graded Work'}
                  </span>
                  {assignments.slice(0, 3).map((ast: any) => (
                    <div
                      key={ast.id}
                      className="flex items-center justify-between text-2xs p-2 rounded-lg bg-slate-50 border border-slate-200/60"
                    >
                      <span className="font-semibold text-slate-700 truncate max-w-[170px]">{ast.title}</span>
                      {ast.submission_status === 'graded' ? (
                        <span className="font-bold text-emerald-600 bg-emerald-100/60 px-1.5 py-0.5 rounded">
                          {ast.score}%
                        </span>
                      ) : (
                        <span className="text-amber-700 bg-amber-100/60 px-1.5 py-0.5 rounded font-medium">
                          {ast.submission_status ? '已交' : '未交'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer Tip */}
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-2xs text-slate-450">
              <span>{lang === 'zh' ? '快捷键 Esc 退出菜单' : 'Press Esc to close'}</span>
              <span className="font-mono text-indigo-600 font-bold">OpenLearn</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Action Trigger Button Area with Third-Party Plugin Slots */}
      <div className="flex items-center gap-2">
        {/* Third-party Plugin Slot for FAB Addons (e.g. mini notification badges or auxiliary actions) */}
        <ExtensionPointRenderer
          slot="student.quick_actions.fab"
          slotProps={{
            isCompact,
            isOpen,
            urgentCount: totalUrgentCount,
            screenInfo,
          }}
        />

        {/* Custom FAB Renderer Option for Plugins, or Default FAB */}
        {customFabRenderer ? (
          customFabRenderer({
            isCompact,
            isOpen,
            toggle: () => setIsOpen(!isOpen),
            urgentCount: totalUrgentCount,
            screenInfo,
          })
        ) : (
          <button
            id="student-quick-actions-fab-btn"
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            data-compact={isCompact ? 'true' : 'false'}
            data-is-mobile={screenInfo.isMobile ? 'true' : 'false'}
            className={`group relative flex items-center justify-center transition-all duration-200 cursor-pointer border border-white/20 shadow-lg hover:shadow-xl active:scale-95 bg-gradient-to-r from-indigo-600 via-indigo-700 to-teal-600 hover:from-indigo-700 hover:to-teal-700 text-white ${
              isCompact ? 'w-11 h-11 p-0 rounded-full' : 'gap-2 px-4 py-3 rounded-full'
            }`}
            title={
              lang === 'zh'
                ? isCompact
                  ? '快捷操作 (点击展开)'
                  : '学生快捷操作菜单 (Quick Actions)'
                : isCompact
                  ? 'Quick Actions'
                  : 'Student Quick Actions'
            }
          >
            {/* Urgent counter badge */}
            {totalUrgentCount > 0 && (
              <span
                className={`absolute flex items-center justify-center rounded-full bg-rose-500 text-white font-black shadow-sm ring-2 ring-white ${
                  isCompact ? '-top-1 -right-1 h-4 w-4 text-[9px]' : '-top-1.5 -left-1.5 h-5 w-5 text-[10px]'
                }`}
              >
                {totalUrgentCount}
              </span>
            )}

            {isOpen ? (
              <X size={isCompact ? 18 : 18} className="text-white" />
            ) : (
              <Zap size={isCompact ? 18 : 18} className="text-amber-300 animate-pulse" />
            )}

            {/* In expanded mode, show label text. In compact mobile mode, collapse into icon-only to preserve screen space! */}
            {!isCompact && (
              <span className="text-xs font-extrabold tracking-tight hidden sm:inline-block">
                {isOpen
                  ? lang === 'zh'
                    ? '关闭指令'
                    : 'Close'
                  : lang === 'zh'
                    ? '快捷指令'
                    : 'Quick Actions'}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default StudentQuickActionsFloatingMenu;
