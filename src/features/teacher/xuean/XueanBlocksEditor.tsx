/**
 * 学案首页块编辑器（教师端，IKVO15 · P0）。
 * 管理 lesson_activity_blocks（半结构化：learning_goals / key_points / resources / free_html 等）。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  createLessonBlock,
  deleteLessonBlock,
  getLessonBlocks,
  reorderLessonBlocks,
  updateLessonBlock,
} from '../../../services/lessonActivitiesService.js';
import { useOptionalAppData } from '../../../context/AppDataContext.js';
import { CoursewarePicker } from './CoursewarePicker';

type Block = {
  id: string;
  lesson_id: string;
  block_type: string;
  order_index: number;
  content_json: string;
  created_at: number;
  updated_at: number;
};

/** 逐条编辑的数组型首页块（其余类型仍走 JSON / 文本编辑）。 */
const ARRAY_BLOCK_TYPES = new Set([
  'learning_goals',
  'key_points',
  'resources',
  'operation_tips',
  'works_showcase',
  'reflection',
]);

const BLOCK_TYPES: { value: string; label: string; hint: string }[] = [
  { value: 'learning_goals', label: '学习目标', hint: 'JSON 数组，如 ["目标1", "目标2"]' },
  { value: 'key_points', label: '重难点', hint: 'JSON 数组' },
  { value: 'resources', label: '资源准备', hint: 'JSON 数组' },
  { value: 'operation_tips', label: '操作要点', hint: 'JSON 数组' },
  { value: 'works_showcase', label: '作品赏析', hint: 'JSON 数组或对象' },
  { value: 'reflection', label: '反思', hint: 'JSON 数组或对象' },
  { value: 'free_html', label: '自由 HTML', hint: '直接写 HTML 字符串' },
  {
    value: 'interactive_courseware',
    label: '互动课件',
    hint: 'JSON 对象，引用已上传课件：{"coursewareUuid":"..."} 或 {"resourceId":"..."}；可选 title。',
  },
];

interface Props {
  refreshKey?: number; // 活动编排器重排后触发刷新（blocks 是独立 order_index，一般不需要）
}

