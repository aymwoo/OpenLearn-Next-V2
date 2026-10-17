import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Archive, Clock, Loader2, Play, Plus, RefreshCw, Users } from 'lucide-react';
import type { ClassroomSessionItem } from './ClassroomSessionManager';

/**
 * Issue #91：进入「互动课堂」后的第一屏 —— 进行中的课堂会话列表。
 *
 * 为什么要这一屏：此前只要当前课节存在未结束的会话，`LiveClassroomView` 的轮询就会
 * `setShowEntryPortal(false)` 直接进授课视图，教师既没有机会换到另一场进行中的会话，
 * 也看不到自己手上还挂着几节课。
 *
 * 这一屏只做「选择」这一件事：
 * - 继续上课：由宿主恢复 lesson + class 与 stage，进入授课视图；
 * - 结束/归档：二次确认后调用既有 `POST /api/classroom/sessions/:id/archive`；
 * - 开始一节新课：交回起始门户（不影响其它进行中的会话）；
 * - 一场进行中的会话都没有时，回调 `onEmpty()` 让宿主直接显示起始门户（与旧行为一致）。
 */
export interface InProgressSessionListProps {
  lang?: string;
  /** 当前选中/正在上的课节，用于把「你正在上的那节课」排在前面并高亮 */
  currentLessonId?: string | null;
  onResume: (session: ClassroomSessionItem) => void;
  onStartNew: () => void;
  onOpenArchive: () => void;
  /** 一次都没拿到进行中的会话时回调（宿主据此回退到起始门户） */
  onEmpty: () => void;
  addToast?: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

const STAGE_LABEL: Record<string, { zh: string; en: string; cls: string }> = {
  IN_CLASS_TEACHING: {
    zh: '授课进行中',
    en: 'In Progress',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60',
  },
  WRAP_UP_EXIT_TICKET: {
    zh: '结课出门票中',
    en: 'Wrap-up Ticket',
    cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800/60',
  },
  PRE_CLASS_READY: {
    zh: '课前准备',
    en: 'Pre-class Ready',
    cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800/60',
  },
};

function stageLabel(stage: string, zh: boolean): { text: string; cls: string } {
  const hit = STAGE_LABEL[stage];
  if (!hit) {
    return { text: stage || '—', cls: 'bg-surface-secondary text-muted border-theme' };
  }
  return { text: zh ? hit.zh : hit.en, cls: hit.cls };
}

function elapsedLabel(startedAt: number | null, zh: boolean): string {
  if (!startedAt) return zh ? '未开课' : 'Not started';
  const mins = Math.max(0, Math.floor((Date.now() - startedAt) / 1000 / 60));
  if (mins < 60) return zh ? `已进行 ${mins} 分钟` : `${mins}m elapsed`;
  const hours = Math.floor(mins / 60);
  return zh ? `已进行 ${hours} 小时 ${mins % 60} 分` : `${hours}h ${mins % 60}m elapsed`;
}

function startTimeLabel(startedAt: number | null, zh: boolean): string {
  if (!startedAt) return zh ? '未开课' : 'Not started';
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function InProgressSessionList({
  lang = 'zh',
  currentLessonId,
  onResume,
  onStartNew,
  onOpenArchive,
  onEmpty,
  addToast,
}: InProgressSessionListProps) {
  const zh = lang === 'zh';
  const [sessions, setSessions] = useState<ClassroomSessionItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const addToastRef = useRef(addToast);
  const onEmptyRef = useRef(onEmpty);
  /** 只在第一次拿到「空列表」时回调 onEmpty，避免轮询把教师从门户里拽回来。 */
  const emptyReportedRef = useRef(false);

  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);
  useEffect(() => {
    onEmptyRef.current = onEmpty;
  }, [onEmpty]);

  const fetchSessions = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        const res = await fetch('/api/classroom/sessions?status=active&pageSize=all');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items: ClassroomSessionItem[] = Array.isArray(data?.items) ? data.items : [];
        setSessions(items);
        setLoadError(null);
        if (items.length === 0 && !emptyReportedRef.current) {
          emptyReportedRef.current = true;
          onEmptyRef.current();
        }
      } catch (err: any) {
        setLoadError(err?.message || (zh ? '网络请求异常' : 'Network error'));
      } finally {
        setRefreshing(false);
      }
    },
    [zh],
  );

  useEffect(() => {
    void fetchSessions();
    const timer = setInterval(() => void fetchSessions(), 15000);
    return () => clearInterval(timer);
  }, [fetchSessions]);

  const handleArchive = async (session: ClassroomSessionItem) => {
    setArchivingId(session.id);
    try {
      const res = await fetch(`/api/classroom/sessions/${session.id}/archive`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      addToastRef.current?.(
        zh ? '已结束并归档' : 'Session archived',
        zh ? '该会话已移出进行中列表' : 'The session was moved out of the in-progress list',
        'success',
      );
      setConfirmArchiveId(null);
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== session.id) : prev));
      void fetchSessions(true);
    } catch (err: any) {
      addToastRef.current?.(
        zh ? '归档失败' : 'Failed to archive',
        err?.message || (zh ? '未知错误' : 'Unknown error'),
        'error',
      );
    } finally {
      setArchivingId(null);
    }
  };

  // 轮询前不要闪屏：首屏用骨架而不是立刻判定「没有会话」
  if (sessions === null && !loadError) {
    return (
      <div
        data-testid="in-progress-sessions-loading"
        className="flex-1 flex items-center justify-center gap-2 text-sm text-muted"
      >
        <Loader2 size={16} className="animate-spin" />
        {zh ? '正在加载进行中的课堂会话…' : 'Loading in-progress sessions…'}
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        data-testid="in-progress-sessions-error"
        className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted"
      >
        <span>{zh ? '加载进行中的会话失败' : 'Failed to load in-progress sessions'}</span>
        <span className="text-xs">{loadError}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              void fetchSessions(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme bg-surface hover:bg-surface-secondary text-xs font-semibold text-main cursor-pointer"
          >
            <RefreshCw size={13} />
            {zh ? '重试' : 'Retry'}
          </button>
          <button
            type="button"
            onClick={onStartNew}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-theme text-white text-xs font-bold cursor-pointer"
          >
            <Plus size={13} />
            {zh ? '开始一节新课' : 'Start a new lesson'}
          </button>
        </div>
      </div>
    );
  }

  const ordered = (sessions ?? []).slice().sort((a, b) => {
    const aCurrent = currentLessonId && a.lessonId === currentLessonId ? 1 : 0;
    const bCurrent = currentLessonId && b.lessonId === currentLessonId ? 1 : 0;
    if (aCurrent !== bCurrent) return bCurrent - aCurrent;
    return (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt);
  });

  return (
    <div
      data-testid="in-progress-session-list"
      className="flex-1 flex flex-col min-h-0 bg-surface border border-theme rounded-2xl shadow-xl overflow-hidden font-sans"
    >
      <div className="px-6 py-4 border-b border-theme bg-surface-secondary/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-main flex items-center gap-2">
            <Activity size={16} className="text-emerald-500" />
            {zh ? '进行中的课堂会话' : 'In-progress classroom sessions'}
          </h2>
          <p className="text-xs text-muted mt-0.5">
            {zh
              ? '选择一场继续上课，或开始一节新课。进行中的课不能换班。'
              : 'Resume a session or start a new lesson. An in-progress session keeps its class.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => void fetchSessions(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme bg-surface hover:bg-surface-secondary text-xs font-semibold text-main cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            {zh ? '刷新' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={onOpenArchive}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme bg-surface hover:bg-surface-secondary text-xs font-semibold text-main cursor-pointer"
          >
            <Archive size={13} />
            {zh ? '全部会话档案' : 'All sessions'}
          </button>
          <button
            type="button"
            onClick={onStartNew}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-theme text-white text-xs font-bold shadow-sm hover:brightness-105 cursor-pointer"
          >
            <Plus size={13} />
            {zh ? '开始一节新课' : 'Start a new lesson'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {ordered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted">
            <span>{zh ? '当前没有进行中的课堂会话' : 'No in-progress sessions right now'}</span>
            <button
              type="button"
              onClick={onStartNew}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-theme text-white text-xs font-bold cursor-pointer"
            >
              <Plus size={13} />
              {zh ? '开始一节新课' : 'Start a new lesson'}
            </button>
          </div>
        ) : (
          ordered.map((s) => {
            const stage = stageLabel(s.stage, zh);
            const isCurrent = Boolean(currentLessonId && s.lessonId === currentLessonId);
            const confirming = confirmArchiveId === s.id;
            return (
              <div
                key={s.id}
                data-testid={`in-progress-session-${s.id}`}
                data-current={isCurrent ? 'true' : 'false'}
                className={`bg-surface border rounded-xl px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3 ${
                  isCurrent ? 'border-emerald-400/70 ring-1 ring-emerald-400/40' : 'border-theme'
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-main truncate max-w-[320px]">{s.lessonTitle}</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold border ${stage.cls}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {stage.text}
                    </span>
                    {isCurrent && (
                      <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-primary-theme/10 text-primary-ink border border-primary-theme/25">
                        {zh ? '当前课节' : 'Current lesson'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-2xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Users size={11} />
                      {s.className}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} />
                      {elapsedLabel(s.startedAt, zh)}
                    </span>
                    <span className="inline-flex items-center gap-1" title={zh ? '开课时间' : 'Started at'}>
                      {startTimeLabel(s.startedAt, zh)}
                    </span>
                    <span
                      className="inline-flex items-center gap-1"
                      title={zh ? '已进入本节课堂且在线的学生数' : 'Students currently in this live class'}
                    >
                      <Users size={11} className="text-emerald-500" />
                      {zh ? `在场 ${s.presentCount ?? 0} 人` : `${s.presentCount ?? 0} present`}
                    </span>
                    {s.teachingModeName && <span className="truncate max-w-[160px]">{s.teachingModeName}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onResume(s)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-sm hover:bg-emerald-700 cursor-pointer"
                  >
                    <Play size={13} />
                    {zh ? '继续上课' : 'Resume'}
                  </button>
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleArchive(s)}
                        disabled={archivingId === s.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                      >
                        {archivingId === s.id ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                        {zh ? '确认归档' : 'Confirm archive'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmArchiveId(null)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme bg-surface hover:bg-surface-secondary text-xs font-semibold text-main cursor-pointer"
                      >
                        {zh ? '取消' : 'Cancel'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmArchiveId(s.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme bg-surface hover:bg-surface-secondary text-xs font-semibold text-main cursor-pointer"
                    >
                      <Archive size={13} />
                      {zh ? '结束并归档' : 'End & archive'}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
