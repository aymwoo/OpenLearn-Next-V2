/**
 * 教师进度面板（IKVO15 · P0 续）。
 * 聚合：活动 × 学生 的完成状态概览 + 点击展开看明细 + 批阅入口。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getActivityProgressPanel,
  verifyActivityProgress,
  nudgeActivity,
} from '../../../services/lessonActivitiesService.js';
import { useOptionalAppData } from '../../../context/AppDataContext.js';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';

type PanelActivity = {
  id: string;
  lesson_id: string;
  order_index: number;
  type: string;
  title: string;
  students: PanelStudent[];
  summary: { total: number; done: number; pending: number };
};

type PanelStudent = {
  activity_id: string;
  student_id: string;
  status: 'not_started' | 'in_progress' | 'submitted' | 'graded';
  progress_percent: number;
  verified: number;
  score?: number | null;
  graded_at?: number | null;
  last_activity_at?: number | null;
  submission_json?: string | null;
  nudged_at?: number | null;
  nudge_count?: number;
};

type PanelData = {
  lessonId: string;
  totalStudents: number;
  activities: PanelActivity[];
};

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  reading: '阅读',
  submission: '作品',
  quiz: '测验',
  discussion: '讨论',
  courseware: '课件',
  scratch: '编程',
  form: '表单',
  other: '其他',
};

const STATUS_LABELS: Record<PanelStudent['status'], { text: string; cls: string }> = {
  not_started: { text: '未开始', cls: 'bg-muted/10 text-muted border-muted/30' },
  in_progress: { text: '进行中', cls: 'bg-sky-500/10 text-sky-600 border-sky-500/30' },
  submitted: { text: '已提交', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  graded: { text: '已批阅', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
};

function formatSubmission(json: string): string {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === 'string') return parsed.length > 60 ? parsed.slice(0, 60) + '…' : parsed;
    if (parsed && typeof parsed === 'object') {
      const content = parsed.content ?? parsed.url ?? JSON.stringify(parsed);
      return String(content).length > 60 ? String(content).slice(0, 60) + '…' : String(content);
    }
    return JSON.stringify(parsed);
  } catch {
    return json.length > 60 ? json.slice(0, 60) + '…' : json;
  }
}

export function ProgressPanel() {
  const appData = useOptionalAppData();
  const lessonId = appData?.selectedLesson ?? '';
  const students = appData?.students ?? [];
  const studentMap: Record<string, (typeof students)[number]> = Object.fromEntries(students.map((s) => [s.id, s]));

  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [verifying, setVerifying] = useState<{ activityId: string; studentId: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!lessonId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await getActivityProgressPanel(lessonId);
    if (res.ok && res.data) {
      setData(res.data as PanelData);
    } else {
      setError(res.error?.error ?? '加载进度失败');
    }
    setLoading(false);
  }, [lessonId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleExpand = (activityId: string) => {
    setExpanded((prev) => ({ ...prev, [activityId]: !prev[activityId] }));
  };

  const overallRate =
    data && data.activities.length > 0 && data.totalStudents > 0
      ? Math.round(
          (data.activities.reduce((acc, a) => acc + a.summary.done, 0) /
            (data.activities.reduce((acc, a) => acc + a.summary.total, 0) || 1)) *
            100,
        )
      : 0;

  if (loading)
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        加载进度…
      </div>
    );

  if (!lessonId) return <div className="text-center text-muted py-16 text-sm">请先选择一个课时</div>;

  if (error)
    return (
      <div className="text-center py-16 space-y-3">
        <p className="text-rose-600 text-sm">{error}</p>
        <button
          type="button"
          onClick={refresh}
          className="px-3 py-1.5 text-xs rounded-lg border border-theme hover:bg-surface-secondary"
        >
          重试
        </button>
      </div>
    );

  if (!data || data.activities.length === 0)
    return (
      <div className="text-center text-muted py-16 border-2 border-dashed border-theme rounded-xl text-sm">
        <p>还没有编排活动</p>
        <p className="text-xs mt-1">先到「活动编排」添加一些活动吧</p>
      </div>
    );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 顶部概览卡 */}
      <div className="px-4 py-3 border-b border-theme bg-surface/75 backdrop-blur-sm sticky top-0 z-10">
        <div className="grid grid-cols-3 gap-3 text-center">
          <OverviewCell label="活动数" value={data.activities.length} />
          <OverviewCell label="学生数" value={data.totalStudents} />
          <OverviewCell label="整体完成率" value={`${overallRate}%`} accent />
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-surface-secondary overflow-hidden">
          <div
            className="h-full bg-primary-theme transition-all"
            style={{ width: `${overallRate}%` }}
            role="progressbar"
            aria-valuenow={overallRate}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      {/* 活动列表 */}
      <div className="p-3 space-y-3">
        {data.activities.map((a, i) => {
          const doneRate = a.summary.total > 0 ? Math.round((a.summary.done / a.summary.total) * 100) : 0;
          const isOpen = expanded[a.id];
          return (
            <div key={a.id} className="rounded-xl border border-theme bg-surface overflow-hidden">
              {/* 活动摘要行（点击展开） */}
              <button
                type="button"
                onClick={() => toggleExpand(a.id)}
                aria-expanded={isOpen}
                className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-surface-secondary/50 transition"
              >
                <span className="text-xs font-mono text-muted w-4">{i + 1}</span>
                <span className={`shrink-0`}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase text-primary-theme">
                      {ACTIVITY_TYPE_LABELS[a.type] ?? a.type}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-main truncate">{a.title}</p>
                </div>

                <div className="shrink-0 w-36 hidden sm:block">
                  <div className="flex justify-between text-[10px] text-muted mb-0.5">
                    <span>
                      {a.summary.done}/{a.summary.total}
                    </span>
                    <span>{doneRate}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-secondary overflow-hidden">
                    <div
                      className="h-full bg-primary-theme transition-all"
                      style={{ width: `${doneRate}%` }}
                      aria-hidden
                    />
                  </div>
                </div>
              </button>

              {/* 展开：学生明细表格 */}
              {isOpen && (
                <StudentTable
                  activity={a}
                  studentMap={studentMap}
                  onVerify={(studentId) => setVerifying({ activityId: a.id, studentId })}
                  onNudge={async (studentId) => {
                    await nudgeActivity(a.id, studentId);
                    await refresh();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {verifying && (
        <VerifyModal
          activityId={verifying.activityId}
          studentId={verifying.studentId}
          studentName={studentMap[verifying.studentId]?.name ?? verifying.studentId}
          activityTitle={data.activities.find((a) => a.id === verifying.activityId)?.title ?? verifying.activityId}
          existing={data.activities
            .find((a) => a.id === verifying.activityId)
            ?.students.find((s) => s.student_id === verifying.studentId)}
          onClose={() => setVerifying(null)}
          onSaved={() => {
            setVerifying(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function OverviewCell({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-theme px-3 py-2 ${accent ? 'bg-primary-theme/10 border-primary-theme/30' : 'bg-surface-secondary/30'}`}
    >
      <div className={`text-xs font-black ${accent ? 'text-primary-theme' : 'text-muted'}`}>{label}</div>
      <div className={`text-lg font-black mt-0.5 ${accent ? 'text-primary-theme' : 'text-main'}`}>{value}</div>
    </div>
  );
}

function StudentTable({
  activity,
  studentMap,
  onVerify,
  onNudge,
}: {
  activity: PanelActivity;
  studentMap: Record<string, { name?: string | null; username?: string | null }>;
  onVerify: (studentId: string) => void;
  onNudge: (studentId: string) => void;
}) {
  // 无学生数据时提示
  if (activity.students.length === 0) {
    return (
      <div className="px-4 py-4 text-xs text-muted border-t border-theme">
        未找到关联班级的学生（检查排课 / assignments 是否关联了 class_id）
      </div>
    );
  }

  // responsive-table 指南：thead 用 scope 区分 col/row，tbody 的 th 用 scope="row"
  return (
    <div className="overflow-x-auto border-t border-theme">
      <table className="w-full text-sm" role="grid">
        <thead className="text-[11px] uppercase tracking-wider text-muted bg-surface-secondary/30">
          <tr>
            <th scope="col" className="text-left px-4 py-2 font-bold">
              学生
            </th>
            <th scope="col" className="text-left px-3 py-2 font-bold">
              状态
            </th>
            <th scope="col" className="text-left px-3 py-2 font-bold">
              进度
            </th>
            <th scope="col" className="text-left px-3 py-2 font-bold">
              提交内容
            </th>
            <th scope="col" className="text-left px-3 py-2 font-bold">
              得分
            </th>
            <th scope="col" className="text-right px-4 py-2 font-bold">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          {activity.students.map((s) => {
            const st = STATUS_LABELS[s.status];
            const name = studentMap[s.student_id]?.name ?? studentMap[s.student_id]?.username ?? s.student_id;
            return (
              <tr key={s.student_id} className="border-t border-theme/60 hover:bg-surface-secondary/30">
                <th scope="row" className="text-left px-4 py-2 font-medium text-main">
                  {name}
                </th>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${st.cls}`}>{st.text}</span>
                  {s.verified ? <span className="ml-1 text-[10px] text-emerald-600">✓</span> : null}
                </td>
                <td className="px-3 py-2 text-muted text-xs">{s.progress_percent}%</td>
                <td className="px-3 py-2 text-xs text-main/70 max-w-[200px]">
                  {s.submission_json ? (
                    <span className="block truncate" title={formatSubmission(s.submission_json)}>
                      {formatSubmission(s.submission_json)}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs font-bold">
                  {s.score != null ? (
                    <span className="text-amber-600">{s.score}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right space-x-1.5">
                  {s.status !== 'graded' && (
                    <button
                      type="button"
                      onClick={() => onNudge(s.student_id)}
                      className="px-2.5 py-1 text-xs rounded border border-amber-500/30 hover:bg-amber-500/10 text-amber-600 font-bold"
                      title={s.nudge_count ? `已催办 ${s.nudge_count} 次` : '催办'}
                    >
                      催办{s.nudge_count ? ` ${s.nudge_count}` : ''}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onVerify(s.student_id)}
                    className="px-2.5 py-1 text-xs rounded border border-primary-theme/30 hover:bg-primary-theme/10 text-primary-theme font-bold"
                  >
                    批阅
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VerifyModal({
  activityId,
  studentId,
  studentName,
  activityTitle,
  existing,
  onClose,
  onSaved,
}: {
  activityId: string;
  studentId: string;
  studentName: string;
  activityTitle: string;
  existing?: PanelStudent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(existing?.status ?? 'submitted');
  const [score, setScore] = useState<string>(existing?.score != null ? String(existing.score) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const scoreNum = score.trim() !== '' ? Number(score) : undefined;
    const res = await verifyActivityProgress(activityId, {
      studentId,
      status,
      score: Number.isFinite(scoreNum) ? scoreNum : undefined,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error?.error ?? '批阅失败');
      return;
    }
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={`批阅 ${studentName} 的 ${activityTitle}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-surface rounded-2xl border border-theme shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold">批阅</h3>
            <p className="text-xs text-muted mt-0.5">
              {studentName} · {activityTitle}
            </p>
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
          <label className="block text-xs font-semibold text-muted">批阅后状态</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as PanelStudent['status'])}
            className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main"
          >
            <option value="submitted">已提交</option>
            <option value="graded">已批阅</option>
            <option value="in_progress">打回重做</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-muted">分数（可选）</label>
          <input
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            placeholder="0–100"
            className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main"
          />
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
            {saving ? '保存中…' : '确认批阅'}
          </button>
        </div>
      </form>
    </div>
  );
}
