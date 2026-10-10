import type { Dispatch, SetStateAction } from 'react';
import { useOptionalAppData } from '../context/AppDataContext';
import {
  Bell,
  Globe,
  Home,
  LayoutTemplate,
  Database,
  ClipboardList,
  CheckCircle2,
  Eye,
  LogOut,
  Lock,
  X,
} from 'lucide-react';
import { UserMenu } from './UserMenu';
import { ThemeSelector } from './ThemeSelector';
import { FontSizeSelector } from './FontSizeSelector';
import { StudentLiveHeader } from './StudentLiveHeader';
import { ExtensionPointRenderer } from '../plugin-host/extension-point-renderer';

export interface AppHeaderProps {
  activeRole?: 'teacher' | 'student';
  setActiveRole?: Dispatch<SetStateAction<'teacher' | 'student'>> | ((role: 'teacher' | 'student') => void);
  /**
   * 当前页是课程编辑器「学生视角」开出的独立预览标签页：
   * 退出动作为「关闭标签页」而非「返回教师端」（该标签页内不存在教师端）。
   */
  studentPreviewTab?: boolean;
  lang?: 'zh' | 'en';
  teacherTab?: string;
  studentViewStatus?: 'dashboard' | 'lesson' | 'assignment';
  session?: any;
  activeStudentId?: string | null;
  students?: any[];
  studentDashboardData?: any;
  isNotificationsOpen?: boolean;
  studentNotifications?: any[];
  unreadNotifications?: any[];
  readNotifications?: Set<string>;
  selectedNotificationForModal?: any;
  dbConnected?: boolean;
  dbStatus?: 'normal' | 'warning' | 'error';
  siteInfo?: any;
  setActiveStudentId?: Dispatch<SetStateAction<string | null>>;
  setReadNotifications?:
    Dispatch<SetStateAction<Set<string>>> | ((updater: (prev: Set<string>) => Set<string>) => void);
  setIsSystemResourceLibraryOpen?: Dispatch<SetStateAction<boolean>>;
  setProfileOpen?: Dispatch<SetStateAction<boolean>>;
  setTeacherTab?: (tab: string) => void;
  setStudentViewStatus?: Dispatch<SetStateAction<'dashboard' | 'lesson' | 'assignment'>>;
  setIsNotificationsOpen?: Dispatch<SetStateAction<boolean>>;
  setSelectedNotificationForModal?: Dispatch<SetStateAction<any | null>>;
  handleLogout?: () => void;
  toggleLanguage?: () => void;
  /** 全班专注锁定中：学生端禁止切换页面 */
  isStudentLocked?: boolean;
  /** 锁定期间尝试导航时的回调（用于弹出提示） */
  onBlockedNavigate?: () => void;
}

