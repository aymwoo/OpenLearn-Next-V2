import { useState, type ReactNode } from 'react';
import type { SegmentAccessState } from '../useSegmentAccess';
import type { StudentLessonViewProps } from '../StudentLessonView';
import { StudentCheckinPanel } from '../StudentCheckinPanel';
import { StudentLessonContentPanel } from '../StudentLessonContentPanel';
import { StudentLessonInteractionPanel } from '../StudentLessonInteractionPanel';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { STUDENT_TOOL_DRAWER_ID, StudentToolDrawer } from './StudentToolDrawer';

type ToolId = 'outline' | 'courseware' | 'assignment' | 'checkin' | 'tools';

const TOOLS: Array<{ id: ToolId; label: string }> = [
  { id: 'outline', label: '大纲' },
  { id: 'courseware', label: '课件' },
  { id: 'assignment', label: '作业' },
  { id: 'checkin', label: '签到' },
  { id: 'tools', label: '工具' },
];

export function WhiteboardStudentClassroom({
  props,
  topic,
  lessonTitle,
  contentSegmentId,
  blockSegmentContent,
  classId,
  studentName,
  segmentAccess,
  primarySurface,
  extraSurface,
}: {
  props: StudentLessonViewProps;
  topic: string;
  lessonTitle: string;
  contentSegmentId: string | null;
  blockSegmentContent: boolean;
  classId: string | null;
  studentName: string | null;
  segmentAccess: SegmentAccessState;
  primarySurface: ReactNode;
  extraSurface: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [tool, setTool] = useState<ToolId | null>(null);
  const activeTool = TOOLS.find((item) => item.id === tool);

  return (
    <div data-testid="student-whiteboard-classroom" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-gray-500">白板课堂</p>
          <h1
            data-testid="student-learning-topic"
            className="truncate text-2xl font-semibold tracking-tight text-gray-900"
          >
            {topic}
          </h1>
          {topic !== lessonTitle ? <p className="truncate text-sm text-gray-500">{lessonTitle}</p> : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3">
        <main
          data-testid="student-whiteboard-canvas"
          className="relative flex min-h-[16rem] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white"
        >
          {primarySurface ?? (
            <StudentLessonInteractionPanel
              {...interactionProps(props, contentSegmentId, blockSegmentContent, classId, studentName)}
              chrome="surface"
              studentLessonTab="whiteboard"
            />
          )}
        </main>
        <StudentToolDrawer open={tool !== null} title={activeTool?.label ?? '工具'} onClose={() => setTool(null)}>
          {tool === 'outline' ? (
            <StudentLessonContentPanel {...props} segmentAccess={segmentAccess} embed="drawer" />
          ) : null}
          {tool === 'courseware' ? (
            <StudentLessonInteractionPanel
              {...interactionProps(props, contentSegmentId, blockSegmentContent, classId, studentName)}
              chrome="surface"
              studentLessonTab="courseware"
            />
          ) : null}
          {tool === 'assignment' ? (
            <StudentLessonInteractionPanel
              {...interactionProps(props, contentSegmentId, blockSegmentContent, classId, studentName)}
              chrome="surface"
              studentLessonTab="assignment"
            />
          ) : null}
          {tool === 'checkin' ? (
            <StudentCheckinPanel lessonId={props.selectedLesson} lang={props.lang} addToast={props.addToast} />
          ) : null}
          {tool === 'tools' ? (
            <div className="flex flex-col gap-3">
              {extraSurface}
              <ExtensionPointRenderer
                slot="student.lesson.notes_addon"
                slotProps={{
                  lessonId: props.selectedLesson,
                  studentId: props.activeStudentId,
                  activeSegmentId: props.activeSegmentId,
                  lang: props.lang,
                }}
              />
              <ExtensionPointRenderer
                slot="student.lesson.toolbox"
                slotProps={{
                  lessonId: props.selectedLesson,
                  studentId: props.activeStudentId,
                  lang: props.lang,
                }}
              />
            </div>
          ) : null}
        </StudentToolDrawer>
      </div>

      <nav aria-label="白板课堂工具" className="flex items-center gap-2">
        <button
          type="button"
          data-testid="student-whiteboard-tools"
          aria-expanded={menuOpen}
          aria-controls="student-whiteboard-tool-menu"
          onClick={() => setMenuOpen((open) => !open)}
          className="rounded-full px-3 py-1.5 text-sm font-medium cursor-pointer bg-white text-gray-800 border border-gray-200"
        >
          工具
        </button>
        <div
          id="student-whiteboard-tool-menu"
          data-testid="student-whiteboard-tool-menu"
          data-open={menuOpen ? 'true' : 'false'}
          hidden={!menuOpen}
          className="flex flex-wrap gap-2"
        >
          {menuOpen
            ? TOOLS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`student-tool-${item.id}`}
                  aria-expanded={tool === item.id}
                  aria-controls={STUDENT_TOOL_DRAWER_ID}
                  onClick={() => {
                    setTool((current) => (current === item.id ? null : item.id));
                    setMenuOpen(false);
                  }}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium cursor-pointer ${
                    tool === item.id ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border border-gray-200'
                  }`}
                >
                  {item.label}
                </button>
              ))
            : null}
        </div>
      </nav>
    </div>
  );
}

function interactionProps(
  props: StudentLessonViewProps,
  contentSegmentId: string | null,
  blockSegmentContent: boolean,
  classId: string | null,
  studentName: string | null,
) {
  return {
    isStudentLocked: props.isStudentLocked,
    isNavigationLocked: props.isNavigationLocked,
    isInteractionLocked: props.isInteractionLocked,
    lockMode: props.lockMode,
    studentLessonTab: props.studentLessonTab,
    setStudentLessonTab: props.setStudentLessonTab,
    isStudentLessonContentCollapsed: props.isStudentLessonContentCollapsed,
    setIsStudentLessonContentCollapsed: props.setIsStudentLessonContentCollapsed,
    lang: props.lang,
    studentFullscreenPanel: props.studentFullscreenPanel,
    setStudentFullscreenPanel: props.setStudentFullscreenPanel,
    selectedLesson: props.selectedLesson,
    elements: props.elements,
    activeRole: props.activeRole,
    activeSegmentId: props.activeSegmentId,
    contentSegmentId,
    blockSegmentContent,
    setActiveSegmentId: props.setActiveSegmentId,
    fetchElements: props.fetchElements,
    currentVfsParent: props.currentVfsParent,
    setCurrentVfsParent: props.setCurrentVfsParent,
    vfsNodes: props.vfsNodes,
    studentSelectedCourseware: props.studentSelectedCourseware,
    setStudentSelectedCourseware: props.setStudentSelectedCourseware,
    activeStudentId: props.activeStudentId,
    studentName,
    classId,
    addToast: props.addToast,
  };
}
