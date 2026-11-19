import { useState, type ReactNode } from 'react';
import type { ClassroomFlowController } from '../../../plugin-host/types';
import type { SegmentAccessState } from '../useSegmentAccess';
import type { StudentLessonViewProps } from '../StudentLessonView';
import { StudentCheckinPanel } from '../StudentCheckinPanel';
import { StudentLessonContentPanel } from '../StudentLessonContentPanel';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { XueanStudentModeWorkspace } from '../../classroom/mode-pack/XueanModeWorkspace';
import { STUDENT_TOOL_DRAWER_ID, StudentToolDrawer } from './StudentToolDrawer';

type ToolId = 'segments' | 'checkin' | 'notes';

const TOOLS: Array<{ id: ToolId; label: string }> = [
  { id: 'segments', label: '环节' },
  { id: 'checkin', label: '签到' },
  { id: 'notes', label: '笔记' },
];

export function XueanStudentClassroom({
  props,
  topic,
  lessonTitle,
  classId,
  segmentAccess,
  blockSegmentContent,
  flow,
  segment,
}: {
  props: StudentLessonViewProps;
  topic: string;
  lessonTitle: string;
  classId: string | null;
  segmentAccess: SegmentAccessState;
  blockSegmentContent: boolean;
  flow: ClassroomFlowController;
  segment: { id: string; title?: string; type?: string };
}) {
  const [tool, setTool] = useState<ToolId | null>(null);
  const activeTool = TOOLS.find((item) => item.id === tool);
  const notes: ReactNode = (
    <div className="flex flex-col gap-3">
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
  );

  return (
    <div data-testid="student-xuean-classroom" className="flex min-h-0 flex-1 gap-3">
      <nav aria-label="学案课堂工具" className="flex w-16 shrink-0 flex-col gap-2">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`student-tool-${item.id}`}
            aria-expanded={tool === item.id}
            aria-controls={STUDENT_TOOL_DRAWER_ID}
            onClick={() => setTool((current) => (current === item.id ? null : item.id))}
            className={`rounded-xl px-2 py-3 text-xs font-medium cursor-pointer ${
              tool === item.id ? 'bg-stone-800 text-white' : 'bg-white text-stone-700 border border-stone-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <header className="mx-auto w-full max-w-3xl">
          <p className="text-xs font-medium tracking-wide text-stone-500">学案课堂</p>
          <h1 data-testid="student-learning-topic" className="text-2xl font-semibold tracking-tight text-stone-900">
            {topic}
          </h1>
          {topic !== lessonTitle ? <p className="text-sm text-stone-500">{lessonTitle}</p> : null}
        </header>
        <div className="flex min-h-0 flex-1 gap-3">
          <main className="mx-auto flex min-h-[16rem] w-full max-w-3xl min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-stone-200 bg-white">
            {blockSegmentContent ? (
              <div
                role="status"
                className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-amber-800"
              >
                {props.lang === 'zh' ? '本教学环节尚未解锁' : 'This segment is not unlocked yet'}
              </div>
            ) : (
              <XueanStudentModeWorkspace
                segment={segment}
                lessonId={props.selectedLesson}
                classId={classId}
                lang={props.lang}
                flow={flow}
              />
            )}
          </main>
          <StudentToolDrawer open={tool !== null} title={activeTool?.label ?? '学案'} onClose={() => setTool(null)}>
            {tool === 'segments' ? (
              <StudentLessonContentPanel {...props} segmentAccess={segmentAccess} embed="drawer" />
            ) : null}
            {tool === 'checkin' ? (
              <StudentCheckinPanel lessonId={props.selectedLesson} lang={props.lang} addToast={props.addToast} />
            ) : null}
            {tool === 'notes' ? notes : null}
          </StudentToolDrawer>
        </div>
      </div>
    </div>
  );
}
