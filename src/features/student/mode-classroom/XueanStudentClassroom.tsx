import type { SegmentAccessState } from '../useSegmentAccess';
import type { StudentLessonViewProps } from '../StudentLessonView';
import type { ClassroomFlowController } from '../../../plugin-host/types';
import { XueanStudentModeWorkspace } from '../../classroom/mode-pack/XueanModeWorkspace';

/**
 * 学案课堂：去掉左侧工具导航，正文区直接展示学案活动。
 * 活动之间的切换由 `StudentXueanView` 顶部的活动导航完成，主区域专注当前活动内容。
 * 课节名/环节名统一由 `StudentLessonHeader` 单行顶栏承载，这里不再重复标题块。
 */
export function XueanStudentClassroom({
  props,
  classId,
  blockSegmentContent,
  flow,
  segment,
}: {
  props: StudentLessonViewProps;
  classId: string | null;
  segmentAccess: SegmentAccessState;
  blockSegmentContent: boolean;
  flow: ClassroomFlowController;
  segment: { id: string; title?: string; type?: string };
}) {
  return (
    <div data-testid="student-xuean-classroom" className="flex min-h-0 flex-1 flex-col">
      <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-theme bg-surface">
        {blockSegmentContent ? (
          <div
            role="status"
            className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-amber-800 dark:text-amber-300"
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
