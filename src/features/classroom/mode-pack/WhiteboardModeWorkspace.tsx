/**
 * 白板 Mode Pack 课中工作区（P1）。
 *
 * 通过 WhiteboardHostBridge 挂载与 LiveClassroom / 学生端同一契约的 LazyWhiteboard，
 * 保留全屏同步、大纲页状态回调与 activeSegmentId 过滤。flag 关闭时本组件不会被注册。
 */
import type { ReactNode } from 'react';
import { LazyWhiteboard } from '../../../components/LazyWhiteboard';
import type { ClassroomActiveSegmentMainSlotProps } from '../../../plugin-host/types';
import { useWhiteboardHostBridge } from './whiteboardHostBridge';

export function WhiteboardModeWorkspace(props: ClassroomActiveSegmentMainSlotProps & { toolbarExtras?: ReactNode }) {
  const { segment, lessonId } = props;
  const title = segment.title || segment.id;
  const bridge = useWhiteboardHostBridge();
  const segmentType = typeof segment.type === 'string' ? segment.type : 'whiteboard';

  if (!bridge) {
    return (
      <div
        data-testid="mode-whiteboard-workspace"
        data-segment-id={segment.id}
        data-segment-type={segmentType}
        data-lesson-id={lessonId ?? ''}
        data-bridge="missing"
        className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-3 text-xs text-muted"
      >
        <p>Mode Pack · 互动白板工作区未接到宿主画布桥</p>
        <p className="font-normal">环节：{title}</p>
      </div>
    );
  }

  return (
    <div
      data-testid="mode-whiteboard-workspace"
      data-segment-id={segment.id}
      data-segment-type={segmentType}
      data-lesson-id={lessonId ?? ''}
      data-bridge="ready"
      className="flex h-full min-h-0 w-full flex-col"
    >
      <LazyWhiteboard ref={bridge.whiteboardRef} {...bridge.canvasProps} toolbarExtras={props.toolbarExtras} />
    </div>
  );
}
