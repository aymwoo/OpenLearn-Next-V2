import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Database, History, Loader2, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import type { Language } from '../i18n';

export interface PluginSnapshotItem {
  snapshotId: string;
  pluginId: string;
  manifestId: string;
  pluginName: string;
  fromVersion: string;
  toVersion: string | null;
  status: 'creating' | 'ready' | 'rolled_back';
  createdAt: number;
  wasActive: boolean;
  executionMode: string;
  tableCount: number;
  rowCount: number;
  storageRows: number;
  configRows: number;
  migrationVersion: number | null;
  sizeBytes: number;
}

export interface PluginSnapshotRollbackModalProps {
  plugin: {
    id: string;
    name: string;
    version?: string;
    manifestId?: string;
  };
  lang: Language;
  onClose: () => void;
  onRolledBack?: (result: { restoredVersion: string; fromVersion: string }) => void;
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function PluginSnapshotRollbackModal({
  plugin,
  lang,
  onClose,
  onRolledBack,
  fetcher,
}: PluginSnapshotRollbackModalProps) {
  const zh = lang === 'zh';
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const doFetch = useMemo(() => fetcher ?? ((input: string, init?: RequestInit) => fetch(input, init)), [fetcher]);

  const [snapshots, setSnapshots] = useState<PluginSnapshotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmSnapshotId, setConfirmSnapshotId] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    }
    return () => {
      if (dialog.open && typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    };
  }, []);

  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await doFetch(`/api/plugins/${encodeURIComponent(plugin.id)}/snapshots`);
      const data = (await resp.json().catch(() => null)) as {
        success?: boolean;
        snapshots?: PluginSnapshotItem[];
        error?: string;
      } | null;
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || (zh ? '加载快照失败' : 'Failed to load snapshots'));
      }
      setSnapshots(Array.isArray(data.snapshots) ? data.snapshots : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [doFetch, plugin.id, zh]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  const handleRollback = async (snapshotId: string) => {
    setRollingBackId(snapshotId);
    setError(null);
    try {
      const resp = await doFetch(`/api/plugins/${encodeURIComponent(plugin.id)}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId }),
      });
      const data = (await resp.json().catch(() => null)) as {
        success?: boolean;
        restoredVersion?: string;
        fromVersion?: string;
        error?: string;
      } | null;
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || (zh ? '回滚失败' : 'Rollback failed'));
      }
      setConfirmSnapshotId(null);
      onRolledBack?.({
        restoredVersion: data.restoredVersion || '',
        fromVersion: data.fromVersion || plugin.version || '',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRollingBackId(null);
    }
  };

  const handleDelete = async (snapshotId: string) => {
    setDeletingId(snapshotId);
    setError(null);
    try {
      const resp = await doFetch(
        `/api/plugins/${encodeURIComponent(plugin.id)}/snapshots/${encodeURIComponent(snapshotId)}`,
        { method: 'DELETE' },
      );
      const data = (await resp.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || (zh ? '删除快照失败' : 'Failed to delete snapshot'));
      }
      if (confirmSnapshotId === snapshotId) {
        setConfirmSnapshotId(null);
      }
      setSnapshots((prev) => prev.filter((item) => item.snapshotId !== snapshotId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!rollingBackId) onClose();
      }}
      className="m-auto w-full max-w-xl rounded-2xl bg-white p-0 shadow-2xl border border-gray-200 text-gray-900 [overscroll-behavior:contain] [&::backdrop]:bg-black/45 [&::backdrop]:overflow-hidden [&::backdrop]:[overscroll-behavior:contain]"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <History size={18} className="text-indigo-600 shrink-0" />
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-bold text-gray-900 truncate">
              {zh ? `「${plugin.name}」历史快照与安全回滚` : `"${plugin.name}" Snapshots & Safe Rollback`}
            </h3>
            <p className="text-xs text-gray-500 font-mono truncate">
              {plugin.manifestId || plugin.id} · {zh ? '当前版本' : 'Current'} v{plugin.version || '0.0.0'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!rollingBackId) onClose();
          }}
          aria-label={zh ? '关闭对话框' : 'Close dialog'}
          className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-6 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
        <div className="flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3.5 py-2.5 text-xs text-indigo-900">
          <ShieldCheck size={16} className="text-indigo-600 shrink-0 mt-0.5" />
          <span>
            {zh
              ? '每次插件更新前都会自动保存 1 份更新前完整快照（包含插件文件、私有数据库表、存储键值、配置与权限）。若新版本存在缺陷或升级异常，可随时安全回滚。'
              : 'Every update automatically captures 1 full pre-update snapshot (plugin files, private DB tables, storage, config, and grants) so you can safely roll back if needed.'}
          </span>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin text-indigo-600" />
            <span>{zh ? '正在读取更新快照…' : 'Loading snapshots…'}</span>
          </div>
        ) : snapshots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-8 text-center text-xs text-gray-500">
            {zh
              ? '暂无可用的更新前快照。执行插件更新后，系统将自动在此保留最新 1 份更新前快照。'
              : 'No pre-update snapshots yet. The latest pre-update snapshot is automatically created before any plugin update.'}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {snapshots.map((snap) => {
              const isConfirming = confirmSnapshotId === snap.snapshotId;
              const isRolling = rollingBackId === snap.snapshotId;
              const isDeleting = deletingId === snap.snapshotId;
              return (
                <div
                  key={snap.snapshotId}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                          v{snap.fromVersion}
                        </span>
                        {snap.toVersion && (
                          <>
                            <span className="text-xs text-gray-400">➔</span>
                            <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                              v{snap.toVersion}
                            </span>
                          </>
                        )}
                        <span className="text-[11px] text-gray-400 font-mono">{formatBytes(snap.sizeBytes)}</span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {zh ? '快照生成于：' : 'Captured: '}
                        {new Date(snap.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleDelete(snap.snapshotId)}
                      disabled={Boolean(rollingBackId) || isDeleting}
                      title={zh ? '删除快照' : 'Delete snapshot'}
                      aria-label={zh ? '删除快照' : 'Delete snapshot'}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      <Database size={12} className="text-indigo-500" />
                      {zh
                        ? `${snap.tableCount} 张私有表 / ${snap.rowCount} 行`
                        : `${snap.tableCount} tables / ${snap.rowCount} rows`}
                    </span>
                    <span>{zh ? `存储键 ${snap.storageRows} 项` : `${snap.storageRows} storage keys`}</span>
                    <span>{zh ? `配置 ${snap.configRows} 项` : `${snap.configRows} configs`}</span>
                    {snap.migrationVersion !== null && (
                      <span className="font-mono">
                        {zh ? `迁移 v${snap.migrationVersion}` : `Migration v${snap.migrationVersion}`}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 min-h-[34px]">
                    {isConfirming ? (
                      <>
                        <span className="text-xs text-amber-700 mr-auto">
                          {zh
                            ? `确认将插件代码与数据恢复至 v${snap.fromVersion}？`
                            : `Restore files and DB to v${snap.fromVersion}?`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setConfirmSnapshotId(null)}
                          disabled={isRolling}
                          autoFocus
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer"
                        >
                          {zh ? '取消' : 'Cancel'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRollback(snap.snapshotId)}
                          disabled={isRolling}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {isRolling ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                          <span>{zh ? '确认回滚' : 'Confirm Rollback'}</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmSnapshotId(snap.snapshotId)}
                        disabled={Boolean(rollingBackId) || isDeleting}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw size={12} />
                        <span>{zh ? `回滚至 v${snap.fromVersion}` : `Rollback to v${snap.fromVersion}`}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end border-t border-gray-100 px-6 py-3 bg-gray-50/60">
        <button
          type="button"
          onClick={() => {
            if (!rollingBackId) onClose();
          }}
          className="px-4 py-1.5 text-xs font-medium rounded-lg text-gray-600 hover:bg-gray-200/70 transition-colors cursor-pointer"
        >
          {zh ? '关闭' : 'Close'}
        </button>
      </div>
    </dialog>
  );
}
