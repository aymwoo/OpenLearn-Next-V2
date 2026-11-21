/**
 * 学案活动编排器（教师端，IKVO15 · P0）。
 * - 列出 lesson_activities（按 order_index）
 * - 新增 / 编辑 / 删除
 * - 上移 / 下移 重排（pointer 拖拽是后续增强，先提供可访问的键盘按钮）
 * - 状态标签（required / visible / peer_review）
 */
import { useCallback, useEffect, useState } from 'react';
import {
  createLessonActivity,
  deleteLessonActivity,
  getLessonActivities,
  reorderLessonActivities,
  updateLessonActivity,
} from '../../../services/lessonActivitiesService.js';
import { useOptionalAppData } from '../../../context/AppDataContext.js';

type Activity = {
  id: string;
  lesson_id: string;
  order_index: number;
  type: string;
  title: string;
  config_json: string | null;
  required: number;
  visible: number;
  peer_review: number;
  group_mode: string;
  submission_type: string | null;
  rubric_json: string | null;
  release_at: number | null;
  due_at: number | null;
  created_at: number;
  updated_at: number;
  surface_id?: string | null;
};

type SurfaceRenderer = { id: string; label: string; sourceKinds: string[] };

const ACTIVITY_TYPES = [
  { value: 'reading', label: '阅读任务' },
  { value: 'submission', label: '作品提交' },
  { value: 'quiz', label: '测验' },
  { value: 'discussion', label: '讨论' },
  { value: 'courseware', label: '网页课件' },
  { value: 'scratch', label: '图形化编程' },
  { value: 'form', label: '表单' },
  { value: 'other', label: '其他' },
];

