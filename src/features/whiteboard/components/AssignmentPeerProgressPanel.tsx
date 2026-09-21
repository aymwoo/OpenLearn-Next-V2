import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Shuffle, Users } from 'lucide-react';

/**
 * 教师端互评进度面板：分配互评、查看完成情况与异常标记。
 *
 * 数据来自 `GET /api/assignments/:id` 的 `peerProgress`（教师请求才携带，含学生姓名），
 * 分配动作走 `POST /api/assignments/:id/assign-peer-reviews`。
 */

export interface PeerProgress {
  submissions: number;
  tasks: number;
  completed: number;
  pending: number;
  reviewers: { studentId: string; name: string; pending: number; submitted: number }[];
  flags: { type: string; reviewerId?: string; detail: string }[];
}

export interface AssignmentPeerProgressPanelProps {
  assignmentId: string;
  /** 已由父组件加载的数据；缺省时组件自行拉取 */
  progress?: PeerProgress | null;
  onAssigned?: () => void | Promise<void>;
  onToast?: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  lang?: 'zh' | 'en';
}

const FLAG_LABELS: Record<string, { zh: string; en: string }> = {
  peer_review_pending: { zh: '未完成互评', en: 'Pending' },
  all_full_marks: { zh: '全部满分', en: 'All full marks' },
  score_gap: { zh: '分数差异大', en: 'Score gap' },
};

