import type { Dispatch, SetStateAction } from 'react';
import {
  Bell,
  Globe,
  Home,
  LayoutTemplate,
  Database,
  ClipboardList,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { UserMenu } from './UserMenu';

export interface AppHeaderProps {
  activeRole: 'teacher' | 'student';
  lang: 'zh' | 'en';
  teacherTab: string;
  studentViewStatus: 'dashboard' | 'lesson' | 'assignment';
  session: any;
  activeStudentId: string | null;
  students: any[];
  studentDashboardData: any;
  isNotificationsOpen: boolean;
  studentNotifications: any[];
  unreadNotifications: any[];
  readNotifications: Set<string>;
  selectedNotificationForModal: any;
  dbConnected: boolean;
  dbStatus: 'normal' | 'warning' | 'error';
  siteInfo: any;
  setActiveStudentId: Dispatch<SetStateAction<string | null>>;
  setReadNotifications: Dispatch<SetStateAction<Set<string>>>;
  setIsSystemResourceLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setProfileOpen: Dispatch<SetStateAction<boolean>>;
  setTeacherTab: (tab: string) => void;
  setStudentViewStatus: Dispatch<SetStateAction<'dashboard' | 'lesson' | 'assignment'>>;
  setIsNotificationsOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedNotificationForModal: Dispatch<SetStateAction<any | null>>;
  handleLogout: () => void;
  toggleLanguage: () => void;
}

export function AppHeader(props: AppHeaderProps) {
  const {
    activeRole,
    lang,
    teacherTab,
    studentViewStatus,
    session,
    activeStudentId,
    students,
    studentDashboardData,
    isNotificationsOpen,
    studentNotifications,
    unreadNotifications,
    readNotifications,
    dbConnected,
    dbStatus,
    siteInfo,
    setActiveStudentId,
    setReadNotifications,
    setIsSystemResourceLibraryOpen,
    setProfileOpen,
    setTeacherTab,
    setStudentViewStatus,
    setIsNotificationsOpen,
    setSelectedNotificationForModal,
    handleLogout,
    toggleLanguage,
  } = props;

  return (
    <header className="h-16 border-b border-gray-200 bg-white flex items-center px-6 justify-between shrink-0 shadow-sm relative z-20">
     <div className="flex items-center gap-4 sm:gap-6">
        {/* 站点品牌区 (Site Brand & Logo) — click to dashboard */}
        <button
          onClick={() => {
            if (activeRole === 'teacher') {
              setTeacherTab('dashboard');
            } else if (activeRole === 'student') {
              setStudentViewStatus('dashboard');
            }
          }}
          className="flex items-center gap-2.5 shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
          title={lang === 'zh' ? '返回系统总览' : 'Back to Dashboard'}
        >
          {siteInfo.logoUrl ? (
            <img src={siteInfo.logoUrl} alt="site logo" className="h-8 w-8 object-contain rounded-lg shrink-0" />
          ) : (
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-indigo-700 flex items-center justify-center text-white font-black text-sm shadow-xs shrink-0">OL</div>
          )}
          <div className="flex items-baseline gap-2">
            <span className="text-base font-black text-slate-900 tracking-tight">
              {siteInfo.siteName || 'OpenLearn Next'}
            </span>
            <span className="text-[10px] font-medium text-slate-400 tracking-tight">v{__APP_VERSION__}</span>
            {siteInfo.slogan && (
              <span className="hidden md:inline text-xs text-slate-400 font-normal truncate max-w-[200px]">
                {siteInfo.slogan}
              </span>
            )}
          </div>
        </button>

        {/* Dashboard nav entry */}
        <button
          onClick={() => {
            if (activeRole === 'teacher') {
              setTeacherTab('dashboard');
            } else if (activeRole === 'student') {
              setStudentViewStatus('dashboard');
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
            (activeRole === 'teacher' && teacherTab === 'dashboard') ||
            (activeRole === 'student' && studentViewStatus === 'dashboard')
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-slate-600 hover:text-indigo-600 hover:bg-slate-100'
          }`}
        >
          <Home size={16} />
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
        
        {activeRole === 'student' && session.role === 'teacher' && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">View as:</span>
            <select 
              className="border border-gray-200 rounded p-1 text-sm bg-white"
              value={activeStudentId || ''}
              onChange={(e) => setActiveStudentId(e.target.value)}
            >
              <option value="">-- Select Student --</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
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
                <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center justify-center min-w-[18px]">
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
                            .filter(n => !readNotifications.has(n.id))
                            .map(n => {
                              return fetch(`/api/students/${activeStudentId}/read_notifications`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ notificationId: n.id })
                              });
                            });
                          await Promise.all(promises);
                        } catch (e) {
                          console.error(e);
                        }
                        const newRead = new Set(readNotifications);
                        studentNotifications.forEach(n => newRead.add(n.id));
                        setReadNotifications(newRead);
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
                      {studentNotifications.map(notif => {
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
                                    body: JSON.stringify({ notificationId: notif.id })
                                  }).catch(console.error);
                                }
                                const newRead = new Set(readNotifications);
                                newRead.add(notif.id);
                                setReadNotifications(newRead);
                              }
                              const assocAssignment = studentDashboardData?.assignments?.find((a: any) => a.id === notif.relatedId);
                              setSelectedNotificationForModal({
                                ...notif,
                                assignment: assocAssignment
                              });
                              setIsNotificationsOpen(false);
                            }}
                          >
                            <div className="flex gap-3">
                              <div className="mt-0.5">
                                {notif.type === 'new_assignment' ? (
                                  <ClipboardList size={16} className="text-indigo-500"/>
                                ) : notif.type === 'rollcall_picked' ? (
                                  <Sparkles size={16} className="text-amber-500 animate-pulse"/>
                                ) : (
                                  <CheckCircle2 size={16} className="text-green-500"/>
                                )}
                              </div>
                              <div className="flex-1">
                                <div className={`text-sm ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{notif.title}</div>
                                <div className={`text-xs mt-0.5 ${isUnread ? 'text-gray-600' : 'text-gray-500'}`}>{notif.message}</div>
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
        <button 
          onClick={() => setIsSystemResourceLibraryOpen(true)}
          className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors bg-white px-3 py-1.5 rounded-md border border-gray-200 shadow-sm font-medium cursor-pointer"
        >
          <Globe size={14} className="text-emerald-500 animate-pulse" />
          {lang === 'zh' ? '系统资源库' : 'System Resource Library'}
        </button>
        <button 
          onClick={toggleLanguage}
          title={lang === 'zh' ? 'Switch to English' : '切换为中文'}
          className="p-2 hover:bg-slate-100 text-slate-600 hover:text-indigo-600 transition-colors bg-white rounded-lg border border-gray-200 shadow-3xs flex items-center justify-center shrink-0 cursor-pointer"
        >
          <Globe size={16} />
        </button>

        {/* Database Connection Status Icon Indicator */}
        {(() => {
          const statusColor = dbStatus === 'error' || !dbConnected
            ? { bg: 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100 animate-pulse', dot: 'bg-rose-500', ping: 'bg-rose-400', label: lang === 'zh' ? 'SQLite 数据库连接出错或已断开' : 'SQLite DB Error / Disconnected' }
            : dbStatus === 'warning'
            ? { bg: 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100', dot: 'bg-amber-500', ping: 'bg-amber-400', label: lang === 'zh' ? 'SQLite 数据库存在状态警告' : 'SQLite DB Warning' }
            : { bg: 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100', dot: 'bg-emerald-500', ping: 'bg-emerald-400', label: lang === 'zh' ? 'SQLite 数据库连接正常' : 'SQLite DB Connected & Normal' };

          return (
            <div 
              id="db-connection-status-badge"
              className={`w-8 h-8 rounded-lg border flex items-center justify-center relative select-none shrink-0 cursor-pointer transition-colors shadow-3xs ${statusColor.bg}`}
              title={statusColor.label}
            >
              <Database size={15} />
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusColor.ping}`} />
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${statusColor.dot}`} />
              </span>
            </div>
          );
        })()}

        <UserMenu
          session={session}
          lang={lang}
          onLogout={handleLogout}
          onProfile={() => setProfileOpen(true)}
        />
      </div>
    </header>
  );
}
