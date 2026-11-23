/**
 * 学案 Mode Pack 课中工作区（P2）。
 *
 * 教师端包装 ProgressPanel（进度/批阅）；学生端包装 StudentXueanView。
 * 作答真值仍写 lesson-activities / activity_progress；成功后经 flow.sendMessage
 * 通知 `xuean:task` 通道。成绩面板经 xuean-adapter 投影聚合。
 */
import type { ClassroomActiveSegmentMainSlotProps } from '../../../plugin-host/types';
import { ProgressPanel } from '../../teacher/xuean/ProgressPanel';
import { StudentXueanView } from '../../student/xuean/StudentXueanView';

export type XueanModeWorkspaceRole = 'teacher' | 'student';

export function XueanModeWorkspace(props: ClassroomActiveSegmentMainSlotProps & { role?: XueanModeWorkspaceRole }) {
  const { segment, lessonId, classId, flow, role = 'teacher', lang = 'zh' } = props;
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
      {role !== 'student' && (
        <div className="shrink-0 text-xs font-semibold text-muted px-1">
          Mode Pack · 学案工作区
          <span className="ml-2 font-normal">环节：{title}</span>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {role === 'student' ? (
          effectiveLessonId ? (
            <StudentXueanView
              lessonId={effectiveLessonId}
              lessonTitle={title}
              lang={lang === 'en' ? 'en' : 'zh'}
              onActivityProgressReported={(info) => {
                void flow
                  .sendMessage({
                    channel: 'xuean:task',
                    msgType: 'request',
                    payload: {
                      activityId: info.activityId,
                      status: info.status,
                      segmentId: segment.id,
                      lessonId: effectiveLessonId,
                      classId: classId ?? null,
                    },
                  })
                  .catch(() => {
                    /* 通道通知失败不阻断已写入的进度 */
                  });
              }}
            />
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
