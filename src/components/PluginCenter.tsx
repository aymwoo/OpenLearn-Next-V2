import React, { useState, useEffect, useRef } from 'react';
import {
  Puzzle,
  Code,
  Terminal,
  Upload,
  CheckCircle2,
  AlertTriangle,
  X,
  Sparkles,
  ExternalLink,
  Github,
  RefreshCw
} from 'lucide-react';
import type { PluginCenterProps } from './plugin-center/types';
import { PluginSettingsModal } from './PluginSettingsModal';
import { PluginInstallWizard } from './PluginInstallWizard';
import { PluginStorePanel } from './plugin-center/sub-views/PluginStorePanel';
import { PluginDevPanel } from './plugin-center/sub-views/PluginDevPanel';
import { PluginLogsPanel } from './plugin-center/sub-views/PluginLogsPanel';

export type { PluginType, PluginCenterProps } from './plugin-center/types';

export function PluginCenter({
  plugins,
  lang,
  storeTab,
  setStoreTab,
  pluginCode,
  setPluginCode,
  installingPlugin,
  onInstall,
  onZipUpload,
  onToggle,
  onDelete,
}: PluginCenterProps) {
  const [showSystemPlugins, setShowSystemPlugins] = useState(false);
  const [dismissMigration, setDismissMigration] = useState(false);
  const [selectedZipFile, setSelectedZipFile] = useState<File | null>(null);
  const [updateTargetPluginId, setUpdateTargetPluginId] = useState<string | null>(null);
  const updateFileInputRef = useRef<HTMLInputElement>(null);

  const [zipError, setZipError] = useState<string | null>(null);
  const [zipPreview, setZipPreview] = useState<{ name: string; id: string; version: string } | null>(null);
  const [zipProcessing, setZipProcessing] = useState(false);

  const [settingsPlugin, setSettingsPlugin] = useState<{ id: string; name: string; manifest: string } | null>(null);

  const [marketMap, setMarketMap] = useState<Map<string, any>>(new Map());
  const [oneClickUpdatingId, setOneClickUpdatingId] = useState<string | null>(null);
  const [checkingUpdateId, setCheckingUpdateId] = useState<string | null>(null);
  const [changelogModalPlugin, setChangelogModalPlugin] = useState<any | null>(null);
  const [updateToast, setUpdateToast] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetch('/api/plugins/market')
      .then((r) => r.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.market) && isMounted) {
          const map = new Map<string, any>();
          for (const item of data.market) {
            map.set(item.manifestId, item);
          }
          setMarketMap(map);
        }
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, []);

  const handleCheckUpdate = async (pluginId: string, manifestId: string) => {
    setCheckingUpdateId(pluginId);
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/check-update`, {
        method: 'POST',
      }).then((r) => r.json());
      if (res?.success) {
        setMarketMap((prev) => {
          const next = new Map(prev);
          next.set(manifestId, { ...res, manifestId });
          return next;
        });
      }
    } catch {
      // ignore
    } finally {
      setCheckingUpdateId(null);
    }
  };

  const handleOneClickUpdate = async (pluginId: string, marketItem?: any) => {
    setOneClickUpdatingId(pluginId);
    setUpdateToast(lang === 'zh' ? '正在连接市场执行一键无缝热更新...' : 'Connecting to market for one-click hot update...');

    try {
      const body = marketItem?.downloadUrl ? JSON.stringify({ downloadUrl: marketItem.downloadUrl }) : undefined;
      const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/one-click-update`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body,
      }).then((r) => r.json());

      if (res?.success) {
        setUpdateToast(lang === 'zh' ? `🎉 插件已成功热更新至 v${res.newVersion || '1.2.0'}！` : `🎉 Hot updated to v${res.newVersion || '1.2.0'}!`);
        setTimeout(() => window.location.reload(), 1200);
      } else if (res?.fallbackToClient && marketItem?.downloadUrl) {
        setUpdateToast(lang === 'zh' ? '服务端下载超时，切换至浏览器直传...' : 'Server download timed out, switching to browser transfer...');
        try {
          const zipResp = await fetch(marketItem.downloadUrl);
          const blob = await zipResp.blob();
          const formData = new FormData();
          formData.append('file', blob, 'update.zip');
          const uploadRes = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/update-zip-raw`, {
            method: 'POST',
            headers: { 'x-install-mode': 'update' },
            body: formData,
          }).then((r) => r.json());
          if (uploadRes?.success) {
            setUpdateToast(lang === 'zh' ? `🎉 插件已成功热更新！` : `🎉 Hot updated!`);
            setTimeout(() => window.location.reload(), 1200);
          } else {
            setUpdateToast(`❌ 更新失败: ${uploadRes?.error || '客户端上传失败'}`);
            setTimeout(() => setUpdateToast(null), 4000);
          }
        } catch (e2: any) {
          setUpdateToast(`❌ 客户端下载失败: ${e2.message}`);
          setTimeout(() => setUpdateToast(null), 4000);
        }
      } else {
        setUpdateToast(`❌ 更新失败: ${res?.error || '受热更新包限制'}`);
        setTimeout(() => setUpdateToast(null), 4000);
      }
    } catch (e: any) {
      setUpdateToast(`❌ 一键热更新失败: ${e.message}`);
      setTimeout(() => setUpdateToast(null), 4000);
    } finally {
      setOneClickUpdatingId(null);
    }
  };

  const handleZipDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/50');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setUpdateTargetPluginId(null);
      setSelectedZipFile(files[0]);
    }
  };

  const handleZipInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedZipFile(file);
    }
  };

  const hasLegacyPlugins = plugins.some(p => (p as any).execution_mode === 'legacy');

  function MigrationPromptBanner() {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold text-amber-800">
              {lang === 'zh' ? '发现可迁移的旧格式插件' : 'Legacy Plugin Detected'}
            </h4>
            <p className="text-xs text-amber-700 mt-1">
              {lang === 'zh'
                ? '该插件使用旧格式运行。上传新格式 ZIP 包以完成迁移，迁移后旧版本可安全卸载。'
                : 'This plugin runs in legacy mode. Upload a new-format ZIP package to migrate. The old version can be safely uninstalled afterwards.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => document.getElementById('zip-plugin-uploader')?.click()}
            className="bg-amber-600 text-white hover:bg-amber-700 rounded-lg text-sm font-medium px-4 py-2 transition-colors cursor-pointer"
          >
            {lang === 'zh' ? '迁移到新格式' : 'Migrate to New Format'}
          </button>
          <button
            onClick={() => setDismissMigration(true)}
            className="text-amber-500 hover:text-amber-700 p-1 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 flex flex-col h-full overflow-y-auto">
        <div className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow flex flex-col overflow-hidden h-full">
          <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 bg-gray-50/50 shrink-0">
            <div className="flex items-center gap-6">
              <h2 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
                <Puzzle size={20} className="text-indigo-600" />
                {lang === 'zh' ? 'Edu OS 插件中心' : 'Edu OS App Store'}
              </h2>
              <div className="flex bg-gray-200/50 p-1 rounded-lg">
                <button
                  onClick={() => setStoreTab('store')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                    storeTab === 'store'
                      ? 'bg-white shadow text-indigo-600 font-bold'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {lang === 'zh' ? '发现' : 'Discover'}
                </button>
                <button
                  onClick={() => setStoreTab('dev')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
                    storeTab === 'dev'
                      ? 'bg-white shadow text-indigo-600 font-bold'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Code size={14} /> {lang === 'zh' ? '开发者' : 'Developer'}
                </button>
                <button
                  onClick={() => setStoreTab('logs')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
                    storeTab === 'logs'
                      ? 'bg-white shadow text-indigo-600 font-bold'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Terminal size={14} /> {lang === 'zh' ? '系统日志' : 'Logs'}
                </button>
              </div>
            </div>

            {storeTab === 'store' && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-500 hover:text-gray-900 select-none transition-colors border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50/50 shadow-sm">
                  <input
                    type="checkbox"
                    checked={showSystemPlugins}
                    onChange={(e) => setShowSystemPlugins(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-indigo-600 border-gray-300 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span>{lang === 'zh' ? '显示系统核心插件' : 'Show System Core Plugins'}</span>
                </label>

                <div
                  className={`flex items-center gap-1.5 cursor-pointer text-xs font-semibold select-none transition-colors border rounded-lg px-3 py-1.5 shadow-sm ${
                    selectedZipFile
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-teal-200 bg-teal-50/50 text-teal-600 hover:border-teal-400 hover:bg-teal-50'
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add('border-teal-400', 'bg-teal-50');
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove('border-teal-400', 'bg-teal-50');
                  }}
                  onDrop={handleZipDrop}
                  onClick={() => {
                    document.getElementById('zip-plugin-uploader')?.click();
                  }}
                >
                  {selectedZipFile ? (
                    <>
                      <CheckCircle2 size={14} className="text-emerald-500" />
                      <span className="max-w-[120px] truncate">{selectedZipFile.name}</span>
                    </>
                  ) : (
                    <>
                      <Upload size={14} />
                      <span>{lang === 'zh' ? '拖拽安装 ZIP' : 'Drop ZIP'}</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <input
            type="file"
            accept=".zip"
            id="zip-plugin-uploader"
            className="hidden"
            onChange={(e) => {
              setUpdateTargetPluginId(null);
              handleZipInputChange(e);
            }}
          />
          <input
            ref={updateFileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setSelectedZipFile(f);
              e.target.value = '';
            }}
          />

          {storeTab === 'store' ? (
            <PluginStorePanel
              plugins={plugins}
              lang={lang}
              showSystemPlugins={showSystemPlugins}
              marketMap={marketMap}
              checkingUpdateId={checkingUpdateId}
              oneClickUpdatingId={oneClickUpdatingId}
              handleCheckUpdate={handleCheckUpdate}
              handleOneClickUpdate={handleOneClickUpdate}
              setChangelogModalPlugin={setChangelogModalPlugin}
              setSettingsPlugin={setSettingsPlugin}
              setUpdateTargetPluginId={setUpdateTargetPluginId}
              updateFileInputRef={updateFileInputRef}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ) : storeTab === 'logs' ? (
            <PluginLogsPanel lang={lang} />
          ) : (
            <PluginDevPanel
              lang={lang}
              pluginCode={pluginCode}
              setPluginCode={setPluginCode}
              plugins={plugins}
              installingPlugin={installingPlugin}
              onInstall={onInstall}
              onToggle={onToggle}
              onDelete={onDelete}
              setUpdateTargetPluginId={setUpdateTargetPluginId}
              updateFileInputRef={updateFileInputRef}
              setStoreTab={setStoreTab}
              handleZipDrop={handleZipDrop}
              zipError={zipError}
              setZipError={setZipError}
              zipPreview={zipPreview}
              setZipPreview={setZipPreview}
              zipProcessing={zipProcessing}
              hasLegacyPlugins={hasLegacyPlugins}
              dismissMigration={dismissMigration}
              MigrationPromptBanner={MigrationPromptBanner}
            />
          )}
        </div>
      </div>

      {settingsPlugin && (
        <PluginSettingsModal
          pluginId={settingsPlugin.id}
          pluginName={settingsPlugin.name}
          manifestStr={settingsPlugin.manifest}
          lang={lang}
          onClose={() => setSettingsPlugin(null)}
        />
      )}

      <PluginInstallWizard
        isOpen={!!selectedZipFile}
        onClose={() => {
          setSelectedZipFile(null);
          setUpdateTargetPluginId(null);
        }}
        lang={lang}
        file={selectedZipFile}
        lockedTargetPluginId={updateTargetPluginId}
        installedPlugins={plugins}
        onConfirmInstall={onZipUpload}
      />

      {changelogModalPlugin && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="text-indigo-600" size={20} />
                <h3 className="text-base font-bold text-gray-900">
                  {changelogModalPlugin.name} {lang === 'zh' ? '版本更新说明' : 'Release Notes'}
                </h3>
              </div>
              <button
                onClick={() => setChangelogModalPlugin(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex items-center justify-between bg-indigo-50/70 border border-indigo-100 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold bg-white text-gray-600 px-2 py-0.5 rounded border border-gray-200">
                  v{changelogModalPlugin.version || '1.1.0'}
                </span>
                <span className="text-indigo-400 font-bold">➔</span>
                <span className="text-xs font-mono font-bold bg-indigo-600 text-white px-2 py-0.5 rounded shadow-sm">
                  v{changelogModalPlugin.marketItem?.latestVersion || '1.2.0'}
                </span>
              </div>
              {changelogModalPlugin.marketItem?.repository && (
                <a
                  href={changelogModalPlugin.marketItem.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-mono text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  <Github size={12} />
                  <span>Git Repo</span>
                  <ExternalLink size={10} />
                </a>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                {lang === 'zh' ? '新特性与优化变更清单 (Changelog)' : 'What\'s New'}
              </h4>
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs text-slate-700 leading-relaxed font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                {changelogModalPlugin.marketItem?.changelog || (lang === 'zh' ? '1. 阶段式任务逻辑与自动化测试增强\n2. 前端轻量化与高可用平滑升级' : '1. General enhancements and bug fixes')}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={() => setChangelogModalPlugin(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '稍后再说' : 'Later'}
              </button>
              <button
                onClick={() => {
                  const targetId = changelogModalPlugin.id;
                  const mItem = changelogModalPlugin.marketItem;
                  setChangelogModalPlugin(null);
                  handleOneClickUpdate(targetId, mItem);
                }}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>🚀 {lang === 'zh' ? '立即一键热更新' : 'Update Now'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {updateToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900/90 backdrop-blur text-white text-xs font-medium px-4 py-3 rounded-xl shadow-2xl border border-gray-700/80 flex items-center gap-2">
          <RefreshCw size={14} className="text-indigo-400 animate-spin" />
          <span>{updateToast}</span>
        </div>
      )}
    </>
  );
}
