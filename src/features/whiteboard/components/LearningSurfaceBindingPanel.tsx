/**
 * 白板 `learning_surface` 元素的内容绑定面板（阶段 3）。
 *
 * 元素 data 只存 `surfaceId`（设计文档 §4.2），内容引用保存在
 * `learning_surfaces.content_ref_json`。本面板负责：
 *   - 拉取渲染器目录（内置 + 已激活插件）；
 *   - 首次绑定时创建 Surface（kind=whiteboard_element，owner_id=元素 id）；
 *   - 已绑定时更新内容引用，或解绑（软删 Surface，attempt 保留）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface RendererDescriptor {
  id: string;
  label: string;
  execution: 'inline' | 'sandbox';
  sourceKinds: string[];
}

interface LearningContentRef {
  rendererId: string;
  source: { kind: string; id?: string };
  config?: { title?: string; markdown?: string };
}

export interface LearningSurfaceBindingPanelProps {
  lessonId: string;
  elementId: string;
  surfaceId?: string;
  title?: string;
  onBound: (patch: { surfaceId: string; title?: string }) => unknown;
  onUnbound: () => unknown;
}

const SOURCE_KIND_LABELS: Record<string, string> = {
  courseware: '互动课件',
  resource: '资源库',
  inline: '内联 HTML',
};

export function LearningSurfaceBindingPanel({
  lessonId,
  elementId,
  surfaceId,
  title,
  onBound,
  onUnbound,
}: LearningSurfaceBindingPanelProps) {
  const [renderers, setRenderers] = useState<RendererDescriptor[]>([]);
  const [rendererId, setRendererId] = useState('');
  const [sourceKind, setSourceKind] = useState('courseware');
  const [sourceId, setSourceId] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [draftTitle, setDraftTitle] = useState(title ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/learning-surface-renderers')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: RendererDescriptor[] } | null) => {
        if (cancelled || !body?.data) return;
        const list = body.data.filter((item) => item.sourceKinds.length > 0);
        setRenderers(list);
        setRendererId((prev) => prev || list[0]?.id || '');
      })
      .catch(() => {
        if (!cancelled) setError('渲染器目录加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 已绑定的 Surface：回填当前内容引用。
  useEffect(() => {
    if (!surfaceId) return;
    let cancelled = false;
    fetch(`/api/learning-surfaces/${encodeURIComponent(surfaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((row: { content_ref_json?: string } | null) => {
        if (cancelled || !row?.content_ref_json) return;
        try {
          const ref = JSON.parse(row.content_ref_json) as LearningContentRef;
          setRendererId(ref.rendererId);
          setSourceKind(ref.source.kind);
          setSourceId(ref.source.id ?? '');
          setMarkdown(ref.config?.markdown ?? '');
          setDraftTitle(ref.config?.title ?? '');
        } catch {
          // 内容引用损坏时保留空白表单，由教师重新绑定
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [surfaceId]);

  const currentRenderer = renderers.find((item) => item.id === rendererId);
  const availableKinds = currentRenderer?.sourceKinds ?? ['courseware'];
  const isInline = sourceKind === 'inline';

  const handleRendererChange = useCallback(
    (nextId: string) => {
      setRendererId(nextId);
      const next = renderers.find((item) => item.id === nextId);
      const kinds = next?.sourceKinds ?? [];
      if (kinds.length > 0 && !kinds.includes(sourceKind)) setSourceKind(kinds[0]);
    },
    [renderers, sourceKind],
  );

  const handleSave = async () => {
    setError(null);
    if (!rendererId) {
      setError('请选择渲染器');
      return;
    }
    if (!isInline && !sourceId.trim()) {
      setError('请选择内容资源');
      return;
    }
    if (isInline && !markdown.trim()) {
      setError('请填写 Markdown 内容');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/learning-surfaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          kind: 'whiteboard_element',
          ownerId: elementId,
          contentRef: {
            rendererId,
            source: { kind: sourceKind, ...(isInline ? {} : { id: sourceId.trim() }) },
            ...(draftTitle.trim() || (isInline && markdown.trim())
              ? {
                  config: {
                    ...(draftTitle.trim() ? { title: draftTitle.trim() } : {}),
                    ...(isInline && markdown.trim() ? { markdown } : {}),
                  },
                }
              : {}),
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || typeof body.id !== 'string') {
        setError(body.error ?? '绑定失败');
        return;
      }
      await onBound({ surfaceId: body.id, ...(draftTitle.trim() ? { title: draftTitle.trim() } : {}) });
    } catch {
      setError('绑定失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const handleUnbind = async () => {
    if (!surfaceId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/learning-surfaces/${encodeURIComponent(surfaceId)}`, { method: 'DELETE' });
      if (!res.ok) {
        setError('解绑失败');
        return;
      }
      setSourceId('');
      await onUnbound();
    } catch {
      setError('解绑失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
      <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5 flex items-center justify-between">
        <span>学习面内容绑定</span>
        <span className="text-[10px] bg-indigo-500/10 text-indigo-600 px-1.5 py-0.5 rounded-full font-bold">
          {surfaceId ? '已绑定' : '未绑定'}
        </span>
      </h4>

      <div>
        <label className="block text-xs text-muted font-semibold mb-1">渲染器</label>
        <select
          value={rendererId}
          onChange={(e) => handleRendererChange(e.target.value)}
          className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
        >
          {renderers.length === 0 && <option value="">暂无可用渲染器</option>}
          {renderers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-muted font-semibold mb-1">内容来源</label>
        <select
          value={sourceKind}
          onChange={(e) => setSourceKind(e.target.value)}
          className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
        >
          {availableKinds.map((kind) => (
            <option key={kind} value={kind}>
              {SOURCE_KIND_LABELS[kind] ?? kind}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-muted font-semibold mb-1">
          {isInline ? 'Markdown 内容（--- 分页）' : sourceKind === 'courseware' ? '课件 UUID' : '资源 ID'}
        </label>
        {isInline ? (
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            rows={6}
            className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main resize-y"
            placeholder={'# 第一页\n---\n## 第二页'}
          />
        ) : (
          <input
            type="text"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
            placeholder={sourceKind === 'courseware' ? 'courseware uuid' : 'resource id'}
          />
        )}
      </div>

      <div>
        <label className="block text-xs text-muted font-semibold mb-1">显示标题</label>
        <input
          type="text"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
          placeholder="可选"
        />
      </div>

      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="flex-1 py-1.5 rounded-lg bg-primary-theme text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : null}
          {surfaceId ? '更新绑定' : '绑定内容'}
        </button>
        {surfaceId ? (
          <button
            type="button"
            onClick={handleUnbind}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg border border-rose-500/30 text-rose-600 text-xs font-bold hover:bg-rose-500/10 disabled:opacity-50"
          >
            解绑
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default LearningSurfaceBindingPanel;
