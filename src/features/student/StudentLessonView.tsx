import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { StudentType, Lesson } from '../../types/app';
import { StudentCheckinPanel } from './StudentCheckinPanel';
import { StudentLessonHeader } from './StudentLessonHeader';
import { StudentLessonContentPanel } from './StudentLessonContentPanel';
import { StudentLessonInteractionPanel } from './StudentLessonInteractionPanel';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { SegmentGateBanner } from './SegmentGateBanner';
import { useSegmentAccess } from './useSegmentAccess';

export interface StudentLessonViewProps {
  students: StudentType[];
  activeStudentId: string | null;
  /** 全班专注锁定中：学生端进入只读跟随模式 */
  isStudentLocked?: boolean;
  /** 导航限制：禁止切 Tab、返回看板（答题锁定与完全锁定均开启） */
  isNavigationLocked?: boolean;
  /** 交互限制：白板设为只读并拦截内容写入（仅完全锁定开启，答题锁定为 false） */
  isInteractionLocked?: boolean;
  /** 锁定模式：'full' | 'navigation' */
  lockMode?: 'full' | 'navigation';
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
    isStudentLocked = false,
    isNavigationLocked,
    isInteractionLocked,
    lockMode,
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
  const segmentAccess = useSegmentAccess(selectedLesson, activeSegmentId);
  const checkingSegment = !!activeSegmentId && (segmentAccess.status === 'idle' || segmentAccess.status === 'loading');
  const blockSegmentContent = checkingSegment || (segmentAccess.status === 'locked' && !segmentAccess.visibleSegmentId);
  const contentSegmentId =
    segmentAccess.status === 'locked' && segmentAccess.visibleSegmentId
      ? segmentAccess.visibleSegmentId
      : activeSegmentId;

  // 迟到进入的学生收不到当时的广播。轮询课堂会话，把本地指针对齐到全班当前环节。
  useEffect(() => {
    if (!selectedLesson || typeof fetch !== 'function') return;
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch(`/api/classroom/sessions/${encodeURIComponent(selectedLesson)}`, {
          credentials: 'same-origin',
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const id = json?.session?.current_segment_id;
        if (typeof id === 'string' && id && id !== activeSegmentId) {
          setActiveSegmentId(id);
        }
      } catch {
        /* 会话尚未建立时保持本地环节，下一次轮询再对齐 */
      }
    };
    void pull();
    const timer = window.setInterval(() => {
      void pull();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedLesson, activeSegmentId, setActiveSegmentId]);

  return (
    <div className="flex flex-col h-full space-y-4">
      <StudentLessonHeader
        students={students}
        activeStudentId={activeStudentId}
        isStudentLocked={isNavigationLocked ?? isStudentLocked}
        lockMode={lockMode}
        setStudentViewStatus={setStudentViewStatus}
        setSelectedLesson={setSelectedLesson}
        lessons={lessons}
        selectedLesson={selectedLesson}
        addToast={addToast}
      />
      <StudentCheckinPanel lessonId={selectedLesson} lang={lang} addToast={addToast} />
      <SegmentGateBanner access={segmentAccess} lang={lang} />
      <div className="flex-1 flex gap-6 min-h-0 bg-surface border border-theme rounded-xl p-4 shadow-sm text-main">
        <StudentLessonContentPanel
          students={students}
          activeStudentId={activeStudentId}
          isStudentLocked={isStudentLocked}
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
          addToast={addToast}
          segmentAccess={segmentAccess}
        />
        <StudentLessonInteractionPanel
          isStudentLocked={isStudentLocked}
          isNavigationLocked={isNavigationLocked}
          isInteractionLocked={isInteractionLocked}
          lockMode={lockMode}
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
          contentSegmentId={contentSegmentId}
          blockSegmentContent={blockSegmentContent}
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

      {/* 随堂个人笔记增强挂件扩展 */}
      <ExtensionPointRenderer
        slot="student.lesson.notes_addon"
        slotProps={{
          lessonId: selectedLesson,
          studentId: activeStudentId,
          activeSegmentId,
          lang,
        }}
      />

      {/* 随堂学生工具箱扩展（科学计算器 / 发音词典 / 元素周期表等） */}
      <ExtensionPointRenderer
        slot="student.lesson.toolbox"
        slotProps={{
          lessonId: selectedLesson,
          studentId: activeStudentId,
          lang,
        }}
      />
    </div>
  );
}
