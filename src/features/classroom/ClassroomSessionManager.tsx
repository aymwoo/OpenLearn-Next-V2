import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Activity,
  Archive,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  GraduationCap,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Users,
  Vote,
  Sparkles,
} from 'lucide-react';
import { ClassroomSessionDeleteModal } from './ClassroomSessionDeleteModal';

export interface ClassroomSessionStats {
  pollCount: number;
  exitTicketCount: number;
  feedCount: number;
}

export interface ClassroomSessionItem {
  id: string;
  lessonId: string;
  lessonTitle: string;
  classId: string | null;
  className: string;
  teacherId: string;
  stage: string;
  teachingModeId: string | null;
  teachingModeName: string | null;
  checkinCode: string | null;
  focusMode: boolean;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  stats: ClassroomSessionStats;
  /** 已经进入本节 live class 且仍在线的学生数（Issue #91；服务端 getPresentStudentIds 派生） */
  presentCount?: number;
}

export interface ClassroomSessionManagerProps {
  lessons: any[];
  classes: any[];
  lang?: string;
  onBackToPortal: () => void;
  onResumeSession: (session: ClassroomSessionItem) => void;
  onViewReport?: (session: ClassroomSessionItem) => void;
  onSessionArchived?: (session: ClassroomSessionItem) => void;
  onSessionDeleted?: (session: ClassroomSessionItem) => void;
  addToast?: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

function formatSessionDuration(startedAt: number | null, endedAt: number | null, stage: string, zh: boolean): string {
  if (!startedAt) return zh ? '未开课' : 'Not started';
  const finishTime = endedAt || Date.now();
  const diffSec = Math.max(0, Math.floor((finishTime - startedAt) / 1000));
  const mins = Math.floor(diffSec / 60);
  const hours = Math.floor(mins / 60);

  if (stage !== 'ARCHIVED_REPORT') {
    return zh ? `已进行 ${mins} 分钟` : `${mins}m elapsed`;
  }
  if (hours > 0) {
    return zh ? `${hours}小时${mins % 60}分` : `${mins} 分钟`;
  }
  return zh ? `${mins} 分钟` : `${mins} mins`;
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ClassroomSessionManager({
  lessons,
  classes,
  lang = 'zh',
  onBackToPortal,
  onResumeSession,
  onViewReport,
  onSessionArchived,
  onSessionDeleted,
  addToast,
}: ClassroomSessionManagerProps) {
  const zh = lang === 'zh';
  const addToastRef = useRef(addToast);
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

  const [sessions, setSessions] = useState<ClassroomSessionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [loading, setLoading] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Actions states
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<ClassroomSessionItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchSessions = useCallback(async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (selectedLessonId) params.set('lessonId', selectedLessonId);
      if (selectedClassId) params.set('classId', selectedClassId);
      if (debouncedSearchQuery.trim()) params.set('search', debouncedSearchQuery.trim());

      const res = await fetch(`/api/classroom/sessions?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (controller.signal.aborted) return;
      setSessions(data.items || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      console.error('Failed to fetch sessions:', err);
      addToastRef.current?.(
        zh ? '加载会话失败' : 'Failed to load sessions',
        err.message || (zh ? '网络请求异常' : 'Network error'),
        'error',
      );
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [page, statusFilter, selectedLessonId, selectedClassId, debouncedSearchQuery, zh]);

  useEffect(() => {
    void fetchSessions();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchSessions]);

  // Handle Archive
  const handleArchive = async (sessionId: string) => {
    const targetSession = sessions.find((s) => s.id === sessionId);
    setArchivingId(sessionId);
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/archive`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      addToastRef.current?.(
        zh ? '归档成功' : 'Archived successfully',
        zh ? '会话已移入已归档档案库' : 'Session moved to archived reports',
        'success',
      );
      if (targetSession) {
        onSessionArchived?.(targetSession);
      }
      void fetchSessions();
    } catch (err: any) {
      addToastRef.current?.(
        zh ? '归档失败' : 'Failed to archive',
        err.message || (zh ? '未知错误' : 'Unknown error'),
        'error',
      );
    } finally {
      setArchivingId(null);
    }
  };

  // Handle Delete
  const confirmDelete = async () => {
    if (!sessionToDelete) return;
    const deletedTarget = sessionToDelete;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/classroom/sessions/${deletedTarget.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      addToastRef.current?.(
        zh ? '删除成功' : 'Deleted successfully',
        zh ? '会话及其关联数据已彻底清理' : 'Session and cascaded data removed',
        'success',
      );
      setSessionToDelete(null);
      onSessionDeleted?.(deletedTarget);
      void fetchSessions();
    } catch (err: any) {
      addToastRef.current?.(
        zh ? '删除失败' : 'Failed to delete',
        err.message || (zh ? '未知错误' : 'Unknown error'),
        'error',
      );
    } finally {
      setIsDeleting(false);
    }
  };

  // Summary indicators
  const activeCount = useMemo(() => sessions.filter((s) => s.stage !== 'ARCHIVED_REPORT').length, [sessions]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const getStageBadge = (stage: string) => {
    switch (stage) {
      case 'IN_CLASS_TEACHING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {zh ? '授课进行中' : 'In Progress'}
          </span>
        );
      case 'WRAP_UP_EXIT_TICKET':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            {zh ? '结课通票中' : 'Wrap-up Ticket'}
          </span>
        );
      case 'PRE_CLASS_READY':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200 dark:border-blue-800/60">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            {zh ? '课前准备' : 'Pre-class Ready'}
          </span>
        );
      case 'ARCHIVED_REPORT':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-medium bg-surface-secondary text-muted border border-theme">
            <Archive size={11} />
            {zh ? '已归档战报' : 'Archived'}
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-surface border border-theme rounded-2xl shadow-xl overflow-hidden font-sans">
      {/* 1. Header Toolbar */}
      <div className="px-6 py-4 border-b border-theme bg-surface-secondary/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToPortal}
            className="p-2 rounded-xl border border-theme bg-surface hover:bg-surface-secondary text-muted hover:text-main transition-colors shrink-0 shadow-3xs cursor-pointer"
            title={zh ? '返回课堂启动门户' : 'Back to entry portal'}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-main truncate">
                {zh ? '课堂会话与档案管理' : 'Classroom Sessions & Archive'}
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-primary-theme/10 text-primary-theme border border-primary-theme/20 text-2xs font-bold">
                {total} {zh ? '场会话' : 'Sessions'}
              </span>
            </div>
            <p className="text-xs text-muted mt-0.5 truncate">
              {zh
                ? '查看、恢复当前活跃授课或归档历史课节记录，支持级联安全清理'
                : 'Manage, resume, archive or delete interactive classroom session lifecycles'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => void fetchSessions()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme bg-surface hover:bg-surface-secondary text-xs font-semibold text-main transition-colors shadow-3xs cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>{zh ? '刷新列表' : 'Refresh'}</span>
          </button>
          <button
            type="button"
            onClick={onBackToPortal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-theme text-white text-xs font-bold shadow-sm hover:brightness-105 transition-all cursor-pointer"
          >
            <Sparkles size={13} />
            <span>{zh ? '前往开课门户' : 'Launch New Class'}</span>
          </button>
        </div>
      </div>

      {/* 2. Top Summary Indicators */}
      <div className="px-6 py-3 border-b border-theme bg-surface grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        <div className="bg-surface-secondary/50 border border-theme rounded-xl px-3.5 py-2.5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
            <Activity size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-2xs text-muted font-medium">{zh ? '本页进行中会话' : 'Active on Page'}</p>
            <p className="text-sm font-bold text-main">{activeCount}</p>
          </div>
        </div>

        <div className="bg-surface-secondary/50 border border-theme rounded-xl px-3.5 py-2.5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0">
            <Archive size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-2xs text-muted font-medium">{zh ? '全部会话记录' : 'Total Sessions'}</p>
            <p className="text-sm font-bold text-main">{total}</p>
          </div>
        </div>

        <div className="bg-surface-secondary/50 border border-theme rounded-xl px-3.5 py-2.5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0">
            <Layers size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-2xs text-muted font-medium">{zh ? '关联课程数' : 'Lessons'}</p>
            <p className="text-sm font-bold text-main">{lessons.length}</p>
          </div>
        </div>

        <div className="bg-surface-secondary/50 border border-theme rounded-xl px-3.5 py-2.5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
            <GraduationCap size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-2xs text-muted font-medium">{zh ? '关联班级数' : 'Classes'}</p>
            <p className="text-sm font-bold text-main">{classes.length}</p>
          </div>
        </div>
      </div>

      {/* 3. Filter and Search Bar */}
      <div className="px-6 py-3 border-b border-theme bg-surface flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status Segmented Control */}
          <div className="inline-flex p-1 bg-surface-secondary border border-theme rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setPage(1);
              }}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'all' ? 'bg-surface text-main shadow-3xs font-bold' : 'text-muted hover:text-main'
              }`}
            >
              {zh ? '全部会话' : 'All'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('active');
                setPage(1);
              }}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'active'
                  ? 'bg-surface text-emerald-600 dark:text-emerald-400 shadow-3xs font-bold'
                  : 'text-muted hover:text-main'
              }`}
            >
              {zh ? '进行中' : 'Active'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('archived');
                setPage(1);
              }}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                statusFilter === 'archived'
                  ? 'bg-surface text-purple-600 dark:text-purple-400 shadow-3xs font-bold'
                  : 'text-muted hover:text-main'
              }`}
            >
              {zh ? '已归档' : 'Archived'}
            </button>
          </div>

          {/* Lesson Filter */}
          <select
            value={selectedLessonId}
            onChange={(e) => {
              setSelectedLessonId(e.target.value);
              setPage(1);
            }}
            className="px-3 py-1.5 bg-surface-secondary border border-theme rounded-xl text-xs text-main outline-none focus:border-primary-theme"
          >
            <option value="">{zh ? '全部课节' : 'All Lessons'}</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>

          {/* Class Filter */}
          <select
            value={selectedClassId}
            onChange={(e) => {
              setSelectedClassId(e.target.value);
              setPage(1);
            }}
            className="px-3 py-1.5 bg-surface-secondary border border-theme rounded-xl text-xs text-main outline-none focus:border-primary-theme"
          >
            <option value="">{zh ? '全部班级' : 'All Classes'}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder={zh ? '搜索课程、班级或会话 ID...' : 'Search course, class...'}
            className="w-full pl-8 pr-3 py-1.5 bg-surface-secondary border border-theme rounded-xl text-xs text-main placeholder-muted outline-none focus:border-primary-theme"
          />
        </div>
      </div>

      {/* 4. Session List View */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {loading && sessions.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-muted gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-primary-theme" />
            <p className="text-xs">{zh ? '正在加载课堂会话数据...' : 'Loading classroom sessions...'}</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="h-64 border border-dashed border-theme rounded-2xl flex flex-col items-center justify-center text-muted gap-3 p-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-surface-secondary flex items-center justify-center text-muted">
              <Calendar size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-main">{zh ? '暂无匹配的课堂会话' : 'No classroom sessions found'}</p>
              <p className="text-xs text-muted mt-1 max-w-sm">
                {zh
                  ? '当前筛选条件下没有找到授课记录。您可以前往开课门户发起新课堂。'
                  : 'No records under current filters. You can launch a new classroom session.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onBackToPortal}
              className="mt-2 px-4 py-2 rounded-xl bg-primary-theme text-white text-xs font-bold shadow-xs hover:brightness-105 transition-all cursor-pointer"
            >
              {zh ? '前往开课门户' : 'Launch New Class'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5">
            {sessions.map((session) => {
              const isArchived = session.stage === 'ARCHIVED_REPORT';
              const isArchiving = archivingId === session.id;

              return (
                <div
                  key={session.id}
                  className="bg-surface border border-theme hover:border-primary-theme/40 rounded-2xl p-4.5 shadow-3xs hover:shadow-2xs transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  {/* Left info column */}
                  <div className="flex items-start gap-4 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
                        !isArchived
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                          : 'bg-surface-secondary text-muted border-theme'
                      }`}
                    >
                      {!isArchived ? <Activity size={22} /> : <FileText size={22} />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h4 className="text-sm font-bold text-main truncate max-w-md">{session.lessonTitle}</h4>
                        {getStageBadge(session.stage)}
                        {session.teachingModeName && (
                          <span className="px-2 py-0.5 rounded-lg bg-surface-secondary text-muted border border-theme text-2xs font-semibold">
                            {session.teachingModeName}
                          </span>
                        )}
                        {session.checkinCode && (
                          <span className="px-1.5 py-0.5 rounded text-2xs font-mono bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/40">
                            {zh ? `签到码 ${session.checkinCode}` : `Code ${session.checkinCode}`}
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
                          <span>{formatSessionDuration(session.startedAt, session.endedAt, session.stage, zh)}</span>
                        </span>

                        <span className="inline-flex items-center gap-1 text-2xs">
                          <Calendar size={12} className="shrink-0" />
                          <span>{formatTimestamp(session.createdAt)}</span>
                        </span>
                      </div>

                      {/* Interactive Metrics Pills */}
                      <div className="flex items-center gap-2 mt-2.5">
                        <span
                          className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-md bg-surface-secondary border border-theme text-muted"
                          title={zh ? '随堂快速投票' : 'Quick polls'}
                        >
                          <Vote size={11} />
                          <span>
                            {zh ? `${session.stats.pollCount} 次互动投票` : `${session.stats.pollCount} polls`}
                          </span>
                        </span>
                        <span
                          className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-md bg-surface-secondary border border-theme text-muted"
                          title={zh ? '结课通票提交数' : 'Exit ticket submissions'}
                        >
                          <CheckCircle2 size={11} />
                          <span>
                            {zh
                              ? `${session.stats.exitTicketCount} 份结课通票`
                              : `${session.stats.exitTicketCount} exit tickets`}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right actions column */}
                  <div className="flex items-center gap-2 shrink-0 self-end lg:self-auto border-t lg:border-t-0 pt-3 lg:pt-0 border-theme w-full lg:w-auto justify-end">
                    {!isArchived ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onResumeSession(session)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                        >
                          <Play size={13} />
                          <span>{zh ? '进入课堂' : 'Resume'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleArchive(session.id)}
                          disabled={isArchiving}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 text-amber-700 dark:text-amber-300 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {isArchiving ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                          <span>{zh ? '一键归档' : 'Archive'}</span>
                        </button>
                      </>
                    ) : (
                      onViewReport && (
                        <button
                          type="button"
                          onClick={() => onViewReport(session)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-theme bg-surface hover:bg-surface-secondary text-primary-theme text-xs font-bold transition-colors cursor-pointer"
                        >
                          <ExternalLink size={13} />
                          <span>{zh ? '查看战报' : 'Report'}</span>
                        </button>
                      )
                    )}

                    <button
                      type="button"
                      onClick={() => setSessionToDelete(session)}
                      className="p-1.5 rounded-xl border border-theme hover:border-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-muted hover:text-rose-600 transition-colors cursor-pointer"
                      title={zh ? '删除此会话' : 'Delete session'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Pagination Footer */}
      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-theme bg-surface-secondary/40 flex items-center justify-between text-xs text-muted shrink-0">
          <div>
            {zh
              ? `第 ${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, total)} 条，共 ${total} 条会话`
              : `Showing ${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, total)} of ${total}`}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 rounded-lg border border-theme bg-surface disabled:opacity-40 hover:bg-surface-secondary transition-colors cursor-pointer disabled:cursor-not-allowed font-medium text-main"
            >
              {zh ? '上一页' : 'Previous'}
            </button>
            <span className="px-2 font-semibold text-main">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 rounded-lg border border-theme bg-surface disabled:opacity-40 hover:bg-surface-secondary transition-colors cursor-pointer disabled:cursor-not-allowed font-medium text-main"
            >
              {zh ? '下一页' : 'Next'}
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ClassroomSessionDeleteModal
        isOpen={Boolean(sessionToDelete)}
        onClose={() => setSessionToDelete(null)}
        onConfirm={confirmDelete}
        sessionTitle={sessionToDelete?.lessonTitle || ''}
        className={sessionToDelete?.className}
        stageLabel={sessionToDelete ? (zh ? '已选会话' : 'Selected') : undefined}
        isDeleting={isDeleting}
        lang={lang}
      />
    </div>
  );
}

export default ClassroomSessionManager;
