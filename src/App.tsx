import React from 'react';
import { Loader2 } from 'lucide-react';
import { AppDataProvider } from './context/AppDataContext';
import { AcademicYearProvider } from './context/AcademicYearContext';
import { LoginPage } from './components/LoginPage';
import ForcedPasswordChangeGate from './components/ForcedPasswordChangeGate';
import { StageDisplayView } from './features/classroom/stage-display/StageDisplayView';
import { ImpersonationBanner } from './components/ImpersonationBanner';
import { StudentDefaultPasswordBanner } from './components/StudentDefaultPasswordBanner';
import { AppHeader } from './components/AppHeader';
import { AppStatusBar } from './components/AppStatusBar';
import { ProfileModal } from './components/ProfileModal';
import { AppShell } from './components/AppShell';
import { RightSidebar } from './features/shared/RightSidebar';
import { AppModals } from './components/AppModals';
import { ClassroomOverlays } from './components/ClassroomOverlays';
import { ToastContainer } from './features/shared/ToastContainer';
import { CommandPaletteHost } from './features/command-palette/CommandPaletteHost';
import { SystemErrorCenterModal } from './features/modals/SystemErrorCenterModal';
import ThemeFailsafeRecoveryButton from './components/ThemeFailsafeRecoveryButton';
import { useAppComposer } from './hooks/useAppComposer';

export default function App() {
  const {
    appData,
    sessionLoading,
    session,
    setSession,
    handleLoginSuccess,
    handleLogout,
    isStageDisplayMode,
    stageLessonParam,
    stageTitleParam,
    stageLangParam,
    activeRole,
    selectedLesson,
    lessons,
    profileOpen,
    setProfileOpen,
    lang,
  } = useAppComposer();

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    const siteName = appData.siteInfo?.siteName?.trim() || 'OpenLearn Next';
    const section = !session
      ? lang === 'en'
        ? 'Sign In'
        : '登录'
      : session.mustChangePassword
        ? lang === 'en'
          ? 'Change Default Password'
          : '修改默认密码'
        : isStageDisplayMode
          ? lang === 'en'
            ? 'Stage Display'
            : '大屏展台'
          : activeRole === 'student'
            ? lang === 'en'
              ? 'Student Space'
              : '学生学习空间'
            : lang === 'en'
              ? 'Teacher Workbench'
              : '教师工作台';
    document.title = section ? `${siteName} · ${section}` : siteName;
  }, [lang, appData.siteInfo?.siteName, session, isStageDisplayMode, activeRole]);

  if (sessionLoading) {
    return (
      <AcademicYearProvider>
        <AppDataProvider value={appData}>
          <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
            <Loader2 size={48} className="text-indigo-500 animate-spin" />
            <span className="text-white text-sm mt-4 font-semibold tracking-wide">
              {lang === 'zh' ? '正在连接安全核心数据库...' : 'Connecting Secure OS Core Database...'}
            </span>
          </div>
        </AppDataProvider>
      </AcademicYearProvider>
    );
  }

  if (!session) {
    return (
      <AcademicYearProvider>
        <AppDataProvider value={appData}>
          <LoginPage onLoginSuccess={handleLoginSuccess} lang={lang} />
          <ThemeFailsafeRecoveryButton lang={lang} />
        </AppDataProvider>
      </AcademicYearProvider>
    );
  }

  // SEC-AUTH-06: 默认密码强制改密门 —— 种子账号（admin/admin、teacher/teacher）改密前
  // 不渲染应用外壳；服务端 enforcePasswordChanged 对写操作兜底拦截
  if (session.mustChangePassword) {
    return (
      <AcademicYearProvider>
        <AppDataProvider value={appData}>
          <ForcedPasswordChangeGate
            lang={lang}
            username={session.username}
            onDone={() => setSession({ ...session, mustChangePassword: false })}
            onLogout={handleLogout}
          />
          <ThemeFailsafeRecoveryButton lang={lang} />
        </AppDataProvider>
      </AcademicYearProvider>
    );
  }

  return (
    <AcademicYearProvider>
      <AppDataProvider value={appData}>
        <>
          {/* 大屏展台独立窗口：占满整个视口，不渲染平台外壳（导航/侧栏/顶栏都无意义） */}
          {isStageDisplayMode && (
            <StageDisplayView
              lessonId={stageLessonParam || selectedLesson}
              lessonTitle={stageTitleParam || lessons.find((l) => l.id === (stageLessonParam || selectedLesson))?.title}
              lang={stageLangParam === 'en' ? 'en' : 'zh'}
            />
          )}

          {!isStageDisplayMode && (
            <div className="flex h-screen bg-app text-main font-sans transition-colors duration-150">
              <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-indigo-600 focus:text-white focus:text-sm focus:font-semibold focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-white"
              >
                {lang === 'zh' ? '跳到主内容' : 'Skip to main content'}
              </a>
              {/* Main Content Area: App Shell representing the Plugin Views */}
              <div className="flex-1 flex flex-col bg-app h-full overflow-hidden">
                {/* 全局模拟学生提示条 */}
                <ImpersonationBanner />

                {/* Issue #94: 学生默认密码非阻塞提示（教师/管理员强制改密走 ForcedPasswordChangeGate，不经过此处） */}
                {session.role === 'student' && session.usedDefaultPassword && (
                  <StudentDefaultPasswordBanner
                    userId={session.studentId || session.userId}
                    lang={lang}
                    onOpenProfile={() => setProfileOpen(true)}
                  />
                )}

                {/* Top Navbar */}
                <AppHeader />

                <ProfileModal
                  open={profileOpen}
                  session={session}
                  lang={lang}
                  onClose={() => setProfileOpen(false)}
                  onSaved={(name) => {
                    if (session) setSession({ ...session, name });
                    setProfileOpen(false);
                  }}
                  onAvatar={(avatar) => {
                    if (session) setSession({ ...session, avatar: avatar ?? undefined });
                  }}
                />

                <main
                  id="main-content"
                  tabIndex={-1}
                  className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden outline-none"
                >
                  <AppShell activeRole={activeRole} />
                </main>

                {/* 全局底部状态栏（statusbar.item 扩展槽；无插件贡献时不渲染） */}
                <AppStatusBar />
              </div>

              <RightSidebar />

              <AppModals />

              {/* 课堂随机提问/点名应答与学生端实时互动浮层 */}
              <ClassroomOverlays />

              {/* Real-time Toast Notifications */}
              <ToastContainer />

              {/* 全局命令面板（Cmd/Ctrl + K 唤起） */}
              <CommandPaletteHost />

              {/* Global System Error Diagnostics Center & Floating Pill */}
              <SystemErrorCenterModal />

              {/* Theme Failsafe Recovery Bar (inline styles, immune to theme CSS) */}
              <ThemeFailsafeRecoveryButton lang={lang} />
            </div>
          )}
        </>
      </AppDataProvider>
    </AcademicYearProvider>
  );
}
