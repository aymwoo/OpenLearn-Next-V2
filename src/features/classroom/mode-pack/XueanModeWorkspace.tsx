/**
 * 学案 Mode Pack 课中工作区（P2 首切片）。
 *
 * 教师端包装 ProgressPanel（进度/批阅）；学生端包装 StudentXueanView。
 * 作答仍走既有 lesson-activities API；SubmissionAdapter 迁入留待后续。
 */
import type { ClassroomActiveSegmentMainSlotProps } from '../../../plugin-host/types';
import { ProgressPanel } from '../../teacher/xuean/ProgressPanel';
import { StudentXueanView } from '../../student/xuean/StudentXueanView';

export type XueanModeWorkspaceRole = 'teacher' | 'student';

export function XueanModeWorkspace(props: ClassroomActiveSegmentMainSlotProps & { role?: XueanModeWorkspaceRole }) {
  const { segment, lessonId, role = 'teacher' } = props;
  const title = segment.title || segment.id;
  const segmentType = typeof segment.type === 'string' ? segment.type : 'xuean';
  const effectiveLessonId = lessonId || '';

  return (
    <div
      data-testid="mode-xuean-workspace"
      data-role={role}
      data-segment-id={segment.id}
      data-segment-type={segmentType}
      data-lesson-id={effectiveLessonId}
      className="flex h-full min-h-0 w-full flex-col gap-2 overflow-auto"
    >
      <div className="shrink-0 text-xs font-semibold text-muted px-1">
        Mode Pack · 学案工作区
        <span className="ml-2 font-normal">环节：{title}</span>
      </div>
      <div className="min-h-0 flex-1">
        {role === 'student' ? (
          effectiveLessonId ? (
            <StudentXueanView lessonId={effectiveLessonId} lessonTitle={title} />
          ) : (
            <p className="text-xs text-muted p-3">缺少课节 id，无法加载学案。</p>
          )
        ) : (
          <ProgressPanel />
        )}
      </div>
    </div>
  );
}

export function XueanTeacherModeWorkspace(props: ClassroomActiveSegmentMainSlotProps) {
  return <XueanModeWorkspace {...props} role="teacher" />;
}

export function XueanStudentModeWorkspace(props: ClassroomActiveSegmentMainSlotProps) {
  return <XueanModeWorkspace {...props} role="student" />;
}
