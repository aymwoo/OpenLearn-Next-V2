import type { SegmentAccessState } from '../useSegmentAccess';
import type { StudentLessonViewProps } from '../StudentLessonView';
import type { ClassroomFlowController } from '../../../plugin-host/types';
import { XueanStudentModeWorkspace } from '../../classroom/mode-pack/XueanModeWorkspace';

/**
 * 学案课堂：去掉左侧工具导航，正文区直接展示学案活动。
 * 活动之间的切换由 `StudentXueanView` 顶部的活动导航完成，主区域专注当前活动内容。
 */
export function XueanStudentClassroom({
  props,
  topic,
  lessonTitle,
  classId,
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
  return (
    <div data-testid="student-xuean-classroom" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="mx-auto w-full max-w-4xl px-1">
        <p className="text-xs font-medium tracking-wide text-stone-500">学案课堂</p>
        <h1 data-testid="student-learning-topic" className="text-2xl font-semibold tracking-tight text-stone-900">
          {topic}
        </h1>
        {topic !== lessonTitle ? <p className="text-sm text-stone-500">{lessonTitle}</p> : null}
      </header>

      <main className="mx-auto flex min-h-[16rem] w-full max-w-4xl min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-stone-200 bg-white">
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
    </div>
  );
}
