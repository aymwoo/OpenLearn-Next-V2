import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Link2, Plus, RefreshCw, Unlink } from 'lucide-react';

/**
 * 教师端：把白板「课堂作业任务」对象绑定到作业中心的真实作业实体。
 *
 * 白板对象本身只是投影片段，作业数据一律以 `plugin_assignments` 为真源，
 * 因此这里通过 HTTP 端点读写（教师身份由会话决定）：
 *   GET  /api/assignments?lessonId=…   列出本课时的作业
 *   GET  /api/assignments/:id          读取绑定作业的详情
 *   POST /api/assignments              按当前标题/描述新建作业并绑定
 *
 * 绑定结果写回白板元素的 payload（assignmentId），学生端据此打开真正的提交弹窗。
 */

export interface AssignmentBindingFieldProps {
  lessonId: string;
  classId?: string | null;
  elementId?: string;
  /** 当前白板元素 payload 里的 assignmentId（可能为空） */
  value?: string | null;
  /** 用白板元素当前的标题 / 描述作为新建作业的默认值 */
  draftTitle?: string;
  draftDescription?: string;
  disabled?: boolean;
  onChange: (assignmentId: string | null, assignment?: any) => void;
  onToast?: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  lang?: 'zh' | 'en';
}

function formatDue(value?: number | null): string {
  if (!value) return '';
  const ts = value < 1e12 ? value * 1000 : value;
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

export function AssignmentBindingField({
  lessonId,
  classId,
  elementId,
  value,
  draftTitle,
  draftDescription,
  disabled,
  onChange,
  onToast,
  lang = 'zh',
}: AssignmentBindingFieldProps) {
  const zh = lang === 'zh';
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<any[]>([]);
  const [bound, setBound] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** 白板编辑面板没有 toast 宿主，提示必须就地渲染，否则教师看不到创建成功 / 失败 */
  const [notice, setNotice] = useState<{ text: string; type: 'info' | 'success' | 'warning' | 'error' } | null>(null);

  const notify = useCallback(
    (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => {
      if (onToast) {
        onToast(title, message, type);
        return;
      }
      setNotice({ text: message ? `${title}：${message}` : title, type });
    },
    [onToast],
  );

  const loadOptions = useCallback(
    async (silent = false) => {
      if (!lessonId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/assignments?lessonId=${encodeURIComponent(lessonId)}`);
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        setOptions(Array.isArray(data?.assignments) ? data.assignments : []);
      } catch (e: any) {
        setError(e?.message || 'load failed');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [lessonId],
  );

  const loadBound = useCallback(async () => {
    if (!value) {
      setBound(null);
      return;
    }
    try {
      const res = await fetch(`/api/assignments/${encodeURIComponent(value)}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success !== false) setBound(data.assignment || null);
    } catch {
      /* 详情加载失败不阻塞编辑，列表里通常已能看到标题 */
    }
  }, [value]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void loadBound();
  }, [loadBound]);

  const handleCreate = useCallback(async () => {
    if (creating || !lessonId) return;
    setCreating(true);
    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle?.trim() || (zh ? '课堂作业' : 'Class assignment'),
          description: draftDescription?.trim() || '',
          lessonId,
          classId: classId || undefined,
          elementId: elementId || undefined,
          status: 'published',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const created = data?.assignment || data?.result?.assignment;
      const newId = created?.id || data?.assignmentId || data?.result?.assignmentId || data?.id;
      if (!newId) {
        throw new Error(zh ? '服务端未返回作业 ID' : 'no assignment id returned');
      }
      setBound(created || { id: newId, title: draftTitle, status: 'published' });
      await loadOptions(true);
      onChange(String(newId), created);
      notify(zh ? '已创建并绑定作业' : 'Assignment created', zh ? '学生端可以开始提交了' : '', 'success');
    } catch (e: any) {
      notify(zh ? '创建作业失败' : 'Create failed', e?.message || '', 'error');
    } finally {
      setCreating(false);
    }
  }, [classId, creating, draftDescription, draftTitle, elementId, lessonId, loadOptions, notify, onChange, zh]);

  const handleSelect = useCallback(
    (assignmentId: string) => {
      if (!assignmentId) {
        onChange(null);
        setBound(null);
        return;
      }
      const picked = options.find((o) => String(o.id) === assignmentId);
      setBound(picked || null);
      onChange(assignmentId, picked);
    },
    [onChange, options],
  );

  const boundTitle = bound?.title || options.find((o) => String(o.id) === value)?.title;

  return (
    <div className="space-y-2 rounded-xl border border-theme bg-surface-secondary p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-main inline-flex items-center gap-1">
          <Link2 size={11} /> {zh ? '绑定作业中心' : 'Assignment binding'}
        </span>
        <button
          type="button"
          onClick={() => void loadOptions(true)}
          disabled={loading}
          className="p-1 rounded text-muted hover:text-main hover:bg-surface transition-colors"
          title={zh ? '刷新' : 'Refresh'}
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        </button>
      </div>

      {value && boundTitle ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5">
          <CheckCircle2 size={12} className="mt-0.5 text-emerald-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-main truncate">{boundTitle}</div>
            <div className="text-[11px] text-muted truncate">
              {[bound?.status, bound?.due_at ? `${zh ? '截止' : 'due'} ${formatDue(bound.due_at)}` : '']
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleSelect('')}
            className="p-1 rounded text-muted hover:text-red-500 hover:bg-surface transition-colors shrink-0"
            title={zh ? '解除绑定' : 'Unbind'}
          >
            <Unlink size={11} />
          </button>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
          <AlertCircle size={12} className="mt-0.5 text-amber-600 shrink-0" />
          <span className="text-[11px] text-amber-800">
            {zh
              ? '尚未绑定作业：学生端只能看到提示、无法提交。请选择已有作业或直接新建。'
              : 'Not bound yet — students cannot submit.'}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <select
          value={value || ''}
          disabled={disabled}
          onChange={(e) => handleSelect(e.target.value)}
          className="flex-1 min-w-0 px-2 py-1.5 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-orange-400"
        >
          <option value="">{zh ? '— 选择本课时的作业 —' : '— select assignment —'}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title || option.id}
              {option.status ? ` (${option.status})` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled || creating || !lessonId}
          onClick={() => void handleCreate()}
          className="px-2 py-1.5 rounded-lg text-xs font-medium border border-theme text-main hover:bg-surface transition-colors inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          {zh ? '新建' : 'New'}
        </button>
      </div>

      {error && <div className="text-[11px] text-red-600 break-all">{error}</div>}
      {notice && (
        <div
          className={`text-[11px] break-all ${
            notice.type === 'success' ? 'text-emerald-600' : notice.type === 'error' ? 'text-red-600' : 'text-amber-700'
          }`}
        >
          {notice.text}
        </div>
      )}
      {options.length === 0 && !loading && !error && (
        <div className="text-[11px] text-muted">{zh ? '本课时还没有作业，点「新建」即可。' : 'No assignment yet.'}</div>
      )}
    </div>
  );
}

export default AssignmentBindingField;
