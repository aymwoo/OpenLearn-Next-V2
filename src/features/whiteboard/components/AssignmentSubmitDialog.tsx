import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Clock,
  FileText,
  Link2,
  Loader2,
  Paperclip,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

/**
 * 学生端「提交作业」弹窗 —— 课程编辑器里「课堂作业任务」对象的真实落地入口。
 *
 * 数据链路（与作业中心 Assignment Hub 一致）：
 *   GET    /api/assignments/:id                    读取作业要求、我的提交版本与成绩
 *   GET    /api/assignments/:id/files              我的附件（未随提交归档的才可重新提交）
 *   POST   /api/assignments/:id/files              原始二进制体上传（X-File-Name 需 URL 编码）
 *   DELETE /api/assignments/:id/files/:fileId      删除未归档附件
 *   POST   /api/assignments/:id/submit             以 fileIds + 文本 + 链接提交不可变版本
 *
 * 归属由服务端按会话确定：普通学生一律写到自己名下，教师代交需显式指定学生。
 */

export interface AssignmentSubmitDialogProps {
  assignmentId: string;
  onClose: () => void;
  onToast?: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  lang?: 'zh' | 'en';
}

/** 与服务端 ALLOWED_ASSIGNMENT_EXT 保持一致（accept 只是引导，服务端仍会复核） */
const ACCEPT_EXT =
  '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.rtf,.odt,.odp,.ods,' +
  '.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.heic,.zip,' +
  '.py,.js,.mjs,.cjs,.ts,.tsx,.jsx,.java,.c,.h,.cpp,.cs,.go,.rs,.rb,.php,.sql,.json,.xml,.html,.css,.ino';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';

interface QueuedFile {
  key: string;
  name: string;
  size: number;
  status: UploadStatus;
  progress: number;
  error?: string;
  fileId?: string;
}