export function XueanActivitiesPanel() {
  const appData = useOptionalAppData();
  const lessonId = appData?.selectedLesson ?? '';
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const refresh = useCallback(async () => {
    if (!lessonId) return;
    const res = await getLessonActivities(lessonId);
    if (res.ok && res.data) setActivities(res.data as Activity[]);
    setLoading(false);
  }, [lessonId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleMove = async (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= activities.length) return;
    const ids = activities.map((a) => a.id);
    [ids[index], ids[newIndex]] = [ids[newIndex], ids[index]];
    const res = await reorderLessonActivities(lessonId, ids);
    if (res.ok) await refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此活动？关联的进度记录会一起清理。')) return;
    const res = await deleteLessonActivity(id);
    if (res.ok) await refresh();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-theme bg-surface/85 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-primary-theme">学案活动编排</span>
          <span className="text-xs text-muted">· {activities.length} 项活动</span>
        </div>
        <button
          type="button"
          onClick={() => setShowNewForm(true)}
          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white hover:opacity-90 transition"
        >
          + 新增活动
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <div className="text-center text-muted py-8">加载中…</div>}
        {!loading && activities.length === 0 && (
          <div className="text-center text-muted py-16 border-2 border-dashed border-theme rounded-xl">
            <p className="text-sm">还没有活动</p>
            <p className="text-xs mt-1">点击上方「+ 新增活动」开始编排学案</p>
          </div>
        )}

        {activities.map((act, i) => (
          <ActivityCard
            key={act.id}
            activity={act}
            index={i}
            total={activities.length}
            onMove={(dir) => handleMove(i, dir)}
            onEdit={() => setEditing(act)}
            onDelete={() => handleDelete(act.id)}
          />
        ))}
      </div>

      {showNewForm && (
        <ActivityEditor
          lessonId={lessonId}
          onClose={() => setShowNewForm(false)}
          onSaved={async () => {
            setShowNewForm(false);
            await refresh();
          }}
        />
      )}
      {editing && (
        <ActivityEditor
          lessonId={lessonId}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function ActivityCard({
  activity,
  index,
  total,
  onMove,
  onEdit,
  onDelete,
}: {
  activity: Activity;
  index: number;
  total: number;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const typeLabel = ACTIVITY_TYPES.find((t) => t.value === activity.type)?.label ?? activity.type;
  return (
    <div className="flex items-start gap-2 p-3 rounded-xl border border-theme bg-surface hover:border-primary-theme/40 transition">
      {/* 重排按钮（可访问，键盘友好；拖拽手柄后续增强） */}
      <div className="flex flex-col gap-0.5 pt-0.5 shrink-0">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label="上移"
          className="w-6 h-6 rounded border border-theme hover:bg-surface-secondary disabled:opacity-30 disabled:cursor-not-allowed text-muted"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label="下移"
          className="w-6 h-6 rounded border border-theme hover:bg-surface-secondary disabled:opacity-30 disabled:cursor-not-allowed text-muted"
        >
          ↓
        </button>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-muted">#{index + 1}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-primary-theme/10 text-primary-theme border border-primary-theme/20">
            {typeLabel}
          </span>
          {activity.required ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600">必做</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/10 text-muted">可选</span>
          )}
          {!activity.visible && <span className="text-[10px] text-amber-600">已隐藏</span>}
          {activity.peer_review ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600">互评</span>
          ) : null}
        </div>
        <p className="mt-1 text-sm font-semibold text-main truncate">{activity.title}</p>
      </div>

      <div className="flex gap-1 shrink-0">
        <button
          type="button"
          onClick={onEdit}
          className="px-2 py-1 text-xs rounded border border-theme hover:bg-surface-secondary text-main"
        >
          编辑
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="px-2 py-1 text-xs rounded border border-rose-500/30 hover:bg-rose-500/10 text-rose-600"
        >
          删除
        </button>
      </div>
    </div>
  );
}

function ActivityEditor({
  lessonId,
  existing,
  onClose,
  onSaved,
}: {
  lessonId: string;
  existing?: Activity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    type: existing?.type ?? 'reading',
    title: existing?.title ?? '',
    submissionType: existing?.submission_type ?? '',
    required: existing ? Boolean(existing.required) : true,
    visible: existing ? Boolean(existing.visible) : true,
    peerReview: existing ? Boolean(existing.peer_review) : false,
    releaseAt: existing?.release_at ? new Date(existing.release_at).toISOString().slice(0, 16) : '',
    dueAt: existing?.due_at ? new Date(existing.due_at).toISOString().slice(0, 16) : '',
    rubricJson: existing?.rubric_json ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 学习面绑定（可选）：阶段 3 起活动可挂一个 Surface 渲染内容。
  const [renderers, setRenderers] = useState<SurfaceRenderer[]>([]);
  const [surfaceRendererId, setSurfaceRendererId] = useState('');
  const [surfaceSourceKind, setSurfaceSourceKind] = useState('courseware');
  const [surfaceSourceId, setSurfaceSourceId] = useState('');
  const [surfaceMarkdown, setSurfaceMarkdown] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/learning-surface-renderers')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: SurfaceRenderer[] } | null) => {
        if (cancelled || !body?.data) return;
        const list = body.data.filter((item) => item.sourceKinds.length > 0);
        setRenderers(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!existing?.surface_id) return;
    let cancelled = false;
    fetch(`/api/learning-surfaces/${encodeURIComponent(existing.surface_id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((row: { content_ref_json?: string } | null) => {
        if (cancelled || !row?.content_ref_json) return;
        try {
          const ref = JSON.parse(row.content_ref_json) as {
            rendererId?: string;
            source?: { kind?: string; id?: string };
            config?: { markdown?: string };
          };
          if (ref.rendererId) setSurfaceRendererId(ref.rendererId);
          if (ref.source?.kind) setSurfaceSourceKind(ref.source.kind);
          if (ref.source?.id) setSurfaceSourceId(ref.source.id);
          if (ref.config?.markdown) setSurfaceMarkdown(ref.config.markdown);
        } catch {
          // 内容引用损坏时保留空白表单，由教师重新绑定
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [existing?.surface_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('标题必填');
      return;
    }
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      type: form.type,
      title: form.title.trim(),
      required: form.required,
      visible: form.visible,
      peerReview: form.peerReview,
      releaseAt: form.releaseAt ? new Date(form.releaseAt).getTime() : null,
      dueAt: form.dueAt ? new Date(form.dueAt).getTime() : null,
      rubricJson: form.rubricJson.trim() || null,
    };
    if (form.submissionType) payload.submissionType = form.submissionType;

    // 有资源才绑定；已有 Surface 但清空了输入则解绑。
    const isInlineSource = surfaceSourceKind === 'inline';
    if (surfaceRendererId && (surfaceSourceId.trim() || (isInlineSource && surfaceMarkdown.trim()))) {
      payload.surface = {
        rendererId: surfaceRendererId,
        source: { kind: surfaceSourceKind, ...(isInlineSource ? {} : { id: surfaceSourceId.trim() }) },
        config: {
          title: form.title.trim(),
          ...(isInlineSource && surfaceMarkdown.trim() ? { markdown: surfaceMarkdown } : {}),
        },
      };
    } else if (existing?.surface_id) {
      payload.surface = null;
    }

    const res = existing
      ? await updateLessonActivity(existing.id, payload)
      : await createLessonActivity(lessonId, payload);

    setSaving(false);
    if (!res.ok) {
      setError(res.error?.error ?? '保存失败');
      return;
    }
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={existing ? '编辑活动' : '新增活动'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-surface rounded-2xl border border-theme shadow-xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">{existing ? '编辑活动' : '新增活动'}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-main w-7 h-7 rounded hover:bg-surface-secondary"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-muted">活动类型</label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-muted">标题</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="例如：阅读第 3 章"
            className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-muted">提交物类型（可选）</label>
          <input
            type="text"
            value={form.submissionType}
            onChange={(e) => setForm({ ...form, submissionType: e.target.value })}
            placeholder="file / text / link 等"
            className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.required}
              onChange={(e) => setForm({ ...form, required: e.target.checked })}
            />
            必做
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.visible}
              onChange={(e) => setForm({ ...form, visible: e.target.checked })}
            />
            对学生可见
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.peerReview}
              onChange={(e) => setForm({ ...form, peerReview: e.target.checked })}
            />
            互评（P1 激活）
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-muted">发布时间（可选）</label>
            <input
              type="datetime-local"
              value={form.releaseAt}
              onChange={(e) => setForm({ ...form, releaseAt: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
            />
            <p className="text-[10px] text-muted">留空 = 立即对学生可见</p>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-muted">截止时间（可选）</label>
            <input
              type="datetime-local"
              value={form.dueAt}
              onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
            />
            <p className="text-[10px] text-muted">留空 = 无截止</p>
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-muted">评价量规（可选，JSON）</label>
          <textarea
            value={form.rubricJson}
            onChange={(e) => setForm({ ...form, rubricJson: e.target.value })}
            rows={4}
            placeholder='例如：[{"criterion":"内容完整","weight":0.5,"maxScore":10},{"criterion":"表达清晰","weight":0.5,"maxScore":10}]'
            className="w-full px-3 py-2 text-xs rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40 font-mono"
          />
          <p className="text-[10px] text-muted">批阅时参考此量规打分。留空则使用自由分。</p>
        </div>

        <div className="space-y-2 rounded-lg border border-theme p-3">
          <p className="text-xs font-bold text-main">学习面内容（可选）</p>
          <p className="text-[10px] text-muted">绑定后学生端由统一宿主渲染；留空表示不绑定。</p>
          <select
            value={surfaceRendererId}
            onChange={(e) => setSurfaceRendererId(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
          >
            <option value="">不绑定</option>
            {renderers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {surfaceRendererId ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={surfaceSourceKind}
                  onChange={(e) => setSurfaceSourceKind(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
                >
                  {(renderers.find((item) => item.id === surfaceRendererId)?.sourceKinds ?? ['courseware']).map(
                    (kind) => (
                      <option key={kind} value={kind}>
                        {kind === 'courseware' ? '互动课件' : kind === 'resource' ? '资源库' : '内联 Markdown'}
                      </option>
                    ),
                  )}
                </select>
                {surfaceSourceKind === 'inline' ? (
                  <div className="flex items-center text-[10px] text-muted">在下方填写 Markdown</div>
                ) : (
                  <input
                    type="text"
                    value={surfaceSourceId}
                    onChange={(e) => setSurfaceSourceId(e.target.value)}
                    placeholder={surfaceSourceKind === 'courseware' ? '课件 UUID' : '资源 ID'}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main font-mono focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
                  />
                )}
              </div>
              {surfaceSourceKind === 'inline' ? (
                <textarea
                  value={surfaceMarkdown}
                  onChange={(e) => setSurfaceMarkdown(e.target.value)}
                  rows={4}
                  placeholder={'# 第一页\n---\n## 第二页'}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-theme bg-surface text-main font-mono focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
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
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}
