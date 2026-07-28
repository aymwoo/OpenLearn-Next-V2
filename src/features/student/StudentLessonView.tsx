import type { Dispatch, SetStateAction } from 'react';
import type { StudentType, Lesson } from '../../types/app';
import { StudentLessonHeader } from './StudentLessonHeader';
import { StudentLessonContentPanel } from './StudentLessonContentPanel';
import { StudentLessonInteractionPanel } from './StudentLessonInteractionPanel';

export interface StudentLessonViewProps {
  students: StudentType[];
  activeStudentId: string | null;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedLesson: (id: string | null) => void;
  lessons: Lesson[];
  selectedLesson: string | null;
  studentFullscreenPanel: 'left' | 'right' | 'none';
  setStudentFullscreenPanel: Dispatch<SetStateAction<'left' | 'right' | 'none'>>;
  timelineSegments: any[];
  lang: 'zh' | 'en';
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
  addToast: (title: string, description: string, type: string) => void;
}

export function StudentLessonView(props: StudentLessonViewProps) {
  const {
    students,
    activeStudentId,
    setStudentViewStatus,
    setSelectedLesson,
    lessons,
    selectedLesson,
    studentFullscreenPanel,
    setStudentFullscreenPanel,
    timelineSegments,
    lang,
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
    addToast,
  } = props;
  return (
    <div className="flex flex-col h-full space-y-4">
      <StudentLessonHeader
        students={students}
        activeStudentId={activeStudentId}
        setStudentViewStatus={setStudentViewStatus}
        setSelectedLesson={setSelectedLesson}
        lessons={lessons}
        selectedLesson={selectedLesson}
      />
      <div className="flex-1 flex gap-6 min-h-0 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <StudentLessonContentPanel
          students={students}
          activeStudentId={activeStudentId}
          studentFullscreenPanel={studentFullscreenPanel}
          setStudentFullscreenPanel={setStudentFullscreenPanel}
          timelineSegments={timelineSegments}
          lang={lang}
          activeSegmentId={activeSegmentId}
          setActiveSegmentId={setActiveSegmentId}
          localProgressPercent={localProgressPercent}
          setLocalProgressPercent={setLocalProgressPercent}
          updateStudentProgress={updateStudentProgress}
          selectedLesson={selectedLesson}
          lessons={lessons}
          isStudentLessonContentCollapsed={isStudentLessonContentCollapsed}
        />
        <StudentLessonInteractionPanel
          studentLessonTab={studentLessonTab}
          setStudentLessonTab={setStudentLessonTab}
          isStudentLessonContentCollapsed={isStudentLessonContentCollapsed}
          setIsStudentLessonContentCollapsed={setIsStudentLessonContentCollapsed}
          lang={lang}
          studentFullscreenPanel={studentFullscreenPanel}
          setStudentFullscreenPanel={setStudentFullscreenPanel}
          selectedLesson={selectedLesson}
          elements={elements}
          activeRole={activeRole}
          activeSegmentId={activeSegmentId}
          setActiveSegmentId={setActiveSegmentId}
          fetchElements={fetchElements}
          currentVfsParent={currentVfsParent}
          setCurrentVfsParent={setCurrentVfsParent}
          vfsNodes={vfsNodes}
          studentSelectedCourseware={studentSelectedCourseware}
          setStudentSelectedCourseware={setStudentSelectedCourseware}
          activeStudentId={activeStudentId}
          addToast={addToast}
        />
      </div>
    </div>
  );
}
