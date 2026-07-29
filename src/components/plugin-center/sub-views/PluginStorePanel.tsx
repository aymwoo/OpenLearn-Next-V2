import React from 'react';
import {
  Blocks,
  Shield,
  Users,
  Github,
  RefreshCw,
  FileText,
  Settings
} from 'lucide-react';
import { LegacyPluginBadge } from '../../LegacyPluginBadge';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import type { PluginType } from '../types';
import type { Language } from '../../../i18n';

export interface PluginStorePanelProps {
  plugins: PluginType[];
  lang: Language;
  showSystemPlugins: boolean;
  marketMap: Map<string, any>;
  checkingUpdateId: string | null;
  oneClickUpdatingId: string | null;
  handleCheckUpdate: (pluginId: string, manifestId: string) => Promise<void>;
  handleOneClickUpdate: (pluginId: string, marketItem?: any) => Promise<void>;
  setChangelogModalPlugin: (plugin: any) => void;
  setSettingsPlugin: (plugin: { id: string; name: string; manifest: string } | null) => void;
  setUpdateTargetPluginId: (id: string | null) => void;
  updateFileInputRef: React.RefObject<HTMLInputElement | null>;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

export function PluginStorePanel({
  plugins,
  lang,
  showSystemPlugins,
  marketMap,
  checkingUpdateId,
  oneClickUpdatingId,
  handleCheckUpdate,
  handleOneClickUpdate,
  setChangelogModalPlugin,
  setSettingsPlugin,
  setUpdateTargetPluginId,
  updateFileInputRef,
  onToggle,
  onDelete
}: PluginStorePanelProps) {
  const dashboardVisibilityMap = usePluginHostStore((s) => s.dashboardVisibility);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
      <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-4 gap-4">
        {plugins
          .filter((p) => {
            const isSystem = p.id.startsWith('@openlearn/');
            return showSystemPlugins ? true : !isSystem;
          })
          .map((plugin) => {
            let manifestInfo: {
              description: string;
              author: string;
              version: string;
              manifestId: string;
              capabilities: string[];
              toolCount: number;
              studentViewCount: number;
              teacherWidgetCount: number;
              hasConfig: boolean;
              repository: string;
              homepage: string;
              updateSource?: { type: string; repo: string };
            } = {
              description: '扩展 Edu OS 功能的自定义插件。',
              author: 'Community',
              version: '',
              manifestId: '',
              capabilities: [],
              toolCount: 0,
              studentViewCount: 0,
              teacherWidgetCount: 0,
              hasConfig: false,
              repository: '',
              homepage: '',
            };
            try {
              const parsed = JSON.parse(plugin.manifest);
              if (parsed.description) manifestInfo.description = parsed.description;
              if (parsed.author) manifestInfo.author = parsed.author;
              if (parsed.version) manifestInfo.version = parsed.version;
              if (parsed.id) manifestInfo.manifestId = parsed.id;
              if (parsed.repository) {
                manifestInfo.repository = typeof parsed.repository === 'string' ? parsed.repository : (parsed.repository.url || '');
              }
              if (parsed.homepage) manifestInfo.homepage = parsed.homepage;
              if (parsed.capabilitiesProposed) manifestInfo.capabilities = parsed.capabilitiesProposed;
              if (parsed.contributes?.['classroom.tool']) {
                manifestInfo.toolCount = parsed.contributes['classroom.tool'].length;
              } else if (parsed.classroomTools) {
                manifestInfo.toolCount = parsed.classroomTools.length;
              }
              if (parsed.contributes?.['student.view']) {
                manifestInfo.studentViewCount = parsed.contributes['student.view'].length;
              }
              if (parsed.contributes?.['teacher.dashboard.widget']) {
                manifestInfo.teacherWidgetCount = parsed.contributes['teacher.dashboard.widget'].length;
              }
              const props = parsed.configuration?.properties;
              if (props && Object.keys(props).length > 0) {
                manifestInfo.hasConfig = true;
              }
              if (parsed.updateSource?.type && parsed.updateSource?.repo) {
                manifestInfo.updateSource = parsed.updateSource;
              }
            } catch (e) {
              // ignore parse error
            }

            const installDate = plugin.created_at
              ? new Date(plugin.created_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })
              : '—';

            const isSystem = plugin.id.startsWith('@openlearn/');
            const dashboardVisible = dashboardVisibilityMap.get(plugin.id) ?? true;
            const marketItem = marketMap.get(manifestInfo.manifestId || plugin.id);
            const hasUpdate = Boolean(marketItem?.hasUpdate);
            const updateError = marketItem?.error || null;

            return (
              <div
                key={plugin.id}
                className={`bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all relative overflow-hidden group flex flex-col gap-3 h-full ${
                  plugin.status !== 'active' ? 'opacity-75' : ''
                }`}
              >
                {/* Status & type badges */}
                <div className="absolute top-0 right-0 p-3 flex items-center gap-1.5 flex-wrap justify-end">
                  {hasUpdate && (
                    <span
                      title={lang === 'zh'
                        ? `点击查看新特性${marketItem.isPrerelease ? '（预发布版本）' : ''}并升级至 v${marketItem.latestVersion}`
                        : `Upgradeable to v${marketItem.latestVersion}${marketItem.isPrerelease ? ' (pre-release)' : ''}`}
                      className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-sm flex items-center gap-1 shrink-0 cursor-pointer ${
                        marketItem.isPrerelease
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white animate-pulse'
                          : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white animate-pulse'
                      }`}
                      onClick={() => setChangelogModalPlugin({ ...plugin, marketItem })}
                    >
                      <span>
                        {marketItem.isPrerelease ? '🔶 ' : '⚡ '}
                        {lang === 'zh'
                          ? `${marketItem.isPrerelease ? '预发布 ' : '发现新版本 '}v${marketItem.latestVersion}`
                          : `${marketItem.isPrerelease ? 'Pre-release ' : 'New '}v${marketItem.latestVersion}`}
                      </span>
                    </span>
                  )}
                  {updateError && !hasUpdate && (
                    <span
                      title={updateError}
                      className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 cursor-default"
                    >
                      <span>⚠️ {lang === 'zh' ? '检查失败' : 'Check failed'}</span>
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 border transition-all ${
                      plugin.status === 'active'
                        ? 'bg-emerald-50 text-emerald-750 border-emerald-250'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${plugin.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                    <span>
                      {plugin.status === 'active'
                        ? (lang === 'zh' ? '已启用' : 'ACTIVE')
                        : (lang === 'zh' ? '已停用' : 'INACTIVE')
                      }
                    </span>
                  </span>
                  {plugin.execution_mode === 'esm' && (
                    <span className="text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-150 px-1.5 py-0.5 rounded uppercase tracking-wider">
                      ESM
                    </span>
                  )}
                  {(plugin as any).execution_mode === 'legacy' && (
                    <LegacyPluginBadge lang={lang} />
                  )}
                  {isSystem && (
                    <span className="text-[10px] font-bold bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded uppercase tracking-wider">
                      {lang === 'zh' ? '系统' : 'SYSTEM'}
                    </span>
                  )}
                </div>

                {/* Icon + name */}
                <div className="flex items-start gap-3 pr-24">
                  <div className="w-11 h-11 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center border border-indigo-100 group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0">
                    <Blocks size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold text-gray-900 line-clamp-1">{plugin.name}</h4>
                      {manifestInfo.version && (
                        <span className="text-[10px] font-mono font-bold bg-gray-100 text-gray-500 border border-gray-200 px-1.5 py-0.5 rounded shrink-0">
                          v{manifestInfo.version}
                        </span>
                      )}
                    </div>
                    {manifestInfo.manifestId && (
                      <p className="text-[10px] text-gray-400 font-mono truncate mt-0.5" title={manifestInfo.manifestId}>
                        {manifestInfo.manifestId}
                      </p>
                    )}
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                  {manifestInfo.description}
                </p>

                {/* Contribution points */}
                {(manifestInfo.toolCount > 0 || manifestInfo.studentViewCount > 0 || manifestInfo.teacherWidgetCount > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {manifestInfo.toolCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                        {lang === 'zh' ? `${manifestInfo.toolCount} 个课堂工具` : `${manifestInfo.toolCount} classroom tool${manifestInfo.toolCount > 1 ? 's' : ''}`}
                      </span>
                    )}
                    {manifestInfo.studentViewCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-sky-50 text-sky-600 border border-sky-100 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                        {lang === 'zh' ? `${manifestInfo.studentViewCount} 个学生视图` : `${manifestInfo.studentViewCount} student view${manifestInfo.studentViewCount > 1 ? 's' : ''}`}
                      </span>
                    )}
                    {manifestInfo.teacherWidgetCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-100 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        {lang === 'zh' ? `${manifestInfo.teacherWidgetCount} 个教师组件` : `${manifestInfo.teacherWidgetCount} teacher widget${manifestInfo.teacherWidgetCount > 1 ? 's' : ''}`}
                      </span>
                    )}
                    {manifestInfo.capabilities.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-rose-50 text-rose-600 border border-rose-100 px-2 py-0.5 rounded-full">
                        <Shield size={9} />
                        {lang === 'zh' ? `${manifestInfo.capabilities.length} 项权限` : `${manifestInfo.capabilities.length} permission${manifestInfo.capabilities.length > 1 ? 's' : ''}`}
                      </span>
                    )}
                  </div>
                )}

                {/* Footer metadata & actions */}
                <div className="mt-auto flex flex-col gap-3 pt-1">
                  <div className="flex items-center justify-between text-[10px] text-gray-400 border-t border-gray-100 pt-2 gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex items-center gap-1 min-w-0">
                        <Users size={10} className="shrink-0 text-gray-400" />
                        <span className="truncate">{manifestInfo.author}</span>
                      </span>
                      {(manifestInfo.repository || manifestInfo.homepage || marketItem?.repository) && (
                        <a
                          href={manifestInfo.repository || manifestInfo.homepage || marketItem?.repository}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={lang === 'zh' ? '查看 Git 开源仓库 (GitHub/Gitee)' : 'View Git Repository'}
                          className="inline-flex items-center gap-1 text-[10px] font-mono text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-1.5 py-0.5 rounded border border-indigo-200/60 transition-colors shrink-0"
                        >
                          <Github size={10} />
                          <span className="truncate max-w-[130px]">
                            {(manifestInfo.repository || manifestInfo.homepage || marketItem?.repository).replace(/^https?:\/\//, '')}
                          </span>
                        </a>
                      )}
                    </div>
                    <span className="flex items-center gap-1 shrink-0 ml-auto">
                      <span>{lang === 'zh' ? '安装于' : 'Installed'}</span>
                      <span className="font-mono">{installDate}</span>
                    </span>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5 flex-wrap min-h-[34px]">
                    {manifestInfo.updateSource && (
                      <button
                        onClick={() => handleCheckUpdate(plugin.id, manifestInfo.manifestId || plugin.id)}
                        disabled={checkingUpdateId === plugin.id}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                          hasUpdate
                            ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                            : updateError
                            ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                            : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                        }`}
                        title={lang === 'zh' ? '手动检查远端更新' : 'Check for updates'}
                      >
                        {checkingUpdateId === plugin.id ? (
                          <RefreshCw size={12} className="animate-spin" />
                        ) : (
                          <RefreshCw size={12} />
                        )}
                        <span>{lang === 'zh' ? '检查更新' : 'Check'}</span>
                      </button>
                    )}
                    {hasUpdate ? (
                      <>
                        <button
                          onClick={() => handleOneClickUpdate(plugin.id, marketItem)}
                          disabled={oneClickUpdatingId === plugin.id}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                        >
                          {oneClickUpdatingId === plugin.id ? (
                            <RefreshCw size={12} className="animate-spin" />
                          ) : (
                            <span>🚀 {lang === 'zh' ? `一键热更新 v${marketItem.latestVersion}` : `Update v${marketItem.latestVersion}`}</span>
                          )}
                        </button>
                        <button
                          onClick={() => setChangelogModalPlugin({ ...plugin, marketItem })}
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/60 transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <FileText size={12} />
                          <span>{lang === 'zh' ? '新特性' : 'Notes'}</span>
                        </button>
                      </>
                    ) : null}
                    <button
                      onClick={() => onToggle(plugin.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        plugin.status === 'active'
                          ? 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                          : 'bg-green-50 text-green-600 hover:bg-green-100'
                      }`}
                    >
                      {plugin.status === 'active'
                        ? lang === 'zh' ? '禁用' : 'Disable'
                        : lang === 'zh' ? '启用' : 'Enable'}
                    </button>
                    <button
                      onClick={() => {
                        const next = !dashboardVisible;
                        usePluginHostStore.getState().setDashboardVisibility(plugin.id, next);
                      }}
                      title={dashboardVisible
                        ? (lang === 'zh' ? '在系统总览中隐藏' : 'Hide from Dashboard')
                        : (lang === 'zh' ? '在系统总览中显示' : 'Show in Dashboard')
                      }
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                        dashboardVisible
                          ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/60'
                          : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200/60'
                      }`}
                    >
                      <span>{lang === 'zh' ? '总览' : 'Dash'}</span>
                      <span
                        className={`w-7 h-3.5 rounded-full transition-colors flex items-center p-0.5 shrink-0 ${
                          dashboardVisible ? 'bg-indigo-600' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-transform ${
                            dashboardVisible ? 'translate-x-3.5' : 'translate-x-0'
                          }`}
                        />
                      </span>
                    </button>
                    {manifestInfo.hasConfig && (
                      <button
                        onClick={() => setSettingsPlugin({ id: plugin.id, name: plugin.name, manifest: plugin.manifest })}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors flex items-center gap-1"
                      >
                        <Settings size={12} />
                        {lang === 'zh' ? '设置' : 'Settings'}
                      </button>
                    )}
                    {!isSystem && (
                      <>
                        <button
                          onClick={() => {
                            setUpdateTargetPluginId(plugin.id);
                            updateFileInputRef.current?.click();
                          }}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
                        >
                          {lang === 'zh' ? '更新' : 'Update'}
                        </button>
                        <button
                          onClick={() => onDelete(plugin.id)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                        >
                          {lang === 'zh' ? '删除' : 'Delete'}
                        </button>
                      </>
                    )}
                    {plugin.execution_mode === 'legacy' && (
                      <button
                        onClick={() => document.getElementById('zip-plugin-uploader')?.click()}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                        title={lang === 'zh' ? '上传新格式 ZIP 包以完成迁移' : 'Upload new-format ZIP package to migrate'}
                      >
                        {lang === 'zh' ? '迁移' : 'Migrate'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
