import React, { lazy, Suspense } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Users, Loader2 } from 'lucide-react';
import type { StudentType, Lesson } from '../../types/app';
import { StudentDashboardPanel } from './StudentDashboardPanel';

const StudentLessonView = lazy(() => import('./StudentLessonView').then(m => ({ default: m.StudentLessonView })));
const StudentAssignmentView = lazy(() => import('./StudentAssignmentView').then(m => ({ default: m.StudentAssignmentView })));

export interface StudentViewProps {
  students: StudentType[];
  activeStudentId: string | null;
  studentViewStatus: 'dashboard' | 'lesson' | 'assignment';
  studentDashboardData: any;
  readNotifications: Set<string>;
  setReadNotifications: (updater: (prev: Set<string>) => Set<string>) => void;
  addToast: (title: string, description: string, type: string) => void;
  lang: 'zh' | 'en';
  setSelectedLesson: (id: string | null) => void;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedAssignment: (ast: any | null) => void;
  setQuizStudentAnswers: (updater: (prev: any) => any) => void;
  setSubAssignmentTab: (tab: string) => void;

  lessons: Lesson[];
  selectedLesson: string | null;
  studentFullscreenPanel: 'left' | 'right' | 'none';
  setStudentFullscreenPanel: Dispatch<SetStateAction<'left' | 'right' | 'none'>>;
  timelineSegments: any[];
  activeSegmentId: string | null;
  setActiveSegmentId: (id: string) => void;
  localProgressPercent: number;
  setLocalProgressPercent: (v: number) => void;
  updateStudentProgress: (percent: number) => void;
  isStudentLessonContentCollapsed: boolean;
  setIsStudentLessonContentCollapsed: (b: boolean) => void;
  studentLessonTab: 'whiteboard' | 'courseware' | 'assignment';
  setStudentLessonTab: (tab: 'whiteboard' | 'courseware' | 'assignment') => void;
  elements: any[];
  activeRole: 'student' | 'teacher';
  fetchElements: (lessonId: string) => void;
  currentVfsParent: string | null;
  setCurrentVfsParent: (id: string | null) => void;
  vfsNodes: any[];
  studentSelectedCourseware: string | null;
  setStudentSelectedCourseware: (id: string | null) => void;

  selectedAssignment: any;
  quizStudentAnswers: any;
  submitQuizAssignment: (isFinal: boolean) => void;
  subAssignmentTab: 'quiz' | 'whiteboard';
}

export function StudentView(props: StudentViewProps) {
  const {
    students,
    activeStudentId,
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
  } = props;

  return (
    <div className="flex-1 p-6 overflow-y-auto w-full max-w-full space-y-6">
      {!activeStudentId ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500 flex flex-col items-center justify-center">
          <Users size={48} className="text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-700">No Student Selected</h3>
          <p className="mt-2 text-sm">Please select a student from the top navigation bar to view their dashboard.</p>
        </div>
      ) : !studentDashboardData ? (
        <div className="flex items-center justify-center h-full text-gray-400">
          <Loader2 size={32} className="animate-spin" />
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-slate-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <span className="text-sm font-medium">加载内容中...</span>
            </div>
          }
        >
          {studentViewStatus === 'lesson' ? (
            <StudentLessonView
              students={students}
              activeStudentId={activeStudentId}
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
              addToast={addToast}
            />
          ) : studentViewStatus === 'assignment' && selectedAssignment ? (
            <StudentAssignmentView
              selectedAssignment={selectedAssignment}
              setStudentViewStatus={setStudentViewStatus}
              setSelectedAssignment={setSelectedAssignment}
              quizStudentAnswers={quizStudentAnswers}
              submitQuizAssignment={submitQuizAssignment}
              subAssignmentTab={subAssignmentTab}
              setSubAssignmentTab={setSubAssignmentTab}
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
              addToast={addToast}
              lang={lang}
              setSelectedLesson={setSelectedLesson}
              setStudentViewStatus={setStudentViewStatus}
              setSelectedAssignment={setSelectedAssignment}
              setQuizStudentAnswers={setQuizStudentAnswers}
              setSubAssignmentTab={setSubAssignmentTab}
            />
          )}
        </Suspense>
      )}
    </div>
  );
}
