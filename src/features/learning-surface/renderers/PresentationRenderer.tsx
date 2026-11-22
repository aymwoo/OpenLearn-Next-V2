import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SurfaceRendererProps } from '../types';

const LazyPresentation = lazy(() =>
  import('../../whiteboard/widgets/RevealPresentationWrapper').then((mod) => ({
    default: mod.RevealPresentationWrapper,
  })),
);

type FileType = 'md' | 'pdf' | 'pptx' | 'file';

function fileTypeFromId(id: string): FileType {
  const clean = id.split('?')[0].toLowerCase();
  if (clean.endsWith('.md') || clean.endsWith('.markdown')) return 'md';
  if (clean.endsWith('.pdf')) return 'pdf';
  if (clean.endsWith('.pptx')) return 'pptx';
  return 'file';
}

function fileNameFromId(id: string): string {
  const clean = id.split('?')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || clean;
}

/** 从 attempt.state_json 恢复上次页码。 */
function restoredSlide(stateJson: string | null | undefined): number | undefined {
  if (!stateJson) return undefined;
  try {
    const parsed = JSON.parse(stateJson) as { slideX?: unknown };
    return typeof parsed.slideX === 'number' && parsed.slideX >= 0 ? parsed.slideX : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 内置 presentation 渲染器（阶段 4）。
 *
 * 复用白板 RevealPresentationWrapper，覆盖两种来源：
 *   - 内联 Markdown（`contentRef.config.markdown`，纯文本，不落 HTML）；
 *   - 资源库文件（`source.kind='resource'`，支持 .md / .pdf / .pptx，其余降级为下载卡）。
 *
 * 翻页只通过 `onSlideChange` 上报宿主，不写回元素 data。
 */
export function PresentationRenderer({
  contentRef,
  hostId,
  preview,
  attempt,
  readOnly,
  onProgress,
}: SurfaceRendererProps) {
  const resourceId = contentRef.source.kind === 'resource' ? contentRef.source.id : undefined;
  const fileType = useMemo<FileType>(() => (resourceId ? fileTypeFromId(resourceId) : 'md'), [resourceId]);
  const fileUrl = resourceId ? `/api/resources/${encodeURIComponent(resourceId)}/` : '';
  const fileName = resourceId ? fileNameFromId(resourceId) : '';

  const inlineMarkdown = contentRef.config?.markdown ?? '';
  const [fetchedMarkdown, setFetchedMarkdown] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hintId = useId();

  // 资源库 Markdown：取正文后交给 wrapper；其他类型由 wrapper 直接按 URL 加载。
  useEffect(() => {
    if (fileType !== 'md' || !fileUrl || inlineMarkdown) {
      setFetchedMarkdown(null);
      return;
    }
    let cancelled = false;
    fetch(fileUrl)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((text) => {
        if (!cancelled) setFetchedMarkdown(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Markdown 加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [fileType, fileUrl, inlineMarkdown]);

  if (loadError) {
    return (
      <div
        role="alert"
        className="w-full h-full flex items-center justify-center p-6 text-center text-xs text-rose-500 bg-slate-50 rounded-xl"
      >
        {loadError}
      </div>
    );
  }

  if (!inlineMarkdown && !resourceId) {
    return (
      <div
        role="status"
        className="w-full h-full flex flex-col items-center justify-center gap-1 p-6 text-center bg-slate-50 rounded-xl"
      >
        <p className="text-sm font-semibold text-gray-700">演示文稿未配置内容</p>
        <p className="text-xs text-gray-400">请绑定资源库文件，或填写内联 Markdown</p>
      </div>
    );
  }

  if (fileType === 'md' && !inlineMarkdown && fetchedMarkdown === null) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full h-full flex items-center justify-center text-xs text-gray-400 bg-slate-50 rounded-xl"
      >
        演示文稿加载中…
      </div>
    );
  }

  const slideX = restoredSlide(attempt?.state_json);

  return (
    <div
      ref={containerRef}
      data-testid="learning-surface-presentation"
      data-surface-scope={hostId}
      tabIndex={0}
      role="group"
      aria-label={contentRef.config?.title || '演示文稿'}
      aria-describedby={hintId}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, a, input, textarea, select, [contenteditable="true"], [role="textbox"]')) {
          return;
        }
        containerRef.current?.focus();
      }}
      className="w-full h-full min-h-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary-theme/50"
    >
      <span id={hintId} className="sr-only">
        点击内容区后使用左右方向键翻页，Home/End 跳到首尾页。
      </span>
      <Suspense
        fallback={
          <div
            role="status"
            aria-live="polite"
            className="w-full h-full flex items-center justify-center text-xs text-gray-400 bg-slate-50 rounded-xl"
          >
            演示文稿加载中…
          </div>
        }
      >
        <LazyPresentation
          elementId={hostId}
          userRole={preview ? 'teacher' : 'student'}
          data={{
            markdown: inlineMarkdown || fetchedMarkdown || undefined,
            fileUrl: fileUrl || undefined,
            fileType,
            fileName,
            ...(slideX !== undefined ? { slideX } : {}),
            // 学习面不把页码写回元素；只读时隐藏编辑入口。
            isSurface: true,
            readOnly,
          }}
          onSlideChange={(index, total) => {
            onProgress({
              completion: total > 0 ? Math.min(1, (index + 1) / total) : undefined,
              state: { slideX: index, slideCount: total },
            });
          }}
        />
      </Suspense>
    </div>
  );
}

export default PresentationRenderer;
