import React from 'react';
import { Loader2 } from 'lucide-react';
import { AppDataProvider } from './context/AppDataContext';
import { LoginPage } from './components/LoginPage';
import ForcedPasswordChangeGate from './components/ForcedPasswordChangeGate';
import { StageDisplayView } from './features/classroom/stage-display/StageDisplayView';
import { ImpersonationBanner } from './components/ImpersonationBanner';
import { AppHeader } from './components/AppHeader';
import { ProfileModal } from './components/ProfileModal';
import { AppShell } from './components/AppShell';
import { RightSidebar } from './features/shared/RightSidebar';
import { AppModals } from './components/AppModals';
import { ClassroomOverlays } from './components/ClassroomOverlays';
import { ToastContainer } from './features/shared/ToastContainer';
import { SystemErrorCenterModal } from './features/modals/SystemErrorCenterModal';
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

  if (sessionLoading) {
    return (
      <AppDataProvider value={appData}>
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
          <Loader2 size={48} className="text-indigo-500 animate-spin" />
          <span className="text-white text-sm mt-4 font-semibold tracking-wide">
            {lang === 'zh' ? '正在连接安全核心数据库...' : 'Connecting Secure OS Core Database...'}
          </span>
        </div>
      </AppDataProvider>
    );
  }

  if (!session) {
    return (
      <AppDataProvider value={appData}>
        <LoginPage onLoginSuccess={handleLoginSuccess} lang={lang} />
      </AppDataProvider>
    );
  }

  // SEC-AUTH-06: 默认密码强制改密门 —— 种子账号（admin/admin、teacher/teacher）改密前
  // 不渲染应用外壳；服务端 enforcePasswordChanged 对写操作兜底拦截
  if (session.mustChangePassword) {
    return (
      <AppDataProvider value={appData}>
        <ForcedPasswordChangeGate
          lang={lang}
          username={session.username}
          onDone={() => setSession({ ...session, mustChangePassword: false })}
          onLogout={handleLogout}
        />
      </AppDataProvider>
    );
  }

  return (
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
            {/* Main Content Area: App Shell representing the Plugin Views */}
            <div className="flex-1 flex flex-col bg-app h-full overflow-hidden">
              {/* 全局模拟学生提示条 */}
              <ImpersonationBanner />

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

              <AppShell activeRole={activeRole} />
            </div>

            <RightSidebar />

            <AppModals />

            {/* 课堂随机提问/点名应答与学生端实时互动浮层 */}
            <ClassroomOverlays />

            {/* Real-time Toast Notifications */}
            <ToastContainer />

            {/* Global System Error Diagnostics Center & Floating Pill */}
            <SystemErrorCenterModal />
          </div>
        )}
      </>
    </AppDataProvider>
  );
}
