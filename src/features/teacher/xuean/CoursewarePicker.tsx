/**
 * 互动课件选择器（教师端）。
 * - 列出 /api/courseware 已有课件，支持搜索与刷新
 * - 支持上传 .html/.htm/.zip；ZIP 无唯一入口页时让教师选择入口后 confirm
 * - 对外只暴露课件 UUID，调用方自行决定存到 content_json / Surface source
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export type CoursewareRow = {
  id: string;
  uuid: string;
  name: string;
  type: string;
  entry: string | null;
  created_at?: number;
};

interface Props {
  /** 已选中的课件 UUID */
  value: string;
  /** 选中课件时回调；未选择时 row 为 undefined */
  onChange: (uuid: string, row?: CoursewareRow) => void;
  /** 选择框占位文案 */
  placeholder?: string;
  /** 是否展示上传入口 */
  allowUpload?: boolean;
}

type UploadResult = {
  success?: boolean;
  id?: string;
  uuid?: string;
  name?: string;
  entry?: string;
  need_select_entry?: boolean;
  candidates?: string[];
  error?: string;
};

function normalizeList(body: unknown): CoursewareRow[] {
  if (Array.isArray(body)) return body as CoursewareRow[];
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data as CoursewareRow[];
    if (record.data && typeof record.data === 'object' && Array.isArray((record.data as any).rows)) {
      return (record.data as any).rows as CoursewareRow[];
    }
    if (Array.isArray(record.rows)) return record.rows as CoursewareRow[];
  }
  return [];
}

export function CoursewarePicker({ value, onChange, placeholder = '请选择互动课件', allowUpload = true }: Props) {
  const [rows, setRows] = useState<CoursewareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingEntry, setPendingEntry] = useState<{
    uuid: string;
    name: string;
    candidates: string[];
    entry: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/courseware');
      const body = res.ok ? await res.json() : null;
      setRows(normalizeList(body));
      if (!res.ok) setError('课件列表加载失败');
    } catch {
      setError('课件列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(key));
  }, [rows, keyword]);

  const selectRow = (uuid: string) => {
    const row = rows.find((item) => item.uuid === uuid);
    onChange(uuid, row);
  };

  const handleFile = async (file: File) => {
    setError(null);
    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
    if (!['.html', '.htm', '.zip'].includes(ext)) {
      setError('仅支持 .html / .htm / .zip 课件');
      return;
    }
    setUploading(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
      const name = file.name.replace(/\.[^.]+$/, '');
      const res = await fetch('/api/courseware/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filename: file.name, base64Data }),
      });
      const body = (await res.json().catch(() => ({}))) as UploadResult;
      if (!res.ok || !body.success) {
        setError(body.error ?? '上传失败');
        return;
      }
      if (body.need_select_entry) {
        const candidates = body.candidates ?? [];
        setPendingEntry({
          uuid: String(body.uuid),
          name: String(body.name ?? name),
          candidates,
          entry: candidates[0] ?? '',
        });
        return;
      }
      await refresh();
      if (body.uuid)
        onChange(body.uuid, {
          id: String(body.id ?? ''),
          uuid: String(body.uuid),
          name: String(body.name ?? name),
          type: ext === '.zip' ? 'folder' : 'html',
          entry: body.entry ?? null,
        });
    } catch (err) {
      setError((err as Error).message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const confirmEntry = async () => {
    if (!pendingEntry || !pendingEntry.entry) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch('/api/courseware/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: pendingEntry.uuid, name: pendingEntry.name, entry: pendingEntry.entry }),
      });
      const body = (await res.json().catch(() => ({}))) as UploadResult;
      if (!res.ok || !body.success) {
        setError(body.error ?? '确认入口失败');
        return;
      }
      const confirmedUuid = String(body.uuid ?? pendingEntry.uuid);
      setPendingEntry(null);
      await refresh();
      onChange(confirmedUuid, {
        id: String(body.id ?? ''),
        uuid: confirmedUuid,
        name: String(body.name ?? pendingEntry.name),
        type: 'folder',
        entry: body.entry ?? pendingEntry.entry,
      });
    } catch (err) {
      setError((err as Error).message || '确认入口失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-theme p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-main">互动课件</p>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="text-[10px] text-muted hover:text-main disabled:opacity-40"
        >
          {loading ? '加载中…' : '刷新列表'}
        </button>
      </div>

      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索课件名称"
        className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
      />

      <select
        value={value}
        onChange={(e) => selectRow(e.target.value)}
        className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
      >
        <option value="">{placeholder}</option>
        {filtered.map((row) => (
          <option key={row.uuid} value={row.uuid}>
            {row.name}（{row.type === 'folder' ? 'ZIP 包' : 'HTML'}）
          </option>
        ))}
      </select>

      {!loading && rows.length === 0 && (
        <p className="text-[10px] text-muted">还没有课件，可上传 HTML 或 ZIP 交互式课件。</p>
      )}

      {allowUpload && (
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm,.zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-theme hover:bg-surface-secondary disabled:opacity-40 text-main"
          >
            {uploading ? '上传中…' : '上传课件'}
          </button>
          <span className="text-[10px] text-muted">支持 .html / .htm / .zip</span>
        </div>
      )}

      {pendingEntry && (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
          <p className="text-[11px] text-amber-700">ZIP 中有多个入口页，请选择要展示的页面：</p>
          <select
            value={pendingEntry.entry}
            onChange={(e) => setPendingEntry({ ...pendingEntry, entry: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
          >
            {pendingEntry.candidates.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingEntry(null)}
              className="px-3 py-1.5 text-xs rounded-lg border border-theme hover:bg-surface-secondary"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmEntry}
              disabled={uploading || !pendingEntry.entry}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white hover:opacity-90 disabled:opacity-50"
            >
              确认入口
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