export function AppHeader(props: AppHeaderProps) {
  const appData = useOptionalAppData();

  const activeRole = props.activeRole ?? appData?.activeRole ?? 'teacher';
  const studentPreviewTab = props.studentPreviewTab ?? appData?.isStudentPreviewMode ?? false;
  const lang = (props.lang ?? appData?.lang ?? 'zh') as 'zh' | 'en';
  const teacherTab = props.teacherTab ?? appData?.teacherTab ?? 'live_class';
  const studentViewStatus = props.studentViewStatus ?? appData?.studentViewStatus ?? 'dashboard';
  const session = props.session !== undefined ? props.session : appData?.session;
  const activeStudentId =
    props.activeStudentId !== undefined ? props.activeStudentId : (appData?.activeStudentId ?? null);
  const students = props.students ?? appData?.students ?? [];
  const studentDashboardData = props.studentDashboardData ?? appData?.studentDashboardData ?? null;
  const isNotificationsOpen = props.isNotificationsOpen ?? appData?.isNotificationsOpen ?? false;
  const studentNotifications = props.studentNotifications ?? appData?.studentNotifications ?? [];
  const unreadNotifications = props.unreadNotifications ?? appData?.unreadNotifications ?? [];
  const readNotifications = props.readNotifications ?? appData?.readNotifications ?? new Set<string>();
  const selectedNotificationForModal =
    props.selectedNotificationForModal !== undefined
      ? props.selectedNotificationForModal
      : (appData?.selectedNotificationForModal ?? null);
  const dbConnected = props.dbConnected ?? appData?.dbConnected ?? false;
  const dbStatus = props.dbStatus ?? appData?.dbStatus ?? 'normal';
  const siteInfo = props.siteInfo ?? appData?.siteInfo;
  const setActiveStudentId = props.setActiveStudentId ?? appData?.setActiveStudentId ?? (() => {});
  const setReadNotifications = props.setReadNotifications ?? appData?.setReadNotifications ?? (() => {});
  const setIsSystemResourceLibraryOpen =
    props.setIsSystemResourceLibraryOpen ?? appData?.setIsSystemResourceLibraryOpen ?? (() => {});
  const setProfileOpen = props.setProfileOpen ?? appData?.setProfileOpen ?? (() => {});
  const setTeacherTab = props.setTeacherTab ?? appData?.setTeacherTab ?? (() => {});
  const setStudentViewStatus = props.setStudentViewStatus ?? appData?.setStudentViewStatus ?? (() => {});
  const setIsNotificationsOpen = props.setIsNotificationsOpen ?? appData?.setIsNotificationsOpen ?? (() => {});
  const setSelectedNotificationForModal =
    props.setSelectedNotificationForModal ?? appData?.setSelectedNotificationForModal ?? (() => {});
  const handleLogout = props.handleLogout ?? appData?.handleLogout ?? appData?.onLogout ?? (() => {});
  const toggleLanguage = props.toggleLanguage ?? appData?.toggleLanguage ?? (() => {});
  const setActiveRole = props.setActiveRole ?? appData?.setActiveRole ?? (() => {});
  const isStudentLocked = props.isStudentLocked ?? appData?.isStudentLocked ?? false;
  const onBlockedNavigate = props.onBlockedNavigate ?? appData?.notifyLockedNavigation;

  // 独立弹窗模式下渲染轻量化互动课堂专属 Header
  if (appData?.isStudentLiveMode) {
    return <StudentLiveHeader />;
  }

  // 学生端被全班专注锁定时，禁止跳转到首页（品牌区 / 系统总览按钮）
  const isStudentNavigationBlocked = activeRole === 'student' && isStudentLocked;

  /** 品牌区 Logo：教师/管理员回首页（互动课堂），学生回 Dashboard */
  const goToHome = () => {
    if (isStudentNavigationBlocked) {
      onBlockedNavigate?.();
      return;
    }
    if (activeRole === 'teacher') {
      setTeacherTab('live_class');
    } else if (activeRole === 'student') {
      setStudentViewStatus('dashboard');
    }
  };

  /** 「系统总览」导航入口：始终去 Dashboard，教师端与学生端各自的 overview */
  const goToDashboard = () => {
    if (isStudentNavigationBlocked) {
      onBlockedNavigate?.();
      return;
    }
    if (activeRole === 'teacher') {
      setTeacherTab('dashboard');
    } else if (activeRole === 'student') {
      setStudentViewStatus('dashboard');
    }
  };

  return (
    <header className="h-16 border-b border-theme bg-surface text-main flex items-center px-6 justify-between shrink-0 shadow-sm relative z-20 transition-colors duration-200">
      <div className="flex items-center gap-4 sm:gap-6">
        {/* 站点品牌区 (Site Brand & Logo) — click to home (教师端为互动课堂) */}
        <button
          onClick={goToHome}
          className="flex items-center gap-2.5 shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
          title={
            isStudentNavigationBlocked
              ? lang === 'zh'
                ? '全班专注锁定中，无法返回首页'
                : 'Class focus locked — cannot return to home'
              : lang === 'zh'
                ? '返回首页'
                : 'Back to Home'
          }
        >
          {siteInfo.logoUrl ? (
            <img src={siteInfo.logoUrl} alt="site logo" className="h-8 w-8 object-contain rounded-lg shrink-0" />
          ) : (
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-indigo-700 flex items-center justify-center text-white font-black text-sm shadow-xs shrink-0">
              OL
            </div>
          )}
          <div className="flex items-baseline gap-2">
            <span className="text-base font-black text-slate-900 tracking-tight">
              {siteInfo.siteName || 'OpenLearn Next'}
            </span>
            <span className="text-xs font-medium text-slate-400 tracking-tight">v{__APP_VERSION__}</span>
            {siteInfo.slogan && (
              <span className="hidden md:inline text-xs text-slate-400 font-normal truncate max-w-[200px]">
                {siteInfo.slogan}
              </span>
            )}
          </div>
        </button>

        {/* Dashboard nav entry */}
        <button
          onClick={goToDashboard}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
            (activeRole === 'teacher' && teacherTab === 'dashboard') ||
            (activeRole === 'student' && studentViewStatus === 'dashboard')
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-slate-600 hover:text-indigo-600 hover:bg-slate-100'
          } ${isStudentNavigationBlocked ? 'opacity-50' : ''}`}
        >
          {isStudentNavigationBlocked ? <Lock size={16} /> : <Home size={16} />}
          {lang === 'zh' ? '系统总览' : 'Dashboard'}
        </button>

        {activeRole === 'student' && (
          <>
            <span className="text-slate-300 font-light text-lg select-none">/</span>
            <h2 className="font-semibold text-gray-800 tracking-tight flex items-center gap-2">
              <LayoutTemplate size={20} className="text-gray-400" />
              Student Dashboard
            </h2>
          </>
        )}

        {activeRole === 'student' && session?.role === 'teacher' && (
          <div className="flex items-center gap-2 bg-amber-50/90 border border-amber-200/80 px-2.5 py-1 rounded-lg shadow-2xs">
            <span className="text-xs font-semibold text-amber-800 flex items-center gap-1">
              <Eye size={13} className="text-amber-600" />
              {lang === 'zh' ? '模拟学生:' : 'View as:'}
            </span>
            <select
              className="border border-amber-300 rounded px-1.5 py-0.5 text-xs bg-white text-gray-800 font-medium focus:ring-1 focus:ring-amber-400 focus:outline-hidden"
              value={activeStudentId || ''}
              onChange={(e) => setActiveStudentId(e.target.value)}
            >
              <option value="">-- {lang === 'zh' ? '选择学生' : 'Select Student'} --</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                // 备课预览标签页内没有教师端可回，改为关闭该标签页
                if (studentPreviewTab) {
                  window.close();
                  return;
                }
                setActiveRole?.('teacher');
              }}
              className="ml-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs font-bold rounded-md flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
              title={
                lang === 'zh'
                  ? studentPreviewTab
                    ? '关闭此学生视角预览标签页'
                    : '退出模拟学生并返回教师端工作台'
                  : studentPreviewTab
                    ? 'Close this student preview tab'
                    : 'Exit student view and return to teacher workspace'
              }
            >
              {studentPreviewTab ? <X size={12} /> : <LogOut size={12} />}
              {lang === 'zh'
                ? studentPreviewTab
                  ? '关闭预览'
                  : '返回教师端'
                : studentPreviewTab
                  ? 'Close Tab'
                  : 'Exit Student View'}
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 text-sm text-gray-500">
        {activeRole === 'student' && activeStudentId && studentDashboardData && (
          <div className="relative">
            <button
              onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
              className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
            >
              <Bell size={20} />
              {unreadNotifications.length > 0 && (
                <span className="absolute top-1 right-1 bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full flex items-center justify-center min-w-[18px]">
                  {unreadNotifications.length}
                </span>
              )}
            </button>

            {isNotificationsOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 shadow-lg rounded-xl z-50 overflow-hidden">
                <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <h3 className="font-semibold text-gray-800">Notifications</h3>
                  {unreadNotifications.length > 0 && (
                    <button
                      onClick={async () => {
                        if (!activeStudentId) return;
                        try {
                          const promises = studentNotifications
                            .filter((n) => !readNotifications.has(n.id))
                            .map((n) => {
                              return fetch(`/api/students/${activeStudentId}/read_notifications`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ notificationId: n.id }),
                              });
                            });
                          await Promise.all(promises);
                        } catch (e) {
                          console.error(e);
                        }
                        setReadNotifications((prev: Set<string>) => {
                          const nextRead = new Set(prev);
                          studentNotifications.forEach((n) => nextRead.add(n.id));
                          return nextRead;
                        });
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {studentNotifications.length === 0 ? (
                    <div className="p-4 text-center text-sm text-gray-500 italic">No notifications.</div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {studentNotifications.map((notif) => {
                        const isUnread = !readNotifications.has(notif.id);
                        return (
                          <div
                            key={notif.id}
                            className={`p-3 hover:bg-gray-50 cursor-pointer ${isUnread ? 'bg-indigo-50/30' : ''}`}
                            onClick={() => {
                              if (isUnread) {
                                if (activeStudentId) {
                                  fetch(`/api/students/${activeStudentId}/read_notifications`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ notificationId: notif.id }),
                                  }).catch(console.error);
                                }
                                setReadNotifications((prev: Set<string>) => new Set(prev).add(notif.id));
                              }
                              const assocAssignment = studentDashboardData?.assignments?.find(
                                (a: any) => a.id === notif.relatedId,
                              );
                              setSelectedNotificationForModal({
                                ...notif,
                                assignment: assocAssignment,
                              });
                              setIsNotificationsOpen(false);
                            }}
                          >
                            <div className="flex gap-3">
                              <div className="mt-0.5">
                                {notif.type === 'new_assignment' ? (
                                  <ClipboardList size={16} className="text-indigo-500" />
                                ) : (
                                  <CheckCircle2 size={16} className="text-green-500" />
                                )}
                              </div>
                              <div className="flex-1">
                                <div
                                  className={`text-sm ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}
                                >
                                  {notif.title}
                                </div>
                                <div className={`text-xs mt-0.5 ${isUnread ? 'text-gray-600' : 'text-gray-500'}`}>
                                  {notif.message}
                                </div>
                              </div>
                              {isUnread && <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1"></div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {/* 第三方全局顶栏快捷操作扩展槽（全局 AI 助手 / 屏幕录制 / 校园门户直通等） */}
        <div id="app-header-plugin-actions" className="flex items-center gap-2 empty:hidden">
          <ExtensionPointRenderer
            slot="header.action"
            lang={lang}
            fallback={<></>}
            slotProps={{ session, currentRole: activeRole, lang }}
          />
        </div>
        <button
          onClick={() => setIsSystemResourceLibraryOpen(true)}
          className="flex items-center gap-1.5 hover:text-primary-theme transition-colors bg-surface text-main px-3 py-1.5 rounded-md border border-theme shadow-sm font-medium cursor-pointer"
        >
          <Globe size={14} className="text-emerald-500 animate-pulse" />
          {lang === 'zh' ? '系统资源库' : 'System Resource Library'}
        </button>
        <button
          onClick={toggleLanguage}
          title={lang === 'zh' ? 'Switch to English' : '切换为中文'}
          className="p-2 hover:bg-surface-secondary text-main transition-colors bg-surface rounded-lg border border-theme shadow-3xs flex items-center justify-center shrink-0 cursor-pointer"
        >
          <Globe size={16} />
        </button>

        <FontSizeSelector lang={lang} />
        <ThemeSelector lang={lang} />

        {/* Database Connection Status Icon Indicator */}
        {(() => {
          const statusColor =
            dbStatus === 'error' || !dbConnected
              ? {
                  bg: 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100 animate-pulse',
                  dot: 'bg-rose-500',
                  ping: 'bg-rose-400',
                  label: lang === 'zh' ? 'SQLite 数据库连接出错或已断开' : 'SQLite DB Error / Disconnected',
                }
              : dbStatus === 'warning'
                ? {
                    bg: 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100',
                    dot: 'bg-amber-500',
                    ping: 'bg-amber-400',
                    label: lang === 'zh' ? 'SQLite 数据库存在状态警告' : 'SQLite DB Warning',
                  }
                : {
                    bg: 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100',
                    dot: 'bg-emerald-500',
                    ping: 'bg-emerald-400',
                    label: lang === 'zh' ? 'SQLite 数据库连接正常' : 'SQLite DB Connected & Normal',
                  };

          return (
            <div
              id="db-connection-status-badge"
              className={`w-8 h-8 rounded-lg border flex items-center justify-center relative select-none shrink-0 cursor-pointer transition-colors shadow-3xs ${statusColor.bg}`}
              title={statusColor.label}
            >
              <Database size={15} />
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusColor.ping}`}
                />
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${statusColor.dot}`} />
              </span>
            </div>
          );
        })()}

        <UserMenu session={session} lang={lang} onLogout={handleLogout} onProfile={() => setProfileOpen(true)} />
      </div>
    </header>
  );
}
