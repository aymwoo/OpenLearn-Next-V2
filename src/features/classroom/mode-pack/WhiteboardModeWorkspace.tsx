/**
 * 白板 Mode Pack 课中工作区（P1 骨架）。
 *
 * 当前先渲染占位 + 透传 flow 快照，真正挂 LazyWhiteboard 在 flag 灰度稳定后接入
 * （保持与 LiveClassroom 中栏同一 props 契约）。flag 关闭时本组件不会被注册。
 */
import type { ClassroomActiveSegmentMainSlotProps } from '../../../plugin-host/types';

export function WhiteboardModeWorkspace(props: ClassroomActiveSegmentMainSlotProps) {
  const { segment, flow, lessonId } = props;
  const title = segment.title || segment.id;

  return (
    <div
      data-testid="mode-whiteboard-workspace"
      data-segment-id={segment.id}
      data-segment-type={typeof segment.type === 'string' ? segment.type : 'whiteboard'}
      data-lesson-id={lessonId ?? ''}
      className="flex h-full min-h-0 flex-col gap-2 p-3"
    >
      <div className="text-xs font-semibold text-muted">
        Mode Pack · 互动白板工作区（灰度）
        <span className="ml-2 font-normal">环节：{title}</span>
      </div>
      <div className="text-2xs text-muted">
        stage={flow.snapshot.stage} · active={flow.snapshot.activeSegmentId ?? '—'}
      </div>
      <div className="flex-1 min-h-0 rounded-lg border border-dashed border-theme bg-surface-secondary/40 flex items-center justify-center text-xs text-muted">
        白板画布将在此槽位挂载（P1 续：复用 LazyWhiteboard 与全屏同步契约）
      </div>
    </div>
  );
}
