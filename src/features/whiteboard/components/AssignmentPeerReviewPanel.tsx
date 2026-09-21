import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Loader2, RefreshCw, Users } from 'lucide-react';

/**
 * 学生端互评面板。
 *
 * 数据来自 `GET /api/assignments/:id` 的 `peerReviewTasks`（服务端已做双盲处理：
 * 只给被评作业内容，不给作者身份），提交走 `POST /api/assignments/:id/peer-review`
 * （reviewerId 由服务端会话决定，前端无法冒充他人）。
 */

export interface PeerReviewFile {
  id: string;
  original_name: string;
  size: number;
  mime?: string | null;
}

export interface PeerReviewTaskItem {
  taskId: string;
  submissionId?: string;
  status: string;
  anonymous: boolean;
  dueAt: number | null;
  createdAt: number;
  stale: boolean;
  review: { score: number; comment: string; submittedAt: number | null } | null;
  submission: {
    version: number;
    textContent: string;
    linkUrl: string;
    submittedAt: number;
    isLate: boolean;
    files: PeerReviewFile[];
  } | null;
}

export interface AssignmentPeerReviewPanelProps {
  assignmentId: string;
  tasks: PeerReviewTaskItem[];
  onSubmitted?: () => void | Promise<void>;
  onToast?: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  lang?: 'zh' | 'en';
}

/** 互评量规：四个维度按权重加和（借鉴通用技术作品评价的常规维度） */
const RUBRIC = [
  { key: 'content', zh: '内容完整', en: 'Completeness', weight: 30 },
  { key: 'technical', zh: '技术实现', en: 'Technical', weight: 30 },
  { key: 'expression', zh: '表达规范', en: 'Presentation', weight: 20 },
  { key: 'innovation', zh: '创新亮点', en: 'Originality', weight: 20 },
] as const;

