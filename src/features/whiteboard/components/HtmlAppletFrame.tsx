import React, { useState, useEffect } from 'react';
import { wrapSrcDocWithBridge } from '../utils/bridgeUtils';
import { coursewareSourceRegistry } from '../courseware/courseware-source-registry';
import { useCoursewareFrameMount } from '../courseware/courseware-frame-limiter';
import { useThemeStore, getThemeTokens } from '../../../store/themeStore';
import { useFontSizeStore } from '../../../store/fontSizeStore';
import { broadcastThemeToIframes, broadcastFontScaleToIframes } from '../../../services/lms-bridge';
import { getSocketInstance } from '../../../services/socket-service';
import type { HtmlAppletPayload } from '../canvas-model/types';

export interface HtmlAppletFrameProps {
  data: HtmlAppletPayload;
  lessonId: string;
  className?: string;
  title?: string;
  /** 懒挂载（进入可视区才创建 iframe），默认 true */
  lazy?: boolean;
}

interface CoursewareAttempt {
  attemptId: string;
  studentId: string;
  studentName: string;
  score: number | null;
  completion: number | null;
  started_at: number;
  finished_at: number | null;
  status: string;
}

/**
 * 统一渲染 html-applet 的四种内容源（优先级从高到低）：
 *   1. coursewareUuid → `/runtime/:uuid/`（ZIP 解包的多文件互动课件）
 *   2. resourceId     → `/api/resources/:id/`（系统资源库单 HTML / 文件夹）
 *   3. 插件自定义内容源 → `coursewareSourceRegistry` 返回的 src URL
 *   4. code           → iframe `srcDoc` + `wrapSrcDocWithBridge`（手写 HTML）
 *
 * 画布内嵌、全屏渲染器、默认兜底渲染器三处复用此组件；并内置懒挂载与并发上限。
 *
 * 当承载的是具体的某个 coursewareUuid 时，叠加一层「实时成绩浮层」：
 *   - 进入时拉取该课件的全部 attempts（通过 GET /api/courseware/attempts?coursewareUuid=…）
 *   - 订阅 Socket.IO 的 `courseware-attempt-updated` 事件，自动重拉
 *   - 浮层按钮默认收起，避免遮挡课件；点击展开后只显示已提交的学生成绩
 */
export function HtmlAppletFrame({ data, lessonId, className, title, lazy = true }: HtmlAppletFrameProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mounted = useCoursewareFrameMount(lazy, containerRef);
  const { theme } = useThemeStore();
  const { scale } = useFontSizeStore();

  const [attempts, setAttempts] = useState<CoursewareAttempt[]>([]);
  const [showScores, setShowScores] = useState(false);

  useEffect(() => {
    const uuid = data.coursewareUuid;
    if (!uuid) return;
    let cancelled = false;

    const fetchAttempts = () => {
      fetch(`/api/courseware/attempts?coursewareUuid=${encodeURIComponent(uuid)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: CoursewareAttempt[]) => {
          if (!cancelled) setAttempts(Array.isArray(rows) ? rows : []);
        })
        .catch(() => {});
    };

    fetchAttempts();

    let socket: ReturnType<typeof getSocketInstance> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const onUpdate = () => fetchAttempts();

    try {
      socket = getSocketInstance();
      socket.on('courseware-attempt-updated', onUpdate);
    } catch {
      // Socket 还未注入（早期挂载或测试环境），降级为 5s 轮询
      timer = setInterval(fetchAttempts, 5000);
    }

    return () => {
      cancelled = true;
      if (socket) socket.off('courseware-attempt-updated', onUpdate);
      if (timer) clearInterval(timer);
    };
  }, [data.coursewareUuid]);

  const handleIframeLoad = () => {
    broadcastThemeToIframes(theme, getThemeTokens(theme));
    broadcastFontScaleToIframes(scale);
  };

  const customSrc = coursewareSourceRegistry.resolve(data, { lessonId });
  const src = data.coursewareUuid
    ? `/runtime/${data.coursewareUuid}/`
    : data.resourceId
      ? `/api/resources/${data.resourceId}/`
      : (customSrc ?? undefined);

  const submittedAttempts = attempts.filter(
    (a) => a.finished_at !== null && a.finished_at !== undefined,
  );
  const scoredAttempts = submittedAttempts.filter((a) => a.score !== null && a.score !== undefined);
  const avgScore =
    scoredAttempts.length > 0
      ? scoredAttempts.reduce((sum, a) => sum + (a.score || 0), 0) / scoredAttempts.length
      : null;
  const passScore = 60;
  const showOverlay = !!data.coursewareUuid && attempts.length > 0;

  return (
    <div ref={containerRef} className={(className ?? 'w-full h-full') + ' relative'}>
      {mounted ? (
        <iframe
          className="w-full h-full border-none"
          src={src}
          srcDoc={src ? undefined : wrapSrcDocWithBridge(data.code || '', lessonId)}
          sandbox="allow-scripts allow-forms allow-downloads"
          referrerPolicy="no-referrer"
          title={title ?? data.title ?? 'Interactive Courseware'}
          credentialless="true"
          onLoad={handleIframeLoad}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400 bg-slate-50 rounded-xl">
          课件未加载
        </div>
      )}

      {showOverlay && (
        <>
          <button
            type="button"
            onClick={() => setShowScores((v) => !v)}
            data-testid="courseware-scores-toggle"
            className="absolute top-2 right-2 z-10 px-3 py-1.5 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-white transition-colors"
          >
            {showScores ? '隐藏成绩' : `查看成绩 (${submittedAttempts.length})`}
          </button>

          {showScores && (
            <div
              data-testid="courseware-scores-panel"
              className="absolute top-12 right-2 z-10 w-72 max-h-96 overflow-auto bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3"
            >
              <div className="text-xs text-gray-400 mb-2 flex items-center justify-between">
                <span>
                  {submittedAttempts.length} 人已提交
                  {avgScore !== null && ` · 均分 ${avgScore.toFixed(1)}`}
                </span>
              </div>
              {submittedAttempts.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-4">暂无提交</div>
              ) : (
                <div className="space-y-1.5">
                  {submittedAttempts.map((a) => {
                    const scoreNum = typeof a.score === 'number' ? a.score : null;
                    const completionPct =
                      typeof a.completion === 'number' ? Math.round(a.completion * 100) : null;
                    return (
                      <div
                        key={a.attemptId}
                        className="flex items-center justify-between gap-2 text-xs"
                        data-testid={`courseware-attempt-row-${a.attemptId}`}
                      >
                        <span className="font-medium text-gray-700 truncate flex-1">
                          {a.studentName || a.studentId}
                        </span>
                        <span
                          className={`font-mono font-bold ${
                            scoreNum !== null && scoreNum >= passScore
                              ? 'text-green-600'
                              : 'text-red-500'
                          }`}
                        >
                          {scoreNum !== null ? scoreNum : '-'}
                          {completionPct !== null && (
                            <span className="ml-1 text-gray-400 font-normal">
                              {completionPct}%
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
