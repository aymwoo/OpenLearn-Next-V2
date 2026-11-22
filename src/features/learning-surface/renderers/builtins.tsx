import { CoursewareHost, type CoursewareHostEvent } from '../../courseware/CoursewareHost';
import { CoursewareScoresOverlay } from '../../courseware/CoursewareScoresOverlay';
import { PresentationRenderer } from './PresentationRenderer';
import { AssignmentSubmissionRenderer } from './AssignmentSubmissionRenderer';
import { registerSurfaceRenderer } from './registry';
import type { SurfaceRendererProps } from '../types';

function normalizeCompletion(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value > 1) return Math.min(1, Math.max(0, value / 100));
  return Math.max(0, Math.min(1, value));
}

/**
 * 内置 HTML 课件渲染器：复用 CoursewareHost 的沙箱 / token / 主题 / 字号，
 * 把 LMS Bridge 事件转成宿主进度与提交。
 */
function HtmlCoursewareRenderer({ contentRef, lessonId, hostId, onProgress, onSubmit }: SurfaceRendererProps) {
  const sourceId = contentRef.source.id;
  const displayTitle = contentRef.config?.title;

  const handleEvent = (event: CoursewareHostEvent) => {
    if (event.type === 'progress') {
      onProgress({
        completion: normalizeCompletion(event.completion),
        autoScore: event.score,
        maxScore: event.total,
      });
      return;
    }
    onSubmit({
      autoScore: event.type === 'submit' ? event.score : undefined,
      maxScore: event.type === 'submit' ? event.total : undefined,
      data: { event: event.type },
    });
  };

  if (contentRef.source.kind === 'courseware' && sourceId) {
    return (
      <CoursewareHost
        source={{ coursewareUuid: sourceId, title: displayTitle }}
        lessonId={lessonId}
        elementId={hostId}
        title={displayTitle}
        className="w-full h-full"
        overlay={<CoursewareScoresOverlay coursewareUuid={sourceId} />}
        onEvent={handleEvent}
      />
    );
  }

  if (contentRef.source.kind === 'resource' && sourceId) {
    return (
      <CoursewareHost
        source={{ resourceId: sourceId, title: displayTitle }}
        lessonId={lessonId}
        elementId={hostId}
        title={displayTitle}
        className="w-full h-full"
        onEvent={handleEvent}
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center p-6 text-center text-xs text-gray-400 bg-slate-50 rounded-xl">
      HTML 课件需要绑定课件或资源引用
    </div>
  );
}

registerSurfaceRenderer({
  id: 'html_courseware',
  execution: 'inline',
  attemptMode: 'surface',
  capabilities: ['resizable', 'progress', 'submittable'],
  sourceKinds: ['courseware', 'resource', 'inline'],
  Component: HtmlCoursewareRenderer,
});

registerSurfaceRenderer({
  id: 'presentation',
  execution: 'inline',
  attemptMode: 'surface',
  capabilities: ['resizable', 'progress'],
  sourceKinds: ['resource', 'inline'],
  Component: PresentationRenderer,
});

registerSurfaceRenderer({
  id: 'assignment_submission',
  execution: 'inline',
  // 作业域 attempt 由阶段 2 的桥接服务维护，宿主不再创建第二条。
  attemptMode: 'bridge',
  capabilities: ['progress', 'submittable', 'scorable'],
  sourceKinds: ['assignment', 'activity'],
  Component: AssignmentSubmissionRenderer,
});
