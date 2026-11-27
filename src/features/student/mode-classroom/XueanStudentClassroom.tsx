import type { ReactNode } from 'react';
import type { SegmentAccessState } from '../useSegmentAccess';
import type { StudentLessonViewProps } from '../StudentLessonView';
import type { ClassroomFlowController } from '../../../plugin-host/types';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { XueanStudentModeWorkspace } from '../../classroom/mode-pack/XueanModeWorkspace';

/**
 * 学案课堂：去掉左侧工具导航，正文区直接展示学案活动。
 * 活动之间的切换由 `StudentXueanView` 顶部的活动导航完成，主区域专注当前活动内容。
 * 课节名/环节名统一由 `StudentLessonHeader` 单行顶栏承载，这里不再重复标题块。
 */
export function XueanStudentClassroom({
  props,
  classId,
  segmentAccess,
  blockSegmentContent,
  flow,
  segment,
  primarySurface,
  extraSurface,
}: {
  props: StudentLessonViewProps;
  classId: string | null;
  segmentAccess: SegmentAccessState;
  blockSegmentContent: boolean;
  flow: ClassroomFlowController;
  segment: { id: string; title?: string; type?: string };
  /** `classroom.active_segment.student_main` 中 primary 贡献：命中时替代内置学案工作区。 */
  primarySurface?: ReactNode;
  /** 非 primary 贡献：与内置学案工作区并列渲染。 */
  extraSurface?: ReactNode;
}) {
  return (
    <div data-testid="student-xuean-classroom" className="flex min-h-0 flex-1 flex-col">
      {/* 学生端随堂工具：与白板壳共用 `student.lesson.tool`，学案课也有跨活动的常驻工具位。
          无插件贡献时容器为空（empty:hidden），不占布局高度。 */}
      <div className="flex shrink-0 items-center justify-end gap-2 px-1 pb-1 empty:hidden">
        <ExtensionPointRenderer
          slot="student.lesson.tool"
          slotProps={{
            lessonId: props.selectedLesson,
            studentId: props.activeStudentId,
            activeSegmentId: segment.id,
            lang: props.lang,
          }}
          locked={blockSegmentContent}
        />
      </div>
      <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-theme bg-surface">
        {blockSegmentContent ? (
          <div
            role="status"
            className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-amber-800 dark:text-amber-300"
          >
            <span>{props.lang === 'zh' ? '本教学环节尚未解锁' : 'This segment is not unlocked yet'}</span>
            <ExtensionPointRenderer
              slot="student.segment.gate_fallback"
              lang={props.lang}
              slotProps={{
                lessonId: props.selectedLesson,
                activeSegmentId: segment.id,
                studentId: props.activeStudentId,
                classId,
                access: segmentAccess,
                lang: props.lang,
              }}
            />
          </div>
        ) : (
          <>
            {primarySurface ?? (
              <XueanStudentModeWorkspace
                segment={segment}
                lessonId={props.selectedLesson}
                classId={classId}
                lang={props.lang}
                flow={flow}
                studentId={props.activeStudentId}
              />
            )}
            {extraSurface}
          </>
        )}
      </main>
    </div>
  );
}
