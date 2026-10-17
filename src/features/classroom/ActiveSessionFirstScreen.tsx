import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Archive, Calendar, Clock, Loader2, Play, Sparkles, Users } from 'lucide-react';
import { isInProgressClassLocked } from './class-session-lock';

/**
 * Issue #91: 进入互动课堂的「进行中会话」首屏。
 *
 * 教师进入互动课堂时，若存在真正进行中（IN_CLASS_TEACHING / WRAP_UP_EXIT_TICKET，
 * 与 class-session-lock 的「进行中」口径一致）的课堂会话，先展示本列表让教师
 * 显式选择「继续上课」或「开始一节新课」，不再自动进入未结束的会话。
 * 没有进行中会话时通过 onEmpty 回退到既有起始门户（行为不变）。
 */

export interface ActiveSessionItem {
  id: string;
  lessonId: string;
  lessonTitle: string;
  classId: string | null;
  className: string;
  stage: string;
  teachingModeName: string | null;
  startedAt: number | null;
}

export interface ActiveSessionFirstScreenProps {
  lang?: string;
  onResumeSession: (session: ActiveSessionItem) => void;
  /** 「开始一节新课」：进入既有起始门户 */
  onStartNew: () => void;
  /** 没有进行中会话（或全部被归档）时回退到起始门户 */
  onEmpty: () => void;
  addToast?: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

function formatElapsed(startedAt: number | null, zh: boolean): string {
  if (!startedAt) return zh ? '未开课' : 'Not started';
  const mins = Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
  return zh ? `已进行 ${mins} 分钟` : `${mins}m elapsed`;
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function StageBadge({ stage, zh }: { stage: string; zh: boolean }) {
  if (stage === 'WRAP_UP_EXIT_TICKET') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        {zh ? '结课通票中' : 'Wrap-up Ticket'}
      </span>
    );
  }
  // IN_CLASS_TEACHING 及其它非归档阶段均按「授课进行中」展示
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      {zh ? '授课进行中' : 'In Progress'}
    </span>
  );
}

export function ActiveSessionFirstScreen({
  lang = 'zh',
  onResumeSession,
  onStartNew,
  onEmpty,
  addToast,
}: ActiveSessionFirstScreenProps) {
  const zh = lang === 'zh';
  const addToastRef = useRef(addToast);
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

  const [sessions, setSessions] = useState<ActiveSessionItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const fetchSessions = useCallback(async (): Promise<ActiveSessionItem[]> => {
    setLoading(true);
    try {
      const res = await fetch('/api/classroom/sessions?status=active&pageSize=all');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items: ActiveSessionItem[] = Array.isArray(data?.items) ? data.items : [];
      // 只拦截「真正进行中」的会话（与轮询自动进入的旧口径一致）；
      // PRE_CLASS_READY 会话仍走起始门户。
      const inProgress = items.filter((s) => isInProgressClassLocked(s.stage));
      setSessions(inProgress);
      return inProgress;
    } catch (err: any) {
      console.error('Failed to fetch active sessions:', err);
      addToastRef.current?.(
        zh ? '加载进行中会话失败' : 'Failed to load active sessions',
        err?.message || (zh ? '网络请求异常' : 'Network error'),
        'error',
      );
      setSessions([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [zh]);

  useEffect(() => {
    let mounted = true;
    void fetchSessions().then((items) => {
      if (mounted && items.length === 0) {
        onEmpty();
      }
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleArchive = async (session: ActiveSessionItem) => {
    // 二次确认：归档会结束该节课的进行中状态
    if (!window.confirm(zh ? `确认结束并归档「${session.lessonTitle}」的课堂会话吗？` : `Archive the session "${session.lessonTitle}"?`)) {
      return;
    }
    setArchivingId(session.id);
    try {
      const res = await fetch(`/api/classroom/sessions/${session.id}/archive`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      addToastRef.current?.(
        zh ? '归档成功' : 'Archived successfully',
        zh ? '会话已移入已归档档案库' : 'Session moved to archived reports',
        'success',
      );
      const remaining = await fetchSessions();
      if (remaining.length === 0) {
        onEmpty();
      }
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

  return (
    <div
      data-testid="active-session-first-screen"
      className="flex-1 flex flex-col h-full min-h-0 bg-surface border border-theme rounded-2xl shadow-xl overflow-hidden font-sans"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-theme bg-surface-secondary/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-main flex items-center gap-2">
            <Activity size={18} className="text-emerald-600" />
            {zh ? '进行中的课堂会话' : 'Active Classroom Sessions'}
          </h2>
          <p className="text-xs text-muted mt-0.5">
            {zh
              ? '选择一个会话继续上课，或开始一节新课。'
              : 'Resume an active session or start a new class.'}
          </p>
        </div>
        <button
          type="button"
          data-testid="start-new-class-btn"
          onClick={onStartNew}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-theme text-white text-xs font-bold shadow-sm hover:brightness-105 transition-all cursor-pointer shrink-0"
        >
          <Sparkles size={13} />
          <span>{zh ? '开始一节新课' : 'Start a New Class'}</span>
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {sessions === null || loading ? (
          <div className="h-64 flex flex-col items-center justify-center text-muted gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-primary-theme" />
            <p className="text-xs">{zh ? '正在查询进行中的课堂会话...' : 'Checking active sessions...'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5">
            {sessions.map((session) => (
              <div
                key={session.id}
                data-testid={`active-session-${session.id}`}
                className="bg-surface border border-theme hover:border-emerald-400/40 rounded-2xl p-4.5 shadow-3xs hover:shadow-2xs transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-4 min-w-0">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                    <Activity size={22} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h4 className="text-sm font-bold text-main truncate max-w-md">{session.lessonTitle}</h4>
                      <StageBadge stage={session.stage} zh={zh} />
                      {session.teachingModeName && (
                        <span className="px-2 py-0.5 rounded-lg bg-surface-secondary text-muted border border-theme text-2xs font-semibold">
                          {session.teachingModeName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Users size={13} className="shrink-0" />
                        <span className="font-medium text-main/90">{session.className}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={13} className="shrink-0" />
                        <span>{formatElapsed(session.startedAt, zh)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-2xs">
                        <Calendar size={12} className="shrink-0" />
                        <span>{formatTimestamp(session.startedAt)}</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end lg:self-auto border-t lg:border-t-0 pt-3 lg:pt-0 border-theme w-full lg:w-auto justify-end">
                  <button
                    type="button"
                    data-testid={`resume-session-${session.id}`}
                    aria-label={`${zh ? '继续上课' : 'Resume'}：${session.lessonTitle}`}
                    onClick={() => onResumeSession(session)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                  >
                    <Play size={13} />
                    <span>{zh ? '继续上课' : 'Resume'}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${zh ? '结束并归档' : 'End & archive'}：${session.lessonTitle}`}
                    onClick={() => void handleArchive(session)}
                    disabled={archivingId === session.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 text-amber-700 dark:text-amber-300 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {archivingId === session.id ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                    <span>{zh ? '结束并归档' : 'End & Archive'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ActiveSessionFirstScreen;
