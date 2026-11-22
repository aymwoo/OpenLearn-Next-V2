/**
 * 课堂内 Surface 学习分析面板（阶段 7.3）。
 *
 * 挂在「学生提交数据」面板顶部，可折叠；展开后按当前环节 / 本课展示各 Surface
 * 的已交、完成率、均分与未交名单。数据来自
 * `GET /api/lessons/:lessonId/learning-surface-summary`，展开时 20 秒轮询，收起即停。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Gauge, RefreshCw, Users } from 'lucide-react';

interface SurfaceSummaryStudent {
  studentId: string;
  name: string | null;
}

interface SurfaceAttemptSummary {
  surfaceId: string;
  rendererId: string;
  kind: string;
  ownerId: string;
  title: string;
  segmentId: string | null;
  rosterCount: number;
  startedCount: number;
  submittedCount: number;
  gradedCount: number;
  avgCompletion: number;
  avgScorePercent: number | null;
  avgScore: number | null;
  maxScore: number | null;
  pendingStudents: SurfaceSummaryStudent[];
}

interface LessonSurfaceSummary {
  lessonId: string;
  classId: string | null;
  rosterCount: number;
  generatedAt: number;
  surfaces: SurfaceAttemptSummary[];
  totals: {
    surfaceCount: number;
    submittedCount: number;
    gradedCount: number;
    avgCompletion: number;
    avgScorePercent: number | null;
  };
}

export interface SurfaceLiveSummaryPanelProps {
  lessonId: string | null;
  classId: string | null;
  activeSegmentId?: string | null;
  lang: 'zh' | 'en';
}

function percent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function scoreText(item: SurfaceAttemptSummary): string {
  if (item.avgScorePercent == null) return '—';
  const raw = item.avgScore != null ? `${Math.round(item.avgScore * 10) / 10}` : null;
  return raw ? `${Math.round(item.avgScorePercent)}% (${raw})` : `${Math.round(item.avgScorePercent)}%`;
}

export function SurfaceLiveSummaryPanel({
  lessonId,
  classId,
  activeSegmentId = null,
  lang,
}: SurfaceLiveSummaryPanelProps) {
  const zh = lang === 'zh';
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState<'segment' | 'lesson'>(activeSegmentId ? 'segment' : 'lesson');
  const [data, setData] = useState<LessonSurfaceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!lessonId) return;
    setLoading(true);
    setError(null);
    try {
      const query = classId ? `?classId=${encodeURIComponent(classId)}` : '';
      const res = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/learning-surface-summary${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as LessonSurfaceSummary);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : zh ? '加载失败' : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [lessonId, classId, zh]);

  useEffect(() => {
    if (!expanded) return;
    void load();
  }, [expanded, load]);

  useEffect(() => {
    if (!expanded || !lessonId) return;
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [expanded, lessonId, load]);

  useEffect(() => {
    if (!expanded || !activeSegmentId) return;
    setScope('segment');
    void load();
  }, [activeSegmentId, expanded, load]);

  const visible = useMemo(() => {
    if (!data) return [];
    if (scope === 'segment' && activeSegmentId) {
      return data.surfaces.filter((item) => item.segmentId === activeSegmentId);
    }
    return data.surfaces;
  }, [data, scope, activeSegmentId]);

  const pendingCount = visible.reduce((sum, item) => sum + item.pendingStudents.length, 0);

  return (
    <section
      className="shrink-0 rounded-xl border border-theme bg-surface-secondary/40 mb-3"
      aria-label={zh ? 'Surface 完成概览' : 'Surface completion overview'}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left cursor-pointer"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Gauge size={13} className="text-primary-theme shrink-0" />
          <span className="text-xs font-bold text-main truncate">
            {zh ? 'Surface 完成概览' : 'Surface completion overview'}
          </span>
          {data ? (
            <span className="text-[11px] text-muted truncate">
              {zh
                ? `${data.totals.surfaceCount} 个 · 已交 ${data.totals.submittedCount}`
                : `${data.totals.surfaceCount} surfaces · ${data.totals.submittedCount} submitted`}
            </span>
          ) : null}
        </span>
        {expanded ? (
          <ChevronUp size={14} className="text-muted shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-muted shrink-0" />
        )}
      </button>

      {expanded ? (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex p-0.5 bg-surface border border-theme rounded-lg text-[11px] font-semibold">
              {(
                [
                  { id: 'segment', label: zh ? '本环节' : 'This segment' },
                  { id: 'lesson', label: zh ? '本课' : 'This lesson' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setScope(item.id)}
                  aria-pressed={scope === item.id}
                  className={`px-2 py-1 rounded-md cursor-pointer ${
                    scope === item.id ? 'bg-surface-secondary text-main' : 'text-muted hover:text-main'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || !lessonId}
              className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-main disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              {zh ? '刷新' : 'Refresh'}
            </button>
          </div>

          {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}

          {!lessonId ? (
            <p className="text-[11px] text-muted">{zh ? '请先选择课节。' : 'Select a lesson first.'}</p>
          ) : visible.length === 0 ? (
            <p className="text-[11px] text-muted">
              {scope === 'segment'
                ? zh
                  ? '本环节暂无 Surface，可切换到「本课」。'
                  : 'No surfaces in this segment. Try "This lesson".'
                : zh
                  ? '本课暂无 Surface。'
                  : 'No surfaces in this lesson.'}
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-52 overflow-y-auto scrollbar-thin">
              {visible.map((item) => (
                <li key={item.surfaceId} className="rounded-lg border border-theme bg-surface px-2 py-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-semibold text-main truncate" title={item.ownerId}>
                      {item.title}
                    </span>
                    <span className="text-[10px] text-muted shrink-0">{item.rendererId}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                    <span className="inline-flex items-center gap-0.5">
                      <Users size={10} />
                      {item.submittedCount}/{item.rosterCount || item.startedCount}
                    </span>
                    <span>
                      {zh ? '完成' : 'Completion'} {percent(item.avgCompletion)}
                    </span>
                    <span>
                      {zh ? '均分' : 'Avg'} {scoreText(item)}
                    </span>
                    {item.pendingStudents.length > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        {zh ? '未交' : 'Pending'} {item.pendingStudents.length}
                        <span className="sr-only">
                          {item.pendingStudents.map((student) => student.name || student.studentId).join('、')}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  {item.pendingStudents.length > 0 ? (
                    <p className="mt-0.5 text-[10px] text-muted truncate">
                      {item.pendingStudents.map((student) => student.name || student.studentId).join('、')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {data && visible.length > 0 ? (
            <p className="text-[10px] text-muted">
              {zh
                ? `本课名单 ${data.rosterCount} 人 · 未交 ${pendingCount} 项 · 更新于 ${new Date(
                    data.generatedAt,
                  ).toLocaleTimeString()}`
                : `Roster ${data.rosterCount} · ${pendingCount} pending · updated ${new Date(
                    data.generatedAt,
                  ).toLocaleTimeString()}`}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default SurfaceLiveSummaryPanel;