function defaultDueValue(): string {
  const date = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AssignmentPeerProgressPanel({
  assignmentId,
  progress,
  onAssigned,
  onToast,
  lang = 'zh',
}: AssignmentPeerProgressPanelProps) {
  const zh = lang === 'zh';
  const [expanded, setExpanded] = useState(false);
  const [local, setLocal] = useState<PeerProgress | null>(progress || null);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [reviewerCount, setReviewerCount] = useState('2');
  const [dueValue, setDueValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const notify = useCallback(
    (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => {
      if (onToast) {
        onToast(title, message, type);
        return;
      }
      setNotice(message ? `${title}：${message}` : title);
    },
    [onToast],
  );

  const load = useCallback(async () => {
    if (progress) {
      setLocal(progress);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/assignments/${encodeURIComponent(assignmentId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setLocal((data?.peerProgress as PeerProgress) || null);
    } catch (e: any) {
      setError(e?.message || 'load failed');
    } finally {
      setLoading(false);
    }
  }, [assignmentId, progress]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAssign = useCallback(async () => {
    if (assigning) return;
    setAssigning(true);
    setError(null);
    try {
      const parsedCount = Math.max(1, Math.min(10, Math.round(Number(reviewerCount) || 2)));
      const dueAt = dueValue ? new Date(dueValue).getTime() : undefined;
      const res = await fetch(`/api/assignments/${encodeURIComponent(assignmentId)}/assign-peer-reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewerCount: parsedCount,
          dueAt: dueAt && Number.isFinite(dueAt) ? dueAt : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      notify(
        zh ? '互评已分配' : 'Peer reviews assigned',
        zh
          ? `新增 ${data?.created ?? 0} 个互评任务，覆盖 ${data?.submissions ?? 0} 份提交（重复分配不会重复建任务）`
          : '',
        'success',
      );
      setExpanded(true);
      await load();
      await onAssigned?.();
    } catch (e: any) {
      notify(zh ? '分配互评失败' : 'Assign failed', e?.message || '', 'error');
    } finally {
      setAssigning(false);
    }
  }, [assignmentId, assigning, dueValue, load, notify, onAssigned, reviewerCount, zh]);

  const pendingReviewers = (local?.reviewers || []).filter((item) => item.pending > 0);
  const flagCount = local?.flags?.length || 0;

  return (
    <div className="space-y-2 rounded-xl border border-theme bg-surface-secondary p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-main inline-flex items-center gap-1">
          <Users size={11} /> {zh ? '互评进度' : 'Peer review'}
          {local ? (
            <span className="font-normal text-muted">
              {zh
                ? `${local.completed} / ${local.tasks} 已完成`
                : `${local.completed} / ${local.tasks} done`}
            </span>
          ) : null}
          {flagCount > 0 ? (
            <span className="px-1 rounded-full bg-amber-100 text-amber-700 text-[10px]">
              {zh ? `${flagCount} 项待复核` : `${flagCount} flags`}
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="p-1 rounded text-muted hover:text-main hover:bg-surface transition-colors"
            title={zh ? '刷新' : 'Refresh'}
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="px-1.5 py-0.5 rounded text-[11px] text-muted hover:text-main hover:bg-surface transition-colors"
          >
            {expanded ? (zh ? '收起' : 'Hide') : zh ? '展开' : 'Show'}
          </button>
        </div>
      </div>

      {local ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <span className="px-1.5 py-0.5 rounded bg-surface border border-theme">
            {zh ? `提交 ${local.submissions}` : `${local.submissions} subs`}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-surface border border-theme">
            {zh ? `任务 ${local.tasks}` : `${local.tasks} tasks`}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-surface border border-theme">
            {zh ? `待完成 ${local.pending}` : `${local.pending} pending`}
          </span>
        </div>
      ) : (
        <div className="text-[11px] text-muted">{zh ? '暂无互评数据。' : 'No peer review data.'}</div>
      )}

      {local && local.tasks === 0 && (
        <div className="text-[11px] text-muted">
          {zh
            ? '还没有分配互评：点「随机分配互评」，系统会给每份提交随机分配若干同学（双盲、不评自己、负载均衡）。'
            : 'No peer reviews assigned yet.'}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-muted inline-flex items-center gap-1">
          {zh ? '每份提交分配' : 'Reviewers'}
          <input
            type="number"
            min={1}
            max={10}
            value={reviewerCount}
            onChange={(e) => setReviewerCount(e.target.value)}
            className="w-14 px-2 py-1 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
          {zh ? '人' : ''}
        </label>
        <label className="text-[11px] text-muted inline-flex items-center gap-1">
          {zh ? '互评截止' : 'Due'}
          <input
            type="datetime-local"
            value={dueValue}
            placeholder={defaultDueValue()}
            onChange={(e) => setDueValue(e.target.value)}
            className="px-2 py-1 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </label>
        <button
          type="button"
          disabled={assigning}
          onClick={() => void handleAssign()}
          className="px-2 py-1.5 rounded-lg text-xs font-medium border border-theme text-main hover:bg-surface transition-colors inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {assigning ? <Loader2 size={11} className="animate-spin" /> : <Shuffle size={11} />}
          {zh ? '随机分配互评' : 'Assign'}
        </button>
      </div>

      {error && <div className="text-[11px] text-red-600 break-all">{error}</div>}
      {notice && <div className="text-[11px] text-emerald-600 break-all">{notice}</div>}

      {expanded && local && (
        <div className="space-y-2">
          {local.flags.length > 0 ? (
            <div className="space-y-1">
              {local.flags.map((flag, index) => (
                <div
                  key={`${flag.type}-${flag.reviewerId || index}-${index}`}
                  className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
                >
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  <span className="break-all">
                    <span className="font-medium">
                      {zh ? FLAG_LABELS[flag.type]?.zh || flag.type : FLAG_LABELS[flag.type]?.en || flag.type}
                    </span>
                    ：{flag.detail}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-emerald-600 inline-flex items-center gap-1">
              <CheckCircle2 size={11} /> {zh ? '暂未发现异常，互评进度正常。' : 'No anomaly detected.'}
            </div>
          )}

          {local.reviewers.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-main">
                {zh ? `互评人（${pendingReviewers.length} 人还有待评）` : 'Reviewers'}
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {local.reviewers.map((reviewer) => (
                  <div
                    key={reviewer.studentId}
                    className="flex items-center justify-between gap-2 rounded border border-theme bg-surface px-2 py-1 text-[11px]"
                  >
                    <span className="truncate text-main">{reviewer.name}</span>
                    <span className={reviewer.pending > 0 ? 'text-amber-700 shrink-0' : 'text-emerald-600 shrink-0'}>
                      {zh
                        ? `已评 ${reviewer.submitted} · 待评 ${reviewer.pending}`
                        : `${reviewer.submitted} done · ${reviewer.pending} todo`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AssignmentPeerProgressPanel;
