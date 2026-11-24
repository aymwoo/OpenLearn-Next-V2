import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Loader2, RefreshCw } from 'lucide-react';
import { useAppStore, appStore } from '../../../store/appStore';
import { AssignmentSubmitDialog } from '../../whiteboard/components/AssignmentSubmitDialog';
import { StudentAssignmentEvalPanel } from '../../../components/StudentAssignmentEvalPanel';
import type { SurfaceRendererProps } from '../types';

interface AssignmentDetail {
  assignment?: {
    id?: string;
    title?: string;
    description?: string;
    due_at?: number | null;
    status?: string;
    allow_late?: number;
  };
  stats?: { submissionCount?: number; gradedCount?: number; pendingPeerReviews?: number };
  submission?: { version?: number; updated_at?: number } | null;
  grade?: { calculated_final_score?: number | null; status?: string } | null;
}

function formatTime(ts: number | null | undefined): string {
  if (!ts) return '未设置';
  return new Date(ts).toLocaleString('zh-CN');
}

/**
 * 内置 assignment_submission 渲染器（阶段 4）。
 *
 * - `source.kind='assignment'`：作业定义。学生看要求 / 我的提交 / 成绩，提交复用
 *   AssignmentSubmitDialog 的完整链路；教师看统计概览。
 * - `source.kind='activity'`：课时级随堂提交，直接复用 StudentAssignmentEvalPanel。
 *
 * attempt 由作业域桥接维护（attemptMode='bridge'），渲染器不创建 attempt。
 */
export function AssignmentSubmissionRenderer({ contentRef, lessonId, preview }: SurfaceRendererProps) {
  const session = useAppStore((s) => s.session);
  const lang = useAppStore((s) => s.lang);
  const isStaff = preview || session?.role === 'teacher';
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);

  const scope = contentRef.source.kind;
  const sourceId = contentRef.source.id ?? '';

  const load = useCallback(async () => {
    if (scope !== 'assignment' || !sourceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/learning-surface-assignments/${encodeURIComponent(sourceId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail((await res.json()) as AssignmentDetail);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '作业加载失败');
    } finally {
      setLoading(false);
    }
  }, [scope, sourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (scope === 'activity') {
    const studentId = session?.studentId || (session?.role === 'student' ? session.userId : null);
    if (!studentId) {
      return <SurfaceNotice title="随堂提交" message="请使用学生账号提交，教师可在进度面板查看。" />;
    }
    return (
      <StudentAssignmentEvalPanel
        lessonId={sourceId || lessonId}
        studentId={studentId}
        lang={lang}
        addToast={(title, message, type) =>
          appStore.getState().addToast({ id: Math.random().toString(16).slice(2), title, message, type })
        }
      />
    );
  }

  const assignment = detail?.assignment;
  const title = contentRef.config?.title || assignment?.title || '作业';

  if (loading && !detail) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full h-full flex items-center justify-center gap-2 text-xs text-gray-400 bg-slate-50 rounded-xl"
      >
        <Loader2 size={14} className="animate-spin" />
        作业加载中…
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto bg-slate-50 rounded-xl p-4">
      <div className="max-w-xl mx-auto space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardList size={16} className="text-rose-500 shrink-0" />
            <h3 className="text-sm font-bold text-main truncate">{title}</h3>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="p-1.5 rounded-lg border border-theme text-muted hover:bg-white"
            aria-label="刷新作业"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-rose-600">
            {error}
          </p>
        ) : null}

        {assignment?.description ? (
          <p className="text-xs text-main/80 whitespace-pre-wrap leading-relaxed">{assignment.description}</p>
        ) : (
          <p className="text-xs text-muted">暂无作业说明。</p>
        )}

        <dl className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg border border-theme bg-white px-2 py-1.5">
            <dt className="text-muted">截止时间</dt>
            <dd className="font-semibold text-main">{formatTime(assignment?.due_at)}</dd>
          </div>
          <div className="rounded-lg border border-theme bg-white px-2 py-1.5">
            <dt className="text-muted">{isStaff ? '提交 / 已评分' : '我的版本'}</dt>
            <dd className="font-semibold text-main">
              {isStaff
                ? `${detail?.stats?.submissionCount ?? 0} / ${detail?.stats?.gradedCount ?? 0}`
                : detail?.submission?.version
                  ? `v${detail.submission.version}`
                  : '尚未提交'}
            </dd>
          </div>
        </dl>

        {!isStaff && detail?.grade?.calculated_final_score != null ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            最终成绩：<span className="font-bold">{detail.grade.calculated_final_score}</span>
            {detail.grade.status === 'confirmed' ? '（已确认）' : '（待确认）'}
          </div>
        ) : null}

        {!isStaff && assignment?.id ? (
          <button
            type="button"
            onClick={() => setShowSubmit(true)}
            className="w-full py-2 rounded-lg bg-primary-theme text-white text-xs font-bold hover:opacity-90"
          >
            {detail?.submission ? '查看 / 重新提交' : '提交作业'}
          </button>
        ) : null}

        {isStaff && detail?.stats ? (
          <p className="text-[11px] text-muted">
            待互评 {detail.stats.pendingPeerReviews ?? 0} 份。提交详情与评分请到作业中心处理。
          </p>
        ) : null}
      </div>

      {showSubmit && assignment?.id ? (
        <AssignmentSubmitDialog
          assignmentId={assignment.id}
          onClose={() => {
            setShowSubmit(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function SurfaceNotice({ title, message }: { title: string; message: string }) {
  return (
    <div
      role="status"
      className="w-full h-full flex flex-col items-center justify-center gap-1.5 p-6 text-center bg-slate-50 rounded-xl"
    >
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      <p className="text-xs text-gray-400">{message}</p>
    </div>
  );
}

export default AssignmentSubmissionRenderer;