export function XueanBlocksEditor({ refreshKey }: Props) {
  const appData = useOptionalAppData();
  const lessonId = appData?.selectedLesson ?? '';
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Block | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!lessonId) return;
    const res = await getLessonBlocks(lessonId);
    if (res.ok && res.data) {
      setBlocks(res.data as Block[]);
      setLoadError(null);
    } else {
      setLoadError('首页块加载失败，请稍后重试');
    }
    setLoading(false);
  }, [lessonId]);

  const commitOrder = async (ordered: Block[]) => {
    setBlocks(ordered);
    const res = await reorderLessonBlocks(
      lessonId,
      ordered.map((b) => b.id),
    );
    if (!res.ok) {
      setReorderError('排序保存失败，已恢复原顺序');
      await refresh();
    } else {
      setReorderError(null);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= blocks.length) return;
    const next = blocks.slice();
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    await commitOrder(next);
  };

  const handleDrop = async (targetIndex: number) => {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from == null || from === targetIndex) return;
    const next = blocks.slice();
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);
    await commitOrder(next);
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  // refreshKey 变化时刷新
  useEffect(() => {
    if (refreshKey != null) refresh();
  }, [refreshKey, refresh]);

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此首页块？')) return;
    const res = await deleteLessonBlock(id);
    if (res.ok) await refresh();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-theme bg-surface/85 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-primary-theme">学案首页</span>
          <span className="text-xs text-muted">· {blocks.length} 个块</span>
        </div>
        <button
          type="button"
          onClick={() => setShowNewForm(true)}
          disabled={!lessonId}
          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white hover:opacity-90 disabled:opacity-40"
        >
          + 新增首页块
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <div className="text-center text-muted py-8">加载中…</div>}
        {!lessonId && (
          <div className="text-center text-muted py-16 border-2 border-dashed border-theme rounded-xl">
            请先选择一个课时
          </div>
        )}
        {loadError && (
          <div className="text-center text-rose-600 text-sm py-8">
            {loadError}
            <button type="button" onClick={refresh} className="ml-3 text-xs underline">
              重试
            </button>
          </div>
        )}
        {reorderError && <div className="text-center text-amber-600 text-xs py-1">{reorderError}</div>}
        {!loading && lessonId && !loadError && blocks.length === 0 && (
          <div className="text-center text-muted py-16 border-2 border-dashed border-theme rounded-xl">
            <p className="text-sm">学案首页还没有内容</p>
            <p className="text-xs mt-1">点击上方「+ 新增首页块」开始搭建学案首页</p>
            <p className="text-[11px] mt-3 text-muted/80">
              支持：学习目标 / 重难点 / 资源准备 / 操作要点 / 作品赏析 / 反思 / 自由 HTML / 互动课件
            </p>
          </div>
        )}

        {blocks.map((b, i) => (
          <BlockCard
            key={b.id}
            block={b}
            index={i}
            total={blocks.length}
            dragging={dragIndex === i}
            dragOver={overIndex === i && dragIndex !== i}
            onDragStart={() => setDragIndex(i)}
            onDragOver={() => setOverIndex(i)}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDrop={() => handleDrop(i)}
            onMove={(dir) => handleMove(i, dir)}
            onEdit={() => setEditing(b)}
            onDelete={() => handleDelete(b.id)}
          />
        ))}
      </div>

      {showNewForm && (
        <BlockEditor
          lessonId={lessonId}
          onClose={() => setShowNewForm(false)}
          onSaved={async () => {
            setShowNewForm(false);
            await refresh();
          }}
        />
      )}
      {editing && (
        <BlockEditor
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

function BlockCard({
  block,
  index,
  total,
  dragging,
  dragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onMove,
  onEdit,
  onDelete,
}: {
  block: Block;
  index: number;
  total: number;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const typeLabel = BLOCK_TYPES.find((t) => t.value === block.block_type)?.label ?? block.block_type;
  let preview: unknown;
  try {
    preview = JSON.parse(block.content_json);
  } catch {
    preview = block.content_json;
  }

  let previewText: string;
  if (block.block_type === 'free_html' && typeof preview === 'string') {
    // 自由 HTML：去掉标签，只展示可读文本
    previewText = preview
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } else if (block.block_type === 'interactive_courseware' && preview && typeof preview === 'object') {
    const record = preview as Record<string, unknown>;
    previewText = `${typeof record.title === 'string' && record.title ? record.title : '互动课件'}（${
      record.coursewareUuid ?? record.resourceId ?? '未绑定'
    }）`;
  } else if (typeof preview === 'string') {
    previewText = preview;
  } else if (Array.isArray(preview)) {
    previewText = preview.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('、');
  } else {
    previewText = JSON.stringify(preview) ?? '';
  }
  if (previewText.length > 80) previewText = previewText.slice(0, 80) + '…';

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver();
      }}
      onDragEnd={onDragEnd}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={
        'rounded-xl border bg-surface transition p-3 ' +
        (dragging ? 'opacity-50 border-primary-theme/60 ' : 'border-theme hover:border-primary-theme/30 ') +
        (dragOver ? 'ring-2 ring-primary-theme/40 border-primary-theme/60' : '')
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-0.5 shrink-0">
          <span className="text-muted cursor-grab select-none" aria-hidden="true" title="拖拽排序">
            ⋮⋮
          </span>
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="上移"
            className="w-6 h-6 rounded border border-theme hover:bg-surface-secondary disabled:opacity-30 disabled:cursor-not-allowed text-muted text-xs"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="下移"
            className="w-6 h-6 rounded border border-theme hover:bg-surface-secondary disabled:opacity-30 disabled:cursor-not-allowed text-muted text-xs"
          >
            ↓
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-muted">#{index + 1}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary-theme">{typeLabel}</span>
          </div>
          <p className="mt-1 text-sm text-main/80 truncate" title={previewText}>
            {previewText || '(空)'}
          </p>
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
    </div>
  );
}

function BlockEditor({
  lessonId,
  existing,
  onClose,
  onSaved,
}: {
  lessonId: string;
  existing?: Block;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existingType = existing?.block_type ?? 'learning_goals';
  const existingContent = (() => {
    if (!existing) return '[""]';
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing.content_json);
    } catch {
      return existing.content_json;
    }
    // 数组类型用 JSON 编辑，HTML 类型用纯文本
    if (existing.block_type === 'free_html') return typeof parsed === 'string' ? parsed : existing.content_json;
    return JSON.stringify(parsed, null, 2);
  })();

  const [blockType, setBlockType] = useState(existingType);
  const [content, setContent] = useState(existingContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 互动课件的结构化字段（可视化选择，替代手填 UUID）
  const existingCourseware = (() => {
    if (existing?.block_type !== 'interactive_courseware') return { uuid: '', title: '' };
    try {
      const parsed = JSON.parse(existing.content_json) as Record<string, unknown>;
      return {
        uuid: String(parsed?.coursewareUuid ?? ''),
        title: String(parsed?.title ?? ''),
      };
    } catch {
      return { uuid: '', title: '' };
    }
  })();
  const [coursewareUuid, setCoursewareUuid] = useState(existingCourseware.uuid);
  const [coursewareTitle, setCoursewareTitle] = useState(existingCourseware.title);
  const [advancedJson, setAdvancedJson] = useState(false);

  // 数组型块：逐条编辑（不再要求教师手写 JSON）
  const existingItems = (() => {
    if (!existing || !ARRAY_BLOCK_TYPES.has(existing.block_type)) return [''];
    try {
      const parsed = JSON.parse(existing.content_json) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') && parsed.length > 0) {
        return parsed as string[];
      }
    } catch {
      // 存量内容不是合法数组时，回退到一条空输入
    }
    return [''];
  })();
  const [items, setItems] = useState<string[]>(existingItems);

  const hint = BLOCK_TYPES.find((t) => t.value === blockType)?.hint ?? '';
  const useCoursewarePicker = blockType === 'interactive_courseware' && !advancedJson;
  const useItemEditor = ARRAY_BLOCK_TYPES.has(blockType) && !advancedJson;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let contentJson: string;
    if (useCoursewarePicker) {
      if (!coursewareUuid) {
        setError('请选择互动课件');
        return;
      }
      contentJson = JSON.stringify({
        coursewareUuid,
        ...(coursewareTitle.trim() ? { title: coursewareTitle.trim() } : {}),
      });
    } else if (useItemEditor) {
      const cleaned = items.map((item) => item.trim()).filter(Boolean);
      if (cleaned.length === 0) {
        setError('至少填写一条内容');
        return;
      }
      contentJson = JSON.stringify(cleaned);
    } else if (!content.trim()) {
      setError('内容必填');
      return;
    } else if (blockType === 'free_html') {
      contentJson = JSON.stringify(content);
    } else {
      // 数组类型：尝试解析；解析失败且是字符串 → 自动包裹成数组
      try {
        const parsed = JSON.parse(content);
        if (blockType === 'interactive_courseware') {
          const record = parsed as Record<string, unknown> | null;
          if (
            !record ||
            typeof record !== 'object' ||
            Array.isArray(record) ||
            (!record.coursewareUuid && !record.resourceId)
          ) {
            setError('互动课件需要 {"coursewareUuid":"..."} 或 {"resourceId":"..."}');
            return;
          }
        }
        if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
          contentJson = JSON.stringify(parsed);
        } else {
          setError('内容需要是 JSON 数组或对象');
          return;
        }
      } catch {
        if (blockType === 'interactive_courseware') {
          setError('互动课件内容需要是 JSON 对象');
          return;
        }
        contentJson = JSON.stringify([content]);
      }
    }

    setSaving(true);
    const payload = { blockType, content: contentJson };
    const res = existing ? await updateLessonBlock(existing.id, payload) : await createLessonBlock(lessonId, payload);

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
      aria-label={existing ? '编辑首页块' : '新增首页块'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-surface rounded-2xl border border-theme shadow-xl p-5 space-y-4 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">{existing ? '编辑首页块' : '新增首页块'}</h3>
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
          <label className="block text-xs font-semibold text-muted">块类型</label>
          <select
            value={blockType}
            onChange={(e) => setBlockType(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
          >
            {BLOCK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {(blockType === 'interactive_courseware' || ARRAY_BLOCK_TYPES.has(blockType)) && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">
              {blockType === 'interactive_courseware'
                ? '可直接选择课件，或切换到高级 JSON 手填引用。'
                : '逐条填写内容，或切换到高级 JSON 直接编辑数组。'}
            </span>
            <button
              type="button"
              onClick={() => setAdvancedJson((v) => !v)}
              className="text-[11px] text-primary-theme hover:underline"
            >
              {advancedJson ? '返回可视化编辑' : '高级 JSON'}
            </button>
          </div>
        )}

        <div className="space-y-2">
          {useCoursewarePicker ? (
            <>
              <CoursewarePicker value={coursewareUuid} onChange={(uuid) => setCoursewareUuid(uuid)} />
              <label className="block text-xs font-semibold text-muted">展示标题（可选）</label>
              <input
                type="text"
                value={coursewareTitle}
                onChange={(e) => setCoursewareTitle(e.target.value)}
                placeholder="默认使用课件名称"
                className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
              />
            </>
          ) : useItemEditor ? (
            <>
              <label className="block text-xs font-semibold text-muted">内容条目</label>
              <div className="space-y-2">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted shrink-0 w-5 text-right">{i + 1}.</span>
                    <input
                      type="text"
                      value={item}
                      onChange={(e) =>
                        setItems((prev) => prev.map((value, idx) => (idx === i ? e.target.value : value)))
                      }
                      placeholder="填写一条内容"
                      className="flex-1 px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
                      autoFocus={i === 0}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setItems((prev) => (prev.length === 1 ? [''] : prev.filter((_, idx) => idx !== i)))
                      }
                      className="px-2 py-1 text-xs rounded border border-rose-500/30 hover:bg-rose-500/10 text-rose-600"
                      aria-label="删除此条"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, ''])}
                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-theme hover:bg-surface-secondary text-main"
              >
                + 添加一条
              </button>
            </>
          ) : (
            <>
              <label className="block text-xs font-semibold text-muted">内容</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={blockType === 'free_html' ? 8 : blockType === 'interactive_courseware' ? 4 : 6}
                className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40 font-mono"
                placeholder={
                  blockType === 'free_html'
                    ? '<p>HTML 内容</p>'
                    : blockType === 'interactive_courseware'
                      ? '{"coursewareUuid":"cw_..."}'
                      : '["条目1", "条目2"]'
                }
                autoFocus
              />
              <p className="text-[11px] text-muted/80">{hint}</p>
            </>
          )}
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
