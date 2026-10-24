/**
 * PluginDataPanel — 「插件数据」子视图（Issue #141）。
 *
 * 列出卸载后保留在库中的孤立插件数据（表 / 行数 / 存储键 / 卸载时间），
 * 支持导出 SQL 归档与清除（清除为两步确认，服务端还会先自动导出）。
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Database, Download, HardDrive, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type { Language, OrphanDataItem } from '../types';

interface PluginDataPanelProps {
  lang: Language;
  items: OrphanDataItem[];
  loading?: boolean;
  onRefresh: () => Promise<void> | void;
  onExport: (item: OrphanDataItem) => Promise<void> | void;
  onPurge: (item: OrphanDataItem) => Promise<void> | void;
  onDownloadArchive?: (item: OrphanDataItem) => void;
}

function formatTime(ts: number): string {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '-';
  }
}

export function PluginDataPanel({
  lang,
  items,
  loading,
  onRefresh,
  onExport,
  onPurge,
  onDownloadArchive,
}: PluginDataPanelProps) {
  const zh = lang === 'zh';
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void onRefresh();
    // 仅在挂载时拉取一次；后续由用户手动刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runBusy = async (id: string, fn: () => Promise<void> | void) => {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50/30 p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <Database size={16} className="text-indigo-600" />
            {zh ? '插件数据（卸载后保留）' : 'Plugin Data (kept after uninstall)'}
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            {zh
              ? '卸载插件默认保留其数据表与配置，重新安装同一插件会自动接回。清除前服务端会先导出 SQL 归档，此操作不可恢复。'
              : 'Uninstalling keeps plugin tables and config by default; reinstalling the same plugin re-attaches them. Purging exports a SQL archive first and cannot be undone.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 shadow-sm transition-colors hover:border-indigo-300 hover:text-indigo-600"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {zh ? '刷新' : 'Refresh'}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white/60 py-16 text-center">
          <HardDrive size={28} className="mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">{zh ? '暂无保留的插件数据' : 'No retained plugin data'}</p>
          <p className="mt-1 text-xs text-gray-400">
            {zh
              ? '卸载插件时若选择「保留数据」，会在这里出现。'
              : 'Data appears here when a plugin is uninstalled with "keep data".'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const key = `${item.manifestId}:${item.pluginId}`;
            const busy = busyId === item.pluginId;
            const confirming = confirmingId === item.pluginId;
            return (
              <div key={key} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-gray-900">
                        {item.pluginName || item.manifestId}
                      </span>
                      {item.pluginVersion && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                          v{item.pluginVersion}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-gray-400">{item.manifestId}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>
                        {zh ? '数据表' : 'Tables'}: <strong className="text-gray-700">{item.tableCount}</strong>
                      </span>
                      <span>
                        {zh ? '数据行' : 'Rows'}: <strong className="text-gray-700">{item.rowCount}</strong>
                      </span>
                      <span>
                        {zh ? '配置键' : 'Storage keys'}: <strong className="text-gray-700">{item.storageKeys}</strong>
                      </span>
                      <span>
                        {zh ? '迁移版本' : 'Migration'}:{' '}
                        <strong className="text-gray-700">{item.migrationVersion ?? '-'}</strong>
                      </span>
                      <span>
                        {zh ? '卸载时间' : 'Uninstalled'}:{' '}
                        <strong className="text-gray-700">{formatTime(item.uninstalledAt)}</strong>
                      </span>
                    </div>
                    {item.lastExportPath && (
                      <div className="mt-1 truncate font-mono text-[11px] text-emerald-600">
                        {zh ? '最近归档' : 'Latest archive'}: {item.lastExportPath}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runBusy(item.pluginId, () => onExport(item))}
                      className="flex items-center gap-1 rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      {zh ? '导出归档' : 'Export'}
                    </button>
                    {onDownloadArchive && item.lastExportPath && (
                      <button
                        type="button"
                        onClick={() => onDownloadArchive(item)}
                        className="flex items-center gap-1 rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                      >
                        <Download size={12} />
                        {zh ? '下载' : 'Download'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmingId(confirming ? null : item.pluginId)}
                      className="flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      {zh ? '清除数据' : 'Purge'}
                    </button>
                  </div>
                </div>

                {confirming && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                    <div className="flex items-start gap-2 text-xs text-red-700">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>
                        {zh
                          ? `将清除 ${item.tableCount} 张表、${item.rowCount} 行数据与 ${item.storageKeys} 个配置键。服务端会先导出 SQL 归档，但清除后无法直接恢复。`
                          : `This clears ${item.tableCount} tables, ${item.rowCount} rows and ${item.storageKeys} storage keys. A SQL archive is exported first, but the data cannot be restored in place.`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        {zh ? '取消' : 'Cancel'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runBusy(item.pluginId, async () => {
                            await onPurge(item);
                            setConfirmingId(null);
                          })
                        }
                        className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:bg-red-300"
                      >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        {zh ? '确认清除' : 'Confirm purge'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PluginDataPanel;
