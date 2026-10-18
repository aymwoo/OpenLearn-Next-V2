/**
 * PluginUninstallDialog — 卸载插件时的数据处理选择（Issue #141）。
 *
 * 卸载 ≠ 删数据：
 * - 默认「保留数据」：插件表 / 迁移版本 / 存储键留库并登记，重装同 manifest.id
 *   自动复用旧数据；
 * - 「清除数据」为不可恢复操作，需勾选确认；服务端会先导出 SQL 归档再删除。
 */

import React, { useState } from 'react';
import { AlertTriangle, Database, Trash2, X } from 'lucide-react';
import type { Language, PluginDataPolicy } from './plugin-center/types';

interface PluginUninstallDialogProps {
  pluginName: string;
  manifestId: string;
  lang: Language;
  onCancel: () => void;
  onConfirm: (dataPolicy: PluginDataPolicy) => void;
}

export function PluginUninstallDialog({ pluginName, manifestId, lang, onCancel, onConfirm }: PluginUninstallDialogProps) {
  const [purgeSelected, setPurgeSelected] = useState(false);
  const [purgeAcknowledged, setPurgeAcknowledged] = useState(false);
  const zh = lang === 'zh';

  const handleConfirm = () => {
    if (purgeSelected) {
      if (!purgeAcknowledged) return;
      onConfirm('purge');
      return;
    }
    onConfirm('keep');
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Trash2 size={18} className="text-red-500" />
            <h3 className="text-base font-bold text-gray-900">
              {zh ? `卸载「${pluginName}」` : `Uninstall "${pluginName}"`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label={zh ? '关闭' : 'Close'}
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-6 py-5">
          <p className="text-sm text-gray-600">
            {zh
              ? '卸载后插件功能立即停用。请选择如何处理该插件保存的数据（学生作业、考勤、成绩等）。'
              : 'The plugin stops working immediately. Choose what happens to the data it stored (submissions, attendance, scores…).'}
          </p>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
              purgeSelected ? 'border-gray-200 bg-gray-50/40' : 'border-indigo-300 bg-indigo-50/40'
            }`}
          >
            <input
              type="radio"
              name="uninstall-data-policy"
              checked={!purgeSelected}
              onChange={() => setPurgeSelected(false)}
              className="mt-1"
            />
            <span className="space-y-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                <Database size={14} className="text-indigo-600" />
                {zh ? '保留插件数据（推荐）' : 'Keep plugin data (recommended)'}
              </span>
              <span className="block text-xs text-gray-500">
                {zh
                  ? '插件表、迁移版本与配置原样留库。重新安装同一插件时会自动接回旧数据，也可以在「插件数据」页随时导出或清除。'
                  : 'Tables, migration version and config stay in the database. Reinstalling the same plugin re-attaches them; you can export or clear them later under Plugin Data.'}
              </span>
            </span>
          </label>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
              purgeSelected ? 'border-red-300 bg-red-50/50' : 'border-gray-200 bg-gray-50/40'
            }`}
          >
            <input
              type="radio"
              name="uninstall-data-policy"
              checked={purgeSelected}
              onChange={() => setPurgeSelected(true)}
              className="mt-1"
            />
            <span className="space-y-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
                <AlertTriangle size={14} />
                {zh ? '卸载并清除插件数据（不可恢复）' : 'Uninstall and purge plugin data (irreversible)'}
              </span>
              <span className="block text-xs text-gray-500">
                {zh
                  ? '服务端会先把插件表导出为 SQL 归档（保存在数据目录 plugin-data-exports/），确认归档成功后再删除数据，并写入审计日志。'
                  : 'The server exports the plugin tables to a SQL archive (data dir plugin-data-exports/) before deleting anything, then writes an audit record.'}
              </span>
            </span>
          </label>

          {purgeSelected && (
            <label className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <input
                type="checkbox"
                checked={purgeAcknowledged}
                onChange={(e) => setPurgeAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                {zh
                  ? `我已知晓：清除「${manifestId}」的数据不可恢复（请以归档文件为准）。`
                  : `I understand that purging data for "${manifestId}" is irreversible (rely on the archive).`}
              </span>
            </label>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            {zh ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={purgeSelected && !purgeAcknowledged}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${
              purgeSelected
                ? purgeAcknowledged
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'cursor-not-allowed bg-red-300'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {purgeSelected ? (zh ? '卸载并清除数据' : 'Uninstall & purge') : zh ? '卸载并保留数据' : 'Uninstall & keep data'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PluginUninstallDialog;
