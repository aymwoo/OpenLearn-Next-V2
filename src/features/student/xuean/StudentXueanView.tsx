/**
 * 学生学案页（IKVO15 · P0）。
 * - 顶部学案首页块（半结构化：learning_goals / key_points / resources / free_html 等）
 * - 活动序列卡片（状态指示 + 自报进度）
 */
import { useCallback, useEffect, useState } from 'react';
import { getXuean, postActivityProgress, type ActivitySubmission } from '../../../services/lessonActivitiesService.js';
import { sanitizeRichTextHtml } from '../../../../packages/core/security/html-sanitize';
import { LearningSurfaceHost } from '../../learning-surface/LearningSurfaceHost';

type Block = {
  id: string;
  lesson_id: string;
  block_type: string;
  order_index: number;
  content_json: string;
  surface_id?: string | null;
};

type Activity = {
  id: string;
  lesson_id: string;
  order_index: number;
  type: string;
  title: string;
  required: number;
  visible: number;
  surface_id?: string | null;
};

type Progress = {
  activity_id: string;
  student_id: string;
  status: 'not_started' | 'in_progress' | 'submitted' | 'graded';
  progress_percent: number;
  verified: number;
  score: number | null;
  submission_json?: string | null;
  nudged_at?: number | null;
  nudge_count?: number;
};

type XueanData = {
  lessonId: string;
  blocks: Block[];
  activities: Activity[];
  progressByActivity: Record<string, Progress>;
};

const BLOCK_TYPE_LABELS: Record<string, string> = {
  learning_goals: '学习目标',
  key_points: '重难点',
  resources: '资源准备',
  operation_tips: '操作要点',
  works_showcase: '作品赏析',
  reflection: '反思',
  free_html: '自由内容',
  interactive_courseware: '互动课件',
};

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  reading: '阅读',
  submission: '作品提交',
  quiz: '测验',
  discussion: '讨论',
  courseware: '课件',
  scratch: '编程',
  form: '表单',
  other: '其他',
};