const LEVELS = [
  { key: 'low', zh: '未达标', en: 'Below', factor: 0.4 },
  { key: 'basic', zh: '基本达标', en: 'Basic', factor: 0.7 },
  { key: 'good', zh: '良好', en: 'Good', factor: 0.85 },
  { key: 'excellent', zh: '优秀', en: 'Excellent', factor: 1 },
] as const;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTime(value?: number | null): string {
  if (!value) return '—';
  const ts = value < 1e12 ? value * 1000 : value;
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

function peerLabel(index: number, anonymous: boolean, zh: boolean): string {
  const letter = String.fromCharCode(65 + (index % 26));
  if (!zh) return `${anonymous ? 'Anonymous' : 'Peer'} ${letter}`;
  return `${anonymous ? '匿名同学' : '待评同学'} ${letter}`;
}

export function AssignmentPeerReviewPanel({
  assignmentId,
  tasks,
  onSubmitted,
  onToast,
  lang = 'zh',
}: AssignmentPeerReviewPanelProps) {
  const zh = lang === 'zh';
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [manualScore, setManualScore] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeIndex = Math.max(
    0,
    tasks.findIndex((t) => t.taskId === activeTaskId),
  );
  const activeTask: PeerReviewTaskItem | undefined = tasks[activeIndex];

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

  // 切换任务或服务端刷新后，用已有互评回填表单
  useEffect(() => {
    const task = tasks[activeIndex];
    if (!task) return;
    setManualScore(task.review ? String(task.review.score) : '');
    setComment(task.review?.comment || '');
    setLevels({});
    setError(null);
    setNotice(null);
  }, [activeIndex, tasks]);

  const rubricTotal = useMemo(() => {
    const picked = RUBRIC.filter((criterion) => levels[criterion.key]);
    if (picked.length === 0) return null;
    // 未选的维度按「基本达标」计，避免部分打分导致总分虚低
    const total = RUBRIC.reduce((acc, criterion) => {
      const level = LEVELS.find((l) => l.key === levels[criterion.key]);
      return acc + criterion.weight * (level?.factor ?? LEVELS[1].factor);
    }, 0);
    return Math.round(total);
  }, [levels]);

  const resolvedScore = manualScore.trim() === '' ? rubricTotal : Math.round(Number(manualScore));
  const deadlinePassed = Boolean(
    activeTask?.dueAt !== null && activeTask?.dueAt !== undefined && Date.now() > Number(activeTask.dueAt),
  );
  const completed = tasks.filter((task) => task.review).length;

  const pickLevel = (criterionKey: string, levelKey: string) => {
    setLevels((prev) => {
      const next = { ...prev };
      if (next[criterionKey] === levelKey) delete next[criterionKey];
      else next[criterionKey] = levelKey;
      return next;
    });
    setManualScore('');
  };

  const handleSubmit = useCallback(async () => {
    if (submitting || !activeTask || deadlinePassed) return;
    const score = resolvedScore;
    if (score === null || !Number.isFinite(score) || score < 0 || score > 100) {
      setError(zh ? '请给出 0-100 的互评分数' : 'Score must be between 0 and 100');
      return;
    }
    if (!activeTask.submissionId) {
      setError(zh ? '该互评任务缺少提交物信息，请刷新后重试' : 'Missing submission for this task');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/assignments/${encodeURIComponent(assignmentId)}/peer-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: activeTask.submissionId,
          score,
          comment: comment.trim(),
          taskId: activeTask.taskId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      notify(
        activeTask.review ? (zh ? '互评已更新' : 'Review updated') : zh ? '互评已提交' : 'Review submitted',
        zh ? `已给 ${peerLabel(activeIndex, activeTask.anonymous, zh)} 打 ${score} 分` : '',
        'success',
      );
      await onSubmitted?.();
    } catch (e: any) {
      setError(e?.message || (zh ? '提交失败' : 'submit failed'));
    } finally {
      setSubmitting(false);
    }
  }, [activeIndex, activeTask, assignmentId, comment, deadlinePassed, notify, onSubmitted, resolvedScore, submitting, zh]);

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-theme bg-surface-secondary p-4 text-xs text-muted inline-flex items-center gap-2">
        <Users size={13} />
        {zh ? '老师还没有给你分配互评任务。' : 'No peer review task assigned yet.'}
      </div>
    );
  }

  const peerSubmission = activeTask?.submission;

  return (
    <div data-testid="peer-review-panel" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-main inline-flex items-center gap-1.5">
          <Users size={13} /> {zh ? '互评任务' : 'Peer review'}
          <span className="font-normal text-muted">
            {zh ? `已完成 ${completed} / ${tasks.length}` : `${completed} / ${tasks.length} done`}
          </span>
        </div>
        {activeTask?.dueAt ? (
          <span className={`text-[11px] ${deadlinePassed ? 'text-red-600' : 'text-muted'}`}>
            {zh ? '互评截止' : 'Due'} {formatTime(activeTask.dueAt)}
            {deadlinePassed ? (zh ? '（已截止）' : ' (closed)') : ''}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[9rem_1fr] gap-3">
        <div className="space-y-1">
          {tasks.map((task, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={task.taskId}
                type="button"
                onClick={() => setActiveTaskId(task.taskId)}
                className={`w-full flex items-center justify-between gap-1 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
                  active ? 'border-orange-300 bg-orange-50 text-main' : 'border-theme bg-surface text-muted hover:bg-surface-secondary'
                }`}
              >
                <span className="truncate">{peerLabel(index, task.anonymous, zh)}</span>
                {task.review ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 shrink-0">
                    <CheckCircle2 size={11} /> {task.review.score}
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-600 shrink-0">{zh ? '待评' : 'todo'}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="rounded-xl border border-theme bg-surface p-3 space-y-3">
          {activeTask?.stale && (
            <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {zh ? '该作者在你评价后又更新了提交，建议复核后再提交一次。' : 'The author resubmitted after your review.'}
            </div>
          )}

          {peerSubmission ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <span className="px-1.5 py-0.5 rounded bg-surface-secondary border border-theme">
                  {zh ? `第 ${peerSubmission.version} 版` : `v${peerSubmission.version}`}
                </span>
                <span>{formatTime(peerSubmission.submittedAt)}</span>
                {peerSubmission.isLate && <span className="text-amber-600">{zh ? '迟交' : 'late'}</span>}
              </div>

              {peerSubmission.textContent ? (
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-theme bg-surface-secondary p-2 text-xs text-main">
                  {peerSubmission.textContent}
                </pre>
              ) : (
                <div className="text-[11px] text-muted">{zh ? '该同学没有留下文本作答。' : 'No text answer.'}</div>
              )}

              {peerSubmission.linkUrl ? (
                <a
                  href={peerSubmission.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-orange-600 hover:underline break-all"
                >
                  <ExternalLink size={11} /> {peerSubmission.linkUrl}
                </a>
              ) : null}

              {peerSubmission.files.length > 0 && (
                <div className="space-y-1">
                  {peerSubmission.files.map((file) => (
                    <a
                      key={file.id}
                      href={`/api/assignments/${encodeURIComponent(assignmentId)}/files/${encodeURIComponent(file.id)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 rounded-lg border border-theme bg-surface-secondary px-2 py-1.5 text-xs text-main hover:border-orange-300"
                    >
                      <FileText size={12} className="shrink-0" />
                      <span className="truncate">{file.original_name}</span>
                      <span className="text-[11px] text-muted shrink-0">{formatBytes(file.size)}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-muted">
              {zh ? '该同学还没有提交，无法互评。' : 'This peer has not submitted yet.'}
            </div>
          )}

          {/* 量规：四个维度四档，加权得到建议总分 */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-main">{zh ? '评价量规' : 'Rubric'}</div>
            {RUBRIC.map((criterion) => (
              <div key={criterion.key} className="flex flex-wrap items-center gap-1.5">
                <span className="w-20 shrink-0 text-[11px] text-muted">
                  {zh ? criterion.zh : criterion.en}
                  <span className="ml-1 text-[10px]">({criterion.weight})</span>
                </span>
                {LEVELS.map((level) => {
                  const active = levels[criterion.key] === level.key;
                  return (
                    <button
                      key={level.key}
                      type="button"
                      disabled={deadlinePassed}
                      onClick={() => pickLevel(criterion.key, level.key)}
                      className={`px-1.5 py-0.5 rounded border text-[11px] transition-colors disabled:opacity-50 ${
                        active ? 'border-orange-300 bg-orange-50 text-main' : 'border-theme text-muted hover:bg-surface-secondary'
                      }`}
                    >
                      {zh ? level.zh : level.en}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-muted inline-flex items-center gap-1">
              {zh ? '互评总分' : 'Score'}
              <input
                type="number"
                min={0}
                max={100}
                value={manualScore}
                disabled={deadlinePassed}
                placeholder={rubricTotal === null ? '' : String(rubricTotal)}
                onChange={(e) => {
                  setManualScore(e.target.value);
                  setLevels({});
                }}
                className="w-20 px-2 py-1 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
            </label>
            {rubricTotal !== null && manualScore.trim() === '' && (
              <span className="text-[11px] text-muted">
                {zh ? `量规建议 ${rubricTotal} 分` : `Rubric suggests ${rubricTotal}`}
              </span>
            )}
          </div>

          <textarea
            value={comment}
            disabled={deadlinePassed}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder={zh ? '写点具体建议：哪里做得好、哪里可以改进…' : 'Leave specific feedback…'}
            className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-orange-400 resize-y"
          />

          {error && <div className="text-[11px] text-red-600 break-all">{error}</div>}
          {notice && <div className="text-[11px] text-emerald-600 break-all">{notice}</div>}

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted">
              {activeTask?.review
                ? zh
                  ? `已评 ${activeTask.review.score} 分 · ${formatTime(activeTask.review.submittedAt)}`
                  : `Reviewed ${activeTask.review.score}`
                : zh
                  ? '同学之间双盲互评，作者看不到是谁评的'
                  : 'Double-blind review'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={submitting || deadlinePassed}
                onClick={() => {
                  setManualScore(activeTask?.review ? String(activeTask.review.score) : '');
                  setComment(activeTask?.review?.comment || '');
                  setLevels({});
                  setError(null);
                }}
                className="px-2 py-1.5 rounded-lg text-xs border border-theme text-muted hover:bg-surface-secondary inline-flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw size={11} /> {zh ? '重填' : 'Reset'}
              </button>
              <button
                type="button"
                disabled={submitting || deadlinePassed}
                onClick={() => void handleSubmit()}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-500 text-white hover:bg-orange-600 inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
                {deadlinePassed
                  ? zh
                    ? '互评已截止'
                    : 'Closed'
                  : activeTask?.review
                    ? zh
                      ? '更新互评'
                      : 'Update'
                    : zh
                      ? '提交互评'
                      : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AssignmentPeerReviewPanel;