interface RemoteFile {
  id: string;
  original_name: string;
  size: number;
  uploaded_at: number;
  version_id?: string | null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTime(value?: number | null): string {
  if (!value) return '—';
  const ts = value < 1e12 ? value * 1000 : value; // 兼容秒 / 毫秒
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

export function AssignmentSubmitDialog({
  assignmentId,
  onClose,
  onToast,
  lang = 'zh',
}: AssignmentSubmitDialogProps) {
  const zh = lang === 'zh';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [pendingFiles, setPendingFiles] = useState<RemoteFile[]>([]);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [textContent, setTextContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  /** onToast 缺省时（例如白板里没有 toast 宿主）在自己内部显示一条提示 */
  const [notice, setNotice] = useState<{ text: string; type: 'info' | 'success' | 'warning' } | null>(null);
  /** queue key → 待上传的 File（XHR 需要原始 File，不能只靠 state） */
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const xhrRef = useRef<Map<string, XMLHttpRequest>>(new Map());
  const inputRef = useRef<HTMLInputElement | null>(null);

  const notify = useCallback(
    (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => {
      if (onToast) {
        onToast(title, message, type);
        return;
      }
      setNotice({ text: message ? `${title}：${message}` : title, type: type === 'error' ? 'warning' : type });
    },
    [onToast],
  );

  const patchQueue = useCallback((key: string, patch: Partial<QueuedFile>) => {
    setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setLoadError(null);
      try {
        const [detailRes, filesRes] = await Promise.all([
          fetch(`/api/assignments/${encodeURIComponent(assignmentId)}`),
          fetch(`/api/assignments/${encodeURIComponent(assignmentId)}/files`),
        ]);
        const detailData = await detailRes.json().catch(() => null);
        if (!detailRes.ok || detailData?.success === false) {
          throw new Error(detailData?.error || `HTTP ${detailRes.status}`);
        }
        setDetail(detailData);
        const filesData = await filesRes.json().catch(() => null);
        const files: RemoteFile[] = Array.isArray(filesData?.files) ? filesData.files : [];
        // 只有尚未随提交归档的附件才允许继续参与下一次提交
        setPendingFiles(files.filter((f) => !f.version_id));
      } catch (e: any) {
        setLoadError(e?.message || 'load failed');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [assignmentId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // 关闭时中断仍在进行的上传，避免弹窗消失后连接仍在跑
  useEffect(() => {
    const xhrs = xhrRef.current;
    return () => {
      xhrs.forEach((xhr) => {
        try {
          xhr.abort();
        } catch {
          /* ignore */
        }
      });
      xhrs.clear();
    };
  }, []);

  const uploadKey = useCallback(
    (key: string) =>
      new Promise<void>((resolve) => {
        const file = fileMapRef.current.get(key);
        if (!file) {
          patchQueue(key, { status: 'error', error: zh ? '文件已失效，请重新选择' : 'file expired' });
          resolve();
          return;
        }
        const xhr = new XMLHttpRequest();
        xhrRef.current.set(key, xhr);
        xhr.open('POST', `/api/assignments/${encodeURIComponent(assignmentId)}/files`, true);
        // 中文文件名不能直接进 HTTP 头，服务端会 decodeURIComponent
        xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          patchQueue(key, { progress: Math.round((event.loaded / event.total) * 100) });
        };
        xhr.onload = () => {
          xhrRef.current.delete(key);
          let payload: any = null;
          try {
            payload = JSON.parse(xhr.responseText || '{}');
          } catch {
            payload = null;
          }
          if (xhr.status >= 200 && xhr.status < 300 && payload?.success !== false && payload?.file?.id) {
            patchQueue(key, { status: 'done', progress: 100, fileId: payload.file.id });
            setPendingFiles((prev) => [
              {
                id: payload.file.id,
                original_name: payload.file.name ?? file.name,
                size: payload.file.size ?? file.size,
                uploaded_at: Date.now(),
              },
              ...prev,
            ]);
          } else {
            patchQueue(key, { status: 'error', error: payload?.error || `HTTP ${xhr.status}` });
          }
          resolve();
        };
        xhr.onerror = () => {
          xhrRef.current.delete(key);
          patchQueue(key, { status: 'error', error: zh ? '网络错误' : 'network error' });
          resolve();
        };
        xhr.onabort = () => {
          xhrRef.current.delete(key);
          resolve();
        };
        patchQueue(key, { status: 'uploading', progress: 0, error: undefined });
        xhr.send(file);
      }),
    [assignmentId, patchQueue, zh],
  );

  const enqueueFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const base = Date.now();
      const accepted: QueuedFile[] = [];
      const rejected: string[] = [];
      files.forEach((file, index) => {
        if (file.size <= 0) {
          rejected.push(`${file.name}（${zh ? '空文件' : 'empty'}）`);
          return;
        }
        if (file.size > MAX_FILE_SIZE) {
          rejected.push(`${file.name}（${zh ? '超过' : 'over'} ${formatBytes(MAX_FILE_SIZE)}）`);
          return;
        }
        const key = `${base}-${index}-${file.name}`;
        fileMapRef.current.set(key, file);
        accepted.push({ key, name: file.name, size: file.size, status: 'queued', progress: 0 });
      });
      if (rejected.length) {
        notify(zh ? '部分文件未加入' : 'Some files skipped', rejected.join('、'), 'warning');
      }
      if (!accepted.length) return;
      setQueue((prev) => [...prev, ...accepted]);
      // 串行上传：不抢占多条连接，也便于逐个失败重试
      void (async () => {
        for (const item of accepted) {
          await uploadKey(item.key);
        }
      })();
    },
    [notify, uploadKey, zh],
  );

  const retryUpload = useCallback(
    (key: string) => {
      void uploadKey(key);
    },
    [uploadKey],
  );

  const dropQueueItem = useCallback((key: string) => {
    try {
      xhrRef.current.get(key)?.abort();
    } catch {
      /* ignore */
    }
    fileMapRef.current.delete(key);
    setQueue((prev) => prev.filter((q) => q.key !== key));
  }, []);

  const removeRemoteFile = useCallback(
    async (fileId: string) => {
      try {
        const res = await fetch(`/api/assignments/${encodeURIComponent(assignmentId)}/files/${fileId}`, {
          method: 'DELETE',
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.success === false) {
          notify(zh ? '删除失败' : 'Delete failed', data?.error || `HTTP ${res.status}`, 'error');
          return;
        }
        setPendingFiles((prev) => prev.filter((f) => f.id !== fileId));
      } catch (e: any) {
        notify(zh ? '删除失败' : 'Delete failed', e?.message || '', 'error');
      }
    },
    [assignmentId, notify, zh],
  );

  // 上传完成的文件会同时出现在「待提交附件」与「上传队列」里，这里按 id 去重，
  // 否则重交时同一个 fileId 会被写进版本两次。
  const doneFileIds = useMemo(() => {
    const pendingIds = pendingFiles.map((f) => f.id);
    const seen = new Set(pendingIds);
    const queued: string[] = [];
    for (const item of queue) {
      if (item.status !== 'done' || !item.fileId || seen.has(item.fileId)) continue;
      seen.add(item.fileId);
      queued.push(item.fileId);
    }
    return [...pendingIds, ...queued];
  }, [pendingFiles, queue]);

  const uploading = queue.some((q) => q.status === 'uploading');
  const hasAnswer = doneFileIds.length > 0 || textContent.trim().length > 0 || linkUrl.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (submitting || uploading) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/assignments/${encodeURIComponent(assignmentId)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileIds: doneFileIds,
          textContent: textContent.trim() || undefined,
          linkUrl: linkUrl.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setJustSubmitted(Number(data?.version) || 1);
      setQueue([]);
      fileMapRef.current.clear();
      setTextContent('');
      notify(zh ? '提交成功' : 'Submitted', zh ? `已生成第 ${data?.version ?? 1} 版提交` : '', 'success');
      await load(true);
    } catch (e: any) {
      setSubmitError(e?.message || 'submit failed');
    } finally {
      setSubmitting(false);
    }
  }, [assignmentId, doneFileIds, load, notify, submitting, textContent, uploading, zh]);

  const assignment = detail?.assignment;
  const versions: any[] = Array.isArray(detail?.versions) ? detail.versions : [];
  const grade = detail?.grade;
  const stats = detail?.stats;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-surface border border-theme shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-theme">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Paperclip size={14} className="text-orange-600 shrink-0" />
              <h3 className="font-bold text-main text-sm truncate">
                {assignment?.title || (zh ? '课堂作业' : 'Assignment')}
              </h3>
            </div>
            {assignment && (
              <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-muted">
                <span className="px-1.5 py-0.5 rounded-full bg-surface-secondary border border-theme">
                  {assignment.status === 'published' ? (zh ? '已发布' : 'published') : assignment.status}
                </span>
                {assignment.due_at ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock size={10} /> {zh ? '截止' : 'Due'} {formatTime(assignment.due_at)}
                  </span>
                ) : null}
                {assignment.allow_late ? <span>{zh ? '允许迟交' : 'late allowed'}</span> : null}
                {stats ? <span>{zh ? `已提交 ${stats.submissionCount}` : `${stats.submissionCount} submitted`}</span> : null}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => void load(true)}
              className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface-secondary transition-colors"
              title={zh ? '刷新' : 'Refresh'}
            >
              <RefreshCw size={13} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface-secondary transition-colors"
              title={zh ? '关闭' : 'Close'}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted text-xs">
              <Loader2 size={14} className="animate-spin" /> {zh ? '加载中…' : 'Loading…'}
            </div>
          ) : loadError ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">{zh ? '无法加载作业' : 'Failed to load assignment'}</div>
                <div className="mt-0.5 break-all">{loadError}</div>
              </div>
            </div>
          ) : (
            <>
              {assignment?.description ? (
                <div className="rounded-xl border border-theme bg-surface-secondary px-3 py-2 text-xs text-main whitespace-pre-wrap leading-relaxed">
                  {assignment.description}
                </div>
              ) : null}

              {grade ? (
                <div className="rounded-xl border border-theme px-3 py-2 text-xs flex items-center gap-2">
                  <Award size={14} className="text-amber-500 shrink-0" />
                  {grade.status === 'confirmed' ? (
                    <span className="text-main">
                      {zh ? '最终成绩' : 'Final score'}：
                      <span className="font-bold text-amber-600 ml-1">{grade.calculated_final_score}</span>
                    </span>
                  ) : (
                    <span className="text-muted">{zh ? '成绩待教师确认' : 'Grade pending confirmation'}</span>
                  )}
                </div>
              ) : null}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-main">{zh ? '作业文件' : 'Files'}</span>
                  <span className="text-[11px] text-muted">
                    {zh ? '单个不超过' : 'max'} {formatBytes(MAX_FILE_SIZE)}
                  </span>
                </div>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    const dropped = Array.from(e.dataTransfer?.files || []);
                    if (dropped.length) enqueueFiles(dropped);
                  }}
                  onClick={() => inputRef.current?.click()}
                  className={`rounded-xl border-2 border-dashed px-3 py-4 text-center cursor-pointer transition-colors ${
                    dragActive ? 'border-orange-400 bg-orange-50' : 'border-theme hover:border-orange-300'
                  }`}
                >
                  <Upload size={16} className="mx-auto text-muted" />
                  <div className="mt-1 text-xs text-main font-medium">
                    {zh ? '点击选择文件，或拖拽到此处' : 'Click to choose files, or drop them here'}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {zh ? '支持文档、图片、压缩包与常见代码文件' : 'documents, images, archives, source files'}
                  </div>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept={ACCEPT_EXT}
                    className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      if (picked.length) enqueueFiles(picked);
                      e.target.value = '';
                    }}
                  />
                </div>

                {pendingFiles.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {pendingFiles.map((file) => (
                      <li
                        key={file.id}
                        className="flex items-center gap-2 rounded-lg border border-theme px-2 py-1.5 text-xs"
                      >
                        <FileText size={12} className="text-muted shrink-0" />
                        <span className="flex-1 truncate text-main">{file.original_name}</span>
                        <span className="text-[11px] text-muted shrink-0">{formatBytes(file.size)}</span>
                        <button
                          onClick={() => void removeRemoteFile(file.id)}
                          className="p-1 rounded text-orange-600 hover:text-red-500 hover:bg-surface-secondary"
                          title={zh ? '移除' : 'Remove'}
                        >
                          <Trash2 size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {queue.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {queue.map((item) => (
                      <li key={item.key} className="rounded-lg border border-theme px-2 py-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          {item.status === 'done' ? (
                            <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                          ) : item.status === 'error' ? (
                            <AlertCircle size={12} className="text-red-500 shrink-0" />
                          ) : (
                            <Loader2 size={12} className="animate-spin text-muted shrink-0" />
                          )}
                          <span className="flex-1 truncate text-main">{item.name}</span>
                          <span className="text-[11px] text-muted shrink-0">{formatBytes(item.size)}</span>
                          {item.status === 'error' && (
                            <button
                              onClick={() => retryUpload(item.key)}
                              className="p-1 rounded text-primary-theme hover:bg-surface-secondary"
                              title={zh ? '重试' : 'Retry'}
                            >
                              <RefreshCw size={12} />
                            </button>
                          )}
                          <button
                            onClick={() => dropQueueItem(item.key)}
                            className="p-1 rounded text-muted hover:text-main hover:bg-surface-secondary"
                            title={zh ? '从列表移除' : 'Remove from list'}
                          >
                            <X size={12} />
                          </button>
                        </div>
                        {item.status === 'uploading' && (
                          <div className="mt-1 h-1 rounded-full bg-surface-secondary overflow-hidden">
                            <div className="h-full bg-orange-500 transition-all" style={{ width: `${item.progress}%` }} />
                          </div>
                        )}
                        {item.status === 'error' && item.error ? (
                          <div className="mt-0.5 text-[11px] text-red-600 break-all">{item.error}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-semibold text-main mb-1">
                    {zh ? '文字作答（可选）' : 'Text answer (optional)'}
                  </label>
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    className="w-full h-20 p-2 border border-theme rounded-lg text-xs bg-surface text-main resize-none focus:outline-none focus:ring-1 focus:ring-orange-400"
                    placeholder={zh ? '可直接粘贴代码或说明…' : 'Paste code or notes…'}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-main mb-1">
                    <span className="inline-flex items-center gap-1">
                      <Link2 size={11} /> {zh ? '作品链接（可选）' : 'Link (optional)'}
                    </span>
                  </label>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-orange-400"
                    placeholder="https://"
                  />
                </div>
              </div>

              {versions.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-main mb-1.5">
                    {zh ? `提交历史（共 ${versions.length} 版）` : `Submission history (${versions.length})`}
                  </div>
                  <ul className="space-y-1">
                    {versions.map((version) => (
                      <li
                        key={version.id}
                        className="flex items-center gap-2 rounded-lg border border-theme px-2 py-1.5 text-xs"
                      >
                        <span className="px-1.5 py-0.5 rounded bg-surface-secondary border border-theme text-[11px] text-main shrink-0">
                          v{version.version}
                        </span>
                        <span className="flex-1 truncate text-muted">
                          {version.text_content || version.link_url || '—'}
                        </span>
                        <span className="text-[11px] text-muted shrink-0">
                          {formatTime(version.created_at || version.submitted_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {justSubmitted !== null && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  <CheckCircle2 size={14} className="shrink-0" />
                  {zh ? `已提交第 ${justSubmitted} 版` : `Version ${justSubmitted} submitted`}
                </div>
              )}
              {submitError && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span className="break-all">{submitError}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-theme">
          <span className="text-[11px] text-muted">
            {notice ? (
              <span className={notice.type === 'warning' ? 'text-amber-700' : 'text-emerald-700'}>{notice.text}</span>
            ) : zh
              ? `本次将提交 ${doneFileIds.length} 个附件${textContent.trim() ? ' + 文本' : ''}${linkUrl.trim() ? ' + 链接' : ''}`
              : `${doneFileIds.length} file(s)`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs border border-theme text-main hover:bg-surface-secondary transition-colors"
            >
              {zh ? '关闭' : 'Close'}
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={submitting || uploading || !hasAnswer}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors inline-flex items-center gap-1.5"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {submitting ? (zh ? '提交中…' : 'Submitting…') : zh ? '提交作业' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AssignmentSubmitDialog;
