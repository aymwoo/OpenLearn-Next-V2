import React, { lazy, Suspense, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Users, Loader2 } from 'lucide-react';
import type { StudentType, Lesson } from '../../types/app';
import { useAppData } from '../../context/AppDataContext';
import type { ToastType } from '../../hooks/useToast';
import { StudentDashboardPanel } from './StudentDashboardPanel';
import { useStudentActiveSessionPolling } from './useStudentActiveSession';

const StudentLessonView = lazy(() => import('./StudentLessonView').then((m) => ({ default: m.StudentLessonView })));
const StudentAssignmentView = lazy(() =>
  import('./StudentAssignmentView').then((m) => ({ default: m.StudentAssignmentView })),
);
const StudentAssessmentsView = lazy(() =>
  import('../assessment/student/StudentAssessmentsView').then((m) => ({ default: m.StudentAssessmentsView })),
);

export function StudentView() {
  /** Issue #122：「我的测评」全屏视图（不改动 studentViewStatus 联合类型，避免波及 6 处调用方） */
  const [assessmentsOpen, setAssessmentsOpen] = useState(false);
  // C1-R3: 全部数据经 AppDataContext 取用（不再经 AppShell props 透传）
  const {
    students,
    activeStudentId,
    isStudentLocked = false,
    isNavigationLocked,
    isInteractionLocked,
    studentLockMode,
    studentViewStatus,
    studentDashboardData,
    readNotifications,
    setReadNotifications,
    addToast,
    lang,
    setSelectedLesson,
    setStudentViewStatus,
    setSelectedAssignment,
    setQuizStudentAnswers,
    setSubAssignmentTab,
    lessons,
    selectedLesson,
    studentFullscreenPanel,
    setStudentFullscreenPanel,
    timelineSegments,
    activeSegmentId,
    setActiveSegmentId,
    localProgressPercent,
    setLocalProgressPercent,
    updateStudentProgress,
    isStudentLessonContentCollapsed,
    setIsStudentLessonContentCollapsed,
    studentLessonTab,
    setStudentLessonTab,
    elements,
    activeRole,
    fetchElements,
    currentVfsParent,
    setCurrentVfsParent,
    vfsNodes,
    studentSelectedCourseware,
    setStudentSelectedCourseware,
    selectedAssignment,
    quizStudentAnswers,
    submitQuizAssignment,
    subAssignmentTab,
  } = useAppData();

  // Issue #109: 学生端全局轮询「自己班级正在进行的课堂会话」，
  // 供看板横幅 / 顶部导航 / 悬浮菜单复用（模块级 store 单例，只发一次请求）
  useStudentActiveSessionPolling(activeStudentId || null);

  return (
    <div className="flex-1 p-6 overflow-y-auto w-full max-w-full space-y-6">
      {!activeStudentId ? (
        <div className="bg-surface border border-theme rounded-xl p-12 text-center text-muted flex flex-col items-center justify-center">
          <Users size={48} className="text-muted/40 mb-4" />
          <h3 className="text-lg font-medium text-main">No Student Selected</h3>
          <p className="mt-2 text-sm">Please select a student from the top navigation bar to view their dashboard.</p>
        </div>
      ) : !studentDashboardData ? (
        <div className="flex items-center justify-center h-full text-gray-400">
          <Loader2 size={32} className="animate-spin" />
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-subtle gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <span className="text-sm font-medium">加载内容中...</span>
            </div>
          }
        >
          {assessmentsOpen ? (
            <StudentAssessmentsView lang={lang as 'zh' | 'en'} onExit={() => setAssessmentsOpen(false)} />
          ) : studentViewStatus === 'lesson' ? (
            <StudentLessonView
              students={students}
              activeStudentId={activeStudentId}
              isStudentLocked={isStudentLocked}
              isNavigationLocked={isNavigationLocked}
              isInteractionLocked={isInteractionLocked}
              lockMode={studentLockMode}
              setStudentViewStatus={setStudentViewStatus}
              setSelectedLesson={setSelectedLesson}
              lessons={lessons}
              selectedLesson={selectedLesson}
              studentFullscreenPanel={studentFullscreenPanel}
              setStudentFullscreenPanel={setStudentFullscreenPanel}
              timelineSegments={timelineSegments}
              lang={lang}
              activeSegmentId={activeSegmentId}
              setActiveSegmentId={setActiveSegmentId}
              localProgressPercent={localProgressPercent}
              setLocalProgressPercent={setLocalProgressPercent}
              updateStudentProgress={updateStudentProgress}
              isStudentLessonContentCollapsed={isStudentLessonContentCollapsed}
              setIsStudentLessonContentCollapsed={setIsStudentLessonContentCollapsed}
              studentLessonTab={studentLessonTab}
              setStudentLessonTab={setStudentLessonTab}
              elements={elements}
              activeRole={activeRole}
              fetchElements={fetchElements}
              currentVfsParent={currentVfsParent}
              setCurrentVfsParent={setCurrentVfsParent}
              vfsNodes={vfsNodes}
              studentSelectedCourseware={studentSelectedCourseware}
              setStudentSelectedCourseware={setStudentSelectedCourseware}
              addToast={(title: string, description: string, type: string) =>
                addToast(title, description, type as ToastType)
              }
            />
          ) : studentViewStatus === 'assignment' && selectedAssignment ? (
            <StudentAssignmentView
              selectedAssignment={selectedAssignment}
              setStudentViewStatus={setStudentViewStatus}
              setSelectedAssignment={setSelectedAssignment}
              quizStudentAnswers={quizStudentAnswers}
              submitQuizAssignment={submitQuizAssignment}
              subAssignmentTab={subAssignmentTab}
              setSubAssignmentTab={(tab: any) => setSubAssignmentTab(tab)}
              setQuizStudentAnswers={setQuizStudentAnswers}
              elements={elements}
              activeRole={activeRole}
              activeStudentId={activeStudentId}
              fetchElements={fetchElements}
            />
          ) : (
            <StudentDashboardPanel
              students={students}
              activeStudentId={activeStudentId}
              studentDashboardData={studentDashboardData}
              readNotifications={readNotifications}
              setReadNotifications={setReadNotifications}
              addToast={(title: string, description: string, type: string) =>
                addToast(title, description, type as ToastType)
              }
              lang={lang}
              setSelectedLesson={setSelectedLesson}
              setStudentViewStatus={setStudentViewStatus}
              setSelectedAssignment={setSelectedAssignment}
              setQuizStudentAnswers={setQuizStudentAnswers}
              setSubAssignmentTab={(tab: any) => setSubAssignmentTab(tab)}
              onOpenAssessments={() => setAssessmentsOpen(true)}
            />
          )}
        </Suspense>
      )}
    </div>
  );
}