const STATUS_LABELS: Record<Progress['status'], { text: string; cls: string }> = {
  not_started: { text: '未开始', cls: 'bg-muted/10 text-muted border-muted/30' },
  in_progress: { text: '进行中', cls: 'bg-sky-500/10 text-sky-600 border-sky-500/30' },
  submitted: { text: '已提交', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  graded: { text: '已批阅', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
};

interface Props {
  lessonId: string;
  lessonTitle?: string;
  /** Mode Pack 工作区可选：进度写库成功后通知（如 ClassroomMessage xuean:task） */
  onActivityProgressReported?: (info: { activityId: string; status: string }) => void;
}

export function StudentXueanView({ lessonId, lessonTitle, onActivityProgressReported }: Props) {
  const [data, setData] = useState<XueanData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!lessonId) return;
    const res = await getXuean(lessonId);
    if (res.ok && res.data) setData(res.data as XueanData);
    setLoading(false);
  }, [lessonId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) return <div className="text-center text-muted py-16">加载学案中…</div>;
  if (!data)
    return (
      <div className="text-center text-muted py-16">
        加载失败，请刷新重试
        <button
          type="button"
          onClick={refresh}
          className="ml-3 px-3 py-1 text-xs rounded border border-theme hover:bg-surface-secondary"
        >
          重试
        </button>
      </div>
    );

  const completedCount = data.activities.filter((a) => {
    const p = data.progressByActivity[a.id];
    return p && (p.status === 'graded' || (p.verified && p.status === 'submitted'));
  }).length;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 学案头部 */}
      <div className="px-5 py-4 border-b border-theme bg-surface/80 backdrop-blur-sm sticky top-0 z-10">
        <h2 className="text-base sm:text-lg font-black text-main tracking-tight">{lessonTitle ?? data.lessonId}</h2>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted">
          <span>📚 学案式学习</span>
          <span>
            ✅ {completedCount} / {data.activities.length} 活动完成
          </span>
        </div>
      </div>

      <div className="p-5 space-y-6 max-w-3xl mx-auto w-full">
        {/* 学案首页块 */}
        {data.blocks.length > 0 && (
          <section aria-label="学案首页">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted mb-3">学案首页</h3>
            <div className="space-y-3">
              {data.blocks.map((b) => (
                <BlockCard key={b.id} block={b} />
              ))}
            </div>
          </section>
        )}

        {/* 活动序列 */}
        <section aria-label="活动序列">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted mb-3">活动序列</h3>
          {data.activities.length === 0 ? (
            <div className="text-center text-muted py-8 border-2 border-dashed border-theme rounded-xl text-sm">
              教师尚未编排活动
            </div>
          ) : (
            <div className="space-y-3">
              {data.activities.map((a, i) => (
                <ActivityItem
                  key={a.id}
                  index={i}
                  activity={a}
                  progress={data.progressByActivity[a.id]}
                  onProgressUpdated={refresh}
                  onActivityProgressReported={onActivityProgressReported}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function BlockCard({ block }: { block: Block }) {
  let content: unknown;
  try {
    content = JSON.parse(block.content_json);
  } catch {
    content = block.content_json;
  }

  const typeLabel = BLOCK_TYPE_LABELS[block.block_type] ?? block.block_type;

  const renderContent = () => {
    if (block.block_type === 'interactive_courseware' && content && typeof content === 'object') {
      const record = content as Record<string, unknown>;
      // 阶段 5：优先走统一 Surface；未迁移的存量块回退旧 CoursewareHost。
      if (block.surface_id) {
        return (
          <div className="h-[420px] w-full overflow-hidden rounded-lg border border-theme">
            <LearningSurfaceHost
              surfaceId={block.surface_id}
              lessonId={block.lesson_id}
              hostId={block.id}
              title={typeof record.title === 'string' ? record.title : undefined}
              lazy={false}
              className="w-full h-full"
            />
          </div>
        );
      }
    }
    if (typeof content === 'string') {
      return block.block_type === 'free_html' ? (
        <div dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(content) }} />
      ) : (
        <p className="text-sm text-main whitespace-pre-wrap">{content}</p>
      );
    }
    if (Array.isArray(content)) {
      return (
        <ul className="space-y-1 text-sm text-main">
          {content.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted shrink-0">•</span>
              <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
            </li>
          ))}
        </ul>
      );
    }
    if (content && typeof content === 'object') {
      const record = content as Record<string, unknown>;
      const keys = Object.keys(record);
      if (keys.length <= 4 && keys.every((k) => Array.isArray(record[k]))) {
        return (
          <div className="grid gap-3">
            {keys.map((k) => (
              <div key={k}>
                <div className="text-[10px] font-bold uppercase text-muted mb-1">{k}</div>
                <ul className="space-y-1 text-sm text-main">
                  {(record[k] as unknown[]).map((item, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted shrink-0">•</span>
                      <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        );
      }
      return (
        <pre className="text-xs text-main/80 bg-surface-secondary rounded p-2 overflow-x-auto">
          {JSON.stringify(content, null, 2)}
        </pre>
      );
    }
    return null;
  };

  return (
    <div className="rounded-xl border border-theme bg-surface p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-primary-theme mb-2">{typeLabel}</div>
      {renderContent()}
    </div>
  );
}

function ActivityItem({
  index,
  activity,
  progress,
  onProgressUpdated,
  onActivityProgressReported,
}: {
  index: number;
  activity: Activity;
  progress?: Progress;
  onProgressUpdated: () => void;
  onActivityProgressReported?: (info: { activityId: string; status: string }) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const status = progress?.status ?? 'not_started';
  const pct = progress?.progress_percent ?? 0;
  const stLabel = STATUS_LABELS[status];

  const mark = async (newStatus: Progress['status']) => {
    setSaving(true);
    const res = await postActivityProgress(activity.id, { status: newStatus });
    setSaving(false);
    if (res.ok) {
      onProgressUpdated();
      onActivityProgressReported?.({ activityId: activity.id, status: newStatus });
    }
  };

  const activityTypeLabel = ACTIVITY_TYPE_LABELS[activity.type] ?? activity.type;

  // 解析已有提交内容
  let existingSubmission: ActivitySubmission | null = null;
  if (progress?.submission_json) {
    try {
      existingSubmission = JSON.parse(progress.submission_json) as ActivitySubmission;
    } catch {
      existingSubmission = progress.submission_json;
    }
  }

  return (
    <>
      <div className="rounded-xl border border-theme bg-surface p-4 hover:border-primary-theme/30 transition">
        <div className="flex items-start gap-3">
          {/* 序号圆徽 */}
          <div className="w-8 h-8 rounded-full bg-primary-theme/10 text-primary-theme font-black text-sm flex items-center justify-center shrink-0 border border-primary-theme/20">
            {index + 1}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">{activityTypeLabel}</span>
              {activity.required ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600">必做</span>
              ) : null}
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${stLabel.cls}`}>{stLabel.text}</span>
              {progress?.verified && <span className="text-[10px] text-emerald-600">✓ 已验证</span>}
              {progress?.score != null && (
                <span className="text-[10px] text-amber-600 font-bold">得分 {progress.score}</span>
              )}
              {existingSubmission && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  已提交
                </span>
              )}
              {progress?.nudged_at && status !== 'graded' && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 border border-amber-500/30 animate-pulse"
                  title={`教师于 ${new Date(progress.nudged_at).toLocaleString()} 催办${progress.nudge_count ? `（共 ${progress.nudge_count} 次）` : ''}`}
                >
                  ⚠ 教师催办{progress.nudge_count && progress.nudge_count > 1 ? ` ×${progress.nudge_count}` : ''}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm font-semibold text-main">{activity.title}</p>

            {/* 学习面：活动绑定了 Surface 时，由统一宿主渲染内容 */}
            {activity.surface_id ? (
              <div className="mt-2 h-80 rounded-lg overflow-hidden border border-theme/60 bg-surface-secondary/30">
                <LearningSurfaceHost
                  surfaceId={activity.surface_id}
                  lessonId={activity.lesson_id}
                  hostId={activity.id}
                  title={activity.title}
                  className="w-full h-full"
                />
              </div>
            ) : null}

            {/* 已提交内容预览 */}
            {existingSubmission && (
              <div className="mt-2 p-2 rounded-lg bg-surface-secondary/50 border border-theme/60 max-h-24 overflow-y-auto">
                <p className="text-[10px] text-muted font-bold mb-0.5">我的提交</p>
                <p className="text-xs text-main/80 whitespace-pre-wrap break-all">
                  {typeof existingSubmission === 'string'
                    ? existingSubmission
                    : (existingSubmission.content ?? JSON.stringify(existingSubmission))}
                </p>
              </div>
            )}

            {/* 进度条 */}
            <div className="mt-2 h-1.5 rounded-full bg-surface-secondary overflow-hidden">
              <div
                className="h-full bg-primary-theme transition-all"
                style={{ width: `${pct}%` }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-col gap-1 shrink-0">
            {status === 'not_started' && (
              <button
                type="button"
                onClick={() => mark('in_progress')}
                disabled={saving}
                className="px-2 py-1 text-xs rounded bg-sky-500/10 text-sky-600 border border-sky-500/30 hover:bg-sky-500/20"
              >
                开始
              </button>
            )}
            {status === 'in_progress' && (
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                disabled={saving}
                className="px-2 py-1 text-xs rounded bg-amber-500/10 text-amber-600 border border-amber-500/30 hover:bg-amber-500/20"
              >
                提交
              </button>
            )}
            {(status === 'submitted' || status === 'graded') && (
              <div className="flex flex-col gap-1">
                <span className="px-2 py-1 text-xs text-muted text-center">
                  {status === 'graded' ? '已完成' : '等待批阅'}
                </span>
                {status !== 'graded' && (
                  <button
                    type="button"
                    onClick={() => setShowSubmitModal(true)}
                    disabled={saving}
                    className="px-2 py-1 text-[10px] rounded border border-theme hover:bg-surface-secondary text-muted"
                  >
                    重新提交
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showSubmitModal && (
        <SubmissionModal
          activityTitle={activity.title}
          existing={existingSubmission}
          onClose={() => setShowSubmitModal(false)}
          onSaved={async () => {
            setShowSubmitModal(false);
            await onProgressUpdated();
          }}
          submitFn={async (submission, selfEval) => {
            setSaving(true);
            const res = await postActivityProgress(activity.id, { status: 'submitted', submission, selfEval });
            setSaving(false);
            if (res.ok) onActivityProgressReported?.({ activityId: activity.id, status: 'submitted' });
            return res.ok;
          }}
        />
      )}
    </>
  );
}

function SubmissionModal({
  activityTitle,
  existing,
  onClose,
  onSaved,
  submitFn,
}: {
  activityTitle: string;
  existing: ActivitySubmission | null;
  onClose: () => void;
  onSaved: () => void;
  submitFn: (submission: ActivitySubmission, selfEval?: { score: number; comment: string }) => Promise<boolean>;
}) {
  const initialText = existing ? (typeof existing === 'string' ? existing : (existing.content ?? '')) : '';
  const [content, setContent] = useState(initialText);
  const [submissionType, setSubmissionType] = useState<'text' | 'link'>(
    typeof existing === 'object' && existing?.type === 'link' ? 'link' : 'text',
  );
  const [selfScore, setSelfScore] = useState<number | ''>('');
  const [selfComment, setSelfComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      setError('请输入提交内容');
      return;
    }
    setSaving(true);
    setError(null);
    const submission: ActivitySubmission =
      submissionType === 'link' ? { type: 'link', content: content.trim(), url: content.trim() } : content.trim();
    const selfEval =
      selfScore !== '' || selfComment.trim()
        ? { score: typeof selfScore === 'number' ? selfScore : 0, comment: selfComment.trim() }
        : undefined;
    const ok = await submitFn(submission, selfEval);
    setSaving(false);
    if (!ok) {
      setError('提交失败，请重试');
      return;
    }
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={`提交活动：${activityTitle}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-surface rounded-2xl border border-theme shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold">提交活动</h3>
            <p className="text-xs text-muted mt-0.5 truncate max-w-[280px]">{activityTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded hover:bg-surface-secondary text-muted hover:text-main"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-muted">提交类型</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSubmissionType('text')}
              className={`flex-1 px-3 py-2 text-xs rounded-lg border transition ${
                submissionType === 'text'
                  ? 'bg-primary-theme/10 border-primary-theme/40 text-primary-theme font-bold'
                  : 'border-theme hover:bg-surface-secondary text-main'
              }`}
            >
              文本内容
            </button>
            <button
              type="button"
              onClick={() => setSubmissionType('link')}
              className={`flex-1 px-3 py-2 text-xs rounded-lg border transition ${
                submissionType === 'link'
                  ? 'bg-primary-theme/10 border-primary-theme/40 text-primary-theme font-bold'
                  : 'border-theme hover:bg-surface-secondary text-main'
              }`}
            >
              链接
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-muted">
            {submissionType === 'link' ? '链接 URL' : '提交内容'}
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={submissionType === 'link' ? 2 : 6}
            className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40 font-mono"
            placeholder={submissionType === 'link' ? 'https://...' : '输入你的作业内容…'}
            autoFocus
          />
        </div>

        {/* 自评（可选） */}
        <div className="space-y-2 border-t border-theme pt-3">
          <p className="text-xs font-bold text-muted">自评（可选）</p>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="block text-[10px] text-muted">自评分</label>
              <input
                type="number"
                min={0}
                max={100}
                value={selfScore}
                onChange={(e) => setSelfScore(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="0-100"
                className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] text-muted">自评评语</label>
            <textarea
              value={selfComment}
              onChange={(e) => setSelfComment(e.target.value)}
              rows={2}
              placeholder="简要评价自己的完成情况…"
              className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
            />
          </div>
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-theme hover:bg-surface-secondary"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-primary-theme text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '提交中…' : '确认提交'}
          </button>
        </div>
      </form>
    </div>
  );
}
