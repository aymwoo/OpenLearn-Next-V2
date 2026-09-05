import React from 'react';
import { wrapSrcDocWithBridge } from '../utils/bridgeUtils';
import { coursewareSourceRegistry } from '../courseware/courseware-source-registry';
import { useCoursewareFrameMount } from '../courseware/courseware-frame-limiter';
import type { HtmlAppletPayload } from '../canvas-model/types';

export interface HtmlAppletFrameProps {
  data: HtmlAppletPayload;
  lessonId: string;
  className?: string;
  title?: string;
  /** 懒挂载（进入可视区才创建 iframe），默认 true */
  lazy?: boolean;
}

/**
 * 统一渲染 html-applet 的四种内容源（优先级从高到低）：
 *   1. coursewareUuid → `/runtime/:uuid/`（ZIP 解包的多文件互动课件）
 *   2. resourceId     → `/api/resources/:id/`（系统资源库单 HTML / 文件夹）
 *   3. 插件自定义内容源 → `coursewareSourceRegistry` 返回的 src URL
 *   4. code           → iframe `srcDoc` + `wrapSrcDocWithBridge`（手写 HTML）
 *
 * 画布内嵌、全屏渲染器、默认兜底渲染器三处复用此组件；并内置懒挂载与并发上限。
 */
export function HtmlAppletFrame({ data, lessonId, className, title, lazy = true }: HtmlAppletFrameProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mounted = useCoursewareFrameMount(lazy, containerRef);

  const customSrc = coursewareSourceRegistry.resolve(data, { lessonId });
  const src = data.coursewareUuid
    ? `/runtime/${data.coursewareUuid}/`
    : data.resourceId
      ? `/api/resources/${data.resourceId}/`
      : (customSrc ?? undefined);

  return (
    <div ref={containerRef} className={className ?? 'w-full h-full'}>
      {mounted ? (
        <iframe
          className="w-full h-full border-none"
          src={src}
          srcDoc={src ? undefined : wrapSrcDocWithBridge(data.code || '', lessonId)}
          sandbox="allow-scripts allow-forms allow-downloads"
          referrerPolicy="no-referrer"
          title={title ?? data.title ?? 'Interactive Courseware'}
          credentialless={true}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400 bg-slate-50 rounded-xl">
          课件未加载
        </div>
      )}
    </div>
  );
}
