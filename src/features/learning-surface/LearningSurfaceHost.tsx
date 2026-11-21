/**
 * LearningSurface 宿主（阶段 4）。
 *
 * 职责：
 *   - 按 surfaceId 读取 `learning_surfaces` 记录并解析 `LearningContentRef`；
 *   - 按渲染器注册表分发：内置渲染器走 React 组件，插件渲染器走严格沙箱；
 *   - 统一 attempt 生命周期（懒创建 / 续用 / 进度防抖 / 幂等提交）；
 *   - 未注册 / 加载失败的渲染器显示可读占位，不暴露内部堆栈。
 *
 * 具体渲染器见 `renderers/`；插件事件协议见 `docs/architecture/learning-surface.md`。
 */
import { useEffect, useState } from 'react';
import './renderers/builtins';
import { getSurfaceRenderer, loadSurfaceRendererDirectory, sandboxRendererFromDescriptor } from './renderers/registry';
import { SandboxSurfaceRenderer } from './renderers/SandboxSurfaceRenderer';
import { useLearningSurfaceAttempt } from './useLearningSurfaceAttempt';
import type {
  LearningContentRef,
  LearningSurfaceRow,
  RendererDescriptor,
  SurfaceRenderer,
  SurfaceRendererProps,
} from './types';

export type { LearningContentRef, LearningSurfaceRow } from './types';

export interface LearningSurfaceHostProps {
  surfaceId: string;
  lessonId: string;
  /** 事件与 iframe 的归属 id；白板传元素 id，学案传活动 id。 */
  hostId?: string;
  title?: string;
  className?: string;
  lazy?: boolean;
  /** 教师预览：attempt 写 is_preview = 1，不计入学生统计。 */
  preview?: boolean;
}

type HostState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; surface: LearningSurfaceRow; contentRef: LearningContentRef };

function parseContentRef(json: string): LearningContentRef | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const source = record.source;
    if (typeof record.rendererId !== 'string' || !source || typeof source !== 'object') return null;
    const sourceRecord = source as Record<string, unknown>;
    if (typeof sourceRecord.kind !== 'string') return null;
    return parsed as LearningContentRef;
  } catch {
    return null;
  }
}

export function LearningSurfaceHost({
  surfaceId,
  lessonId,
  hostId,
  title,
  className,
  lazy = true,
  preview = false,
}: LearningSurfaceHostProps) {
  const [state, setState] = useState<HostState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    fetch(`/api/learning-surfaces/${encodeURIComponent(surfaceId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as LearningSurfaceRow;
      })
      .then((surface) => {
        if (cancelled) return;
        const contentRef = parseContentRef(surface.content_ref_json);
        if (!contentRef) {
          setState({ status: 'error', message: '内容引用损坏，无法加载' });
          return;
        }
        setState({ status: 'ready', surface, contentRef });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : '内容暂不可用' });
      });

    return () => {
      cancelled = true;
    };
  }, [surfaceId]);

  if (state.status === 'loading') {
    return (
      <div className={wrapClass(className)}>
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400 bg-slate-50 rounded-xl">
          内容加载中…
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={wrapClass(className)}>
        <SurfacePlaceholder title={title ?? '内容暂不可用'} message={state.message} />
      </div>
    );
  }

  return (
    <div className={wrapClass(className)}>
      <SurfaceBody
        surface={state.surface}
        contentRef={state.contentRef}
        lessonId={lessonId}
        hostId={hostId}
        title={title}
        preview={preview}
        lazy={lazy}
      />
    </div>
  );
}

function SurfaceBody({
  surface,
  contentRef,
  lessonId,
  hostId,
  title,
  preview,
  lazy,
}: {
  surface: LearningSurfaceRow;
  contentRef: LearningContentRef;
  lessonId: string;
  hostId?: string;
  title?: string;
  preview: boolean;
  lazy: boolean;
}) {
  const [descriptor, setDescriptor] = useState<RendererDescriptor | null>(null);
  const [directoryFailed, setDirectoryFailed] = useState(false);
  const builtin = getSurfaceRenderer(contentRef.rendererId);

  useEffect(() => {
    if (builtin) return;
    let cancelled = false;
    loadSurfaceRendererDirectory()
      .then((list) => {
        if (!cancelled) setDescriptor(list.find((item) => item.id === contentRef.rendererId) ?? null);
      })
      .catch(() => {
        if (!cancelled) setDirectoryFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [builtin, contentRef.rendererId]);

  const renderer = builtin ?? (descriptor ? sandboxRendererFromDescriptor(descriptor) : null);

  if (!renderer) {
    return (
      <SurfacePlaceholder
        title={title ?? contentRef.config?.title ?? contentRef.rendererId}
        message={directoryFailed ? '渲染器目录加载失败' : '该内容类型的渲染器尚未注册'}
        rendererId={contentRef.rendererId}
      />
    );
  }

  return (
    <RendererMount
      renderer={renderer}
      surface={surface}
      contentRef={contentRef}
      lessonId={lessonId}
      hostId={hostId}
      preview={preview}
      lazy={lazy}
    />
  );
}

function RendererMount({
  renderer,
  surface,
  contentRef,
  lessonId,
  hostId,
  preview,
  lazy,
}: {
  renderer: SurfaceRenderer;
  surface: LearningSurfaceRow;
  contentRef: LearningContentRef;
  lessonId: string;
  hostId?: string;
  preview: boolean;
  lazy: boolean;
}) {
  const { attempt, readOnly, onProgress, onSubmit } = useLearningSurfaceAttempt({
    surfaceId: surface.id,
    lessonId,
    preview,
    mode: renderer.attemptMode,
  });

  const props: SurfaceRendererProps = {
    surfaceId: surface.id,
    contentRef,
    lessonId,
    hostId: hostId ?? surface.id,
    preview,
    attempt,
    readOnly,
    onProgress,
    onSubmit,
  };

  if (renderer.execution === 'sandbox') {
    return <SandboxSurfaceRenderer renderer={renderer} props={props} />;
  }

  const Component = renderer.Component;
  if (!Component) {
    return (
      <SurfacePlaceholder
        title={contentRef.config?.title ?? contentRef.rendererId}
        message="渲染器未提供可渲染组件"
        rendererId={contentRef.rendererId}
      />
    );
  }

  // lazy 目前只对课件类 iframe 有意义；组件渲染器自行决定懒加载策略。
  void lazy;
  return <Component {...props} />;
}

function wrapClass(className?: string): string {
  return (className ?? 'w-full h-full') + ' relative';
}

function SurfacePlaceholder({ title, message, rendererId }: { title: string; message: string; rendererId?: string }) {
  return (
    <div
      data-testid="learning-surface-placeholder"
      data-renderer={rendererId}
      className="w-full h-full flex flex-col items-center justify-center gap-1.5 p-6 text-center bg-slate-50 rounded-xl"
    >
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      <p className="text-xs text-gray-400">{message}</p>
      {rendererId ? <p className="text-[10px] font-mono text-gray-300">{rendererId}</p> : null}
    </div>
  );
}

export default LearningSurfaceHost;
