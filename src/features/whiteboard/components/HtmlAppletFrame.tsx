import React, { useState, useEffect } from 'react';
import { wrapSrcDocWithBridge } from '../utils/bridgeUtils';
import { coursewareSourceRegistry } from '../courseware/courseware-source-registry';
import { useCoursewareFrameMount } from '../courseware/courseware-frame-limiter';
import { useThemeStore, getThemeTokens } from '../../../store/themeStore';
import { useFontSizeStore } from '../../../store/fontSizeStore';
import { useAppStore } from '../../../store/appStore';
import { broadcastThemeToIframes, broadcastFontScaleToIframes } from '../../../services/lms-bridge';
import { getSocketInstance } from '../../../services/socket-service';
import type { HtmlAppletPayload } from '../canvas-model/types';
import { whiteboardEventSlot } from '../events/WhiteboardEventSlot';

function pickNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export interface HtmlAppletFrameProps {
  data: HtmlAppletPayload;
  lessonId: string;
  /** 白板元素 id（用于事件槽关联到具体画布组件），可选 */
  elementId?: string;
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

/** 榜单上不展示的占位身份：无登录会话的访客（guest attempt）与教师预览行 */
const PLACEHOLDER_STUDENT_IDS = new Set(['guest', 'teacher', 'teacher_preview']);

/**
 * 名次：按分数降序，同分并列（88/88/70 → 1/1/3）；未评分（只保存过进度）不参与排名。
 */
export function computeAttemptRanks(attempts: CoursewareAttempt[]): Map<string, number> {
  const scored = attempts
    .filter((a) => typeof a.score === 'number')
    .slice()
    .sort((a, b) => (b.score as number) - (a.score as number));
  const ranks = new Map<string, number>();
  let rank = 0;
  let prevScore: number | null = null;
  scored.forEach((attempt, index) => {
    const score = attempt.score as number;
    if (prevScore === null || score < prevScore) {
      rank = index + 1;
      prevScore = score;
    }
    ranks.set(attempt.attemptId, rank);
  });
  return ranks;
}

/**
 * 按名次排序（未评分排最后，同分按姓名稳定排序）——学生与教师看到同一顺序。
 */
export function sortAttemptsByRank(
  attempts: CoursewareAttempt[],
  ranks: Map<string, number>,
): CoursewareAttempt[] {
  return attempts.slice().sort((a, b) => {
    const ra = ranks.get(a.attemptId) ?? Number.MAX_SAFE_INTEGER;
    const rb = ranks.get(b.attemptId) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return (a.studentName || a.studentId).localeCompare(b.studentName || b.studentId, 'zh-Hans-CN');
  });
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
export function HtmlAppletFrame({ data, lessonId, elementId, className, title, lazy = true }: HtmlAppletFrameProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mounted = useCoursewareFrameMount(lazy, containerRef);
  const { theme } = useThemeStore();
  const { scale } = useFontSizeStore();
  const session = useAppStore((s) => s.session);

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

  /**
   * 监听 iframe 内的 postMessage，把 LMS Bridge SDK 协议事件归一化进 WhiteboardEventSlot。
   *
   * 注意：
   * - 仅监听本组件的 iframe（通过 contentWindow 引用比对），与全局 lms-bridge 监听器共存不冲突
   * - 适配 LMS_SUBMIT / LMS_SAVE_PROGRESS / LMS_FINISH / courseware:score / openlearn-cw-sdk:score
   * - 未知 LMS_* 协议事件统一记入 'courseware.unknown'，便于调试面板观察
   */
  useEffect(() => {
    const shapeId = elementId ?? data.title ?? undefined;
    const uuid = data.coursewareUuid;
    if (!shapeId && !uuid) return;
    if (!mounted) return;

    const iframe = containerRef.current?.querySelector('iframe');
    if (!iframe || !(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) return;

    const messageHandler = (event: MessageEvent) => {
      // 仅信任本组件的 iframe
      if (event.source !== iframe.contentWindow) return;

      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      // LMS Bridge SDK 协议
      if (msg.type === 'LMS_SUBMIT') {
        const payload = (msg.payload ?? {}) as Record<string, unknown>;
        whiteboardEventSlot.ingest({
          source: 'iframe.postMessage',
          type: 'courseware.submitted',
          lessonId,
          elementId: shapeId,
          coursewareUuid: uuid,
          attemptId: typeof msg.attempt_id === 'string' ? msg.attempt_id : undefined,
          payload: {
            score: pickNumber(payload.score ?? payload.grade),
            total: pickNumber(payload.total ?? payload.fullScore),
            completion: pickNumber(payload.completion ?? payload.progress),
            comment: typeof payload.comment === 'string' ? payload.comment : undefined,
          },
          raw: msg,
        });
      } else if (msg.type === 'LMS_SAVE_PROGRESS') {
        const payload = (msg.payload ?? {}) as Record<string, unknown>;
        whiteboardEventSlot.ingest({
          source: 'iframe.postMessage',
          type: 'courseware.progress_saved',
          lessonId,
          elementId: shapeId,
          coursewareUuid: uuid,
          attemptId: typeof msg.attempt_id === 'string' ? msg.attempt_id : undefined,
          payload: {
            score: pickNumber(payload.score),
            completion: pickNumber(payload.completion ?? payload.progress),
          },
          raw: msg,
        });
      } else if (msg.type === 'LMS_FINISH') {
        whiteboardEventSlot.ingest({
          source: 'iframe.postMessage',
          type: 'courseware.finished',
          lessonId,
          elementId: shapeId,
          coursewareUuid: uuid,
          attemptId: typeof msg.attempt_id === 'string' ? msg.attempt_id : undefined,
          payload: {},
          raw: msg,
        });
      } else if (msg.type === 'courseware:score' || msg.type === 'openlearn-cw-sdk:score') {
        // v2_plugins/courseware-hub SDK 协议
        const payload = (msg.payload ?? msg) as Record<string, unknown>;
        whiteboardEventSlot.ingest({
          source: 'applet.score',
          type: 'courseware.submitted',
          lessonId,
          elementId: shapeId,
          coursewareUuid: uuid,
          payload: {
            score: pickNumber(payload.score),
            total: pickNumber(payload.total),
            detail: payload.detail,
            source: typeof msg.source === 'string' ? msg.source : 'openlearn-cw-sdk',
          },
          raw: msg,
        });
      } else if (typeof msg.type === 'string' && msg.type.startsWith('LMS_')) {
        // 其他 LMS_* 协议事件统一记入 unknown 分桶
        whiteboardEventSlot.ingest({
          source: 'iframe.postMessage',
          type: 'courseware.unknown',
          lessonId,
          elementId: shapeId,
          coursewareUuid: uuid,
          payload: { originalType: msg.type },
          raw: msg,
        });
      }
    };

    window.addEventListener('message', messageHandler);
    return () => window.removeEventListener('message', messageHandler);
  }, [mounted, elementId, data.title, data.coursewareUuid, lessonId]);

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

  // ── 全班成绩榜（学生与教师共用同一套数据源与顺序）────────────────────────
  // 只有学生身份才谈「我的成绩」：教师/管理员看的是全班名单，不参与排名
  const myStudentId =
    session?.role === 'student' ? (session.studentId || session.userId || null) : null;
  const ranks = computeAttemptRanks(attempts);
  const leaderboardAttempts = submittedAttempts.filter(
    (a) => !PLACEHOLDER_STUDENT_IDS.has(a.studentId) || a.studentId === myStudentId,
  );
  const orderedAttempts = sortAttemptsByRank(leaderboardAttempts, ranks);
  const myAttempt = myStudentId
    ? (leaderboardAttempts.find((a) => a.studentId === myStudentId) ?? null)
    : null;
  const myRank = myAttempt ? (ranks.get(myAttempt.attemptId) ?? null) : null;
  const rankedCount = ranks.size;

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
          {...({ credentialless: 'true' } as any)}
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
            className="absolute top-2 right-2 z-[60] px-3 py-1.5 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-white transition-colors"
          >
            {showScores ? '隐藏成绩' : `查看成绩 (${orderedAttempts.length})`}
          </button>

          {showScores && (
            <div
              data-testid="courseware-scores-panel"
              className="absolute top-12 right-2 z-[60] w-72 max-h-96 overflow-auto bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-3"
            >
              <div className="text-xs text-gray-400 mb-2 flex items-center justify-between">
                <span>
                  {orderedAttempts.length} 人已提交
                  {avgScore !== null && ` · 均分 ${avgScore.toFixed(1)}`}
                </span>
              </div>

              {myStudentId && (
                <div
                  data-testid="courseware-my-score"
                  className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5 mb-2"
                >
                  {myAttempt
                    ? `我的成绩 ${typeof myAttempt.score === 'number' ? myAttempt.score : '—'}${
                        myRank !== null ? ` · 全班第 ${myRank}/${rankedCount} 名` : ''
                      }`
                    : '我还没有提交'}
                </div>
              )}

              {orderedAttempts.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-4">暂无提交</div>
              ) : (
                <div className="space-y-1.5">
                  {orderedAttempts.map((a) => {
                    const scoreNum = typeof a.score === 'number' ? a.score : null;
                    const completionPct =
                      typeof a.completion === 'number' ? Math.round(a.completion * 100) : null;
                    const rank = ranks.get(a.attemptId);
                    const isSelf = !!myStudentId && a.studentId === myStudentId;
                    return (
                      <div
                        key={a.attemptId}
                        className={`flex items-center justify-between gap-2 text-xs rounded-md px-1.5 py-1 ${
                          isSelf ? 'bg-blue-50 ring-1 ring-blue-200' : ''
                        }`}
                        data-testid={`courseware-attempt-row-${a.attemptId}`}
                      >
                        <span className="w-4 shrink-0 text-right font-mono text-gray-400">
                          {rank ?? '-'}
                        </span>
                        <span className="font-medium text-gray-700 truncate flex-1">
                          {a.studentName || a.studentId}
                          {isSelf && <span className="ml-1 font-normal text-blue-600">（我）</span>}
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
