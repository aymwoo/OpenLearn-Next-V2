import React from 'react';
import {
  Blocks,
  Shield,
  Users,
  Github,
  RefreshCw,
  FileText,
  Settings,
  MoreHorizontal,
  Calendar,
  Upload,
  Trash2,
} from 'lucide-react';
import { LegacyPluginBadge } from '../../LegacyPluginBadge';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import type { PluginType } from '../types';
import type { Language } from '../../../i18n';
import { sanitizeHref } from '../../../../packages/core/security/url-safety.js';
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
  onDelete,
}: PluginStorePanelProps) {
  const dashboardVisibilityMap = usePluginHostStore((s) => s.dashboardVisibility);
  const [openMenuPluginId, setOpenMenuPluginId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest('.plugin-action-menu')) {
        setOpenMenuPluginId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
              description: '扩展 Openlearn Next 功能的自定义插件。',
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
                manifestInfo.repository =
                  typeof parsed.repository === 'string' ? parsed.repository : parsed.repository.url || '';
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
              ? new Date(plugin.created_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              : '—';

            const compactInstallDate = plugin.created_at
              ? (() => {
                  const d = new Date(plugin.created_at);
                  if (isNaN(d.getTime())) return '—';
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  return `${y}-${m}-${day}`;
                })()
              : '—';

            const isSystem = plugin.id.startsWith('@openlearn/');
            const dashboardVisible = dashboardVisibilityMap.get(plugin.id) ?? true;
            const marketItem = marketMap.get(manifestInfo.manifestId || plugin.id);
            const hasUpdate = Boolean(marketItem?.hasUpdate);
            const updateError = marketItem?.error || null;
            const isMenuOpen = openMenuPluginId === plugin.id;

            const hasMenuItems =
              Boolean(manifestInfo.hasConfig) ||
              Boolean(manifestInfo.updateSource) ||
              hasUpdate ||
              !isSystem ||
              plugin.execution_mode === 'legacy';

            return (
              <div
                key={plugin.id}
                className={`bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-all relative group flex flex-col gap-3 h-full ${
                  plugin.status !== 'active' ? 'opacity-75' : ''
                }`}
              >
                {/* 1. Top Meta Bar: 架构环境徽章 (左) 与 运行状态/新版本标签 (右) */}
                <div className="flex items-center justify-between gap-1.5 w-full text-xs min-h-[22px]">
                  {/* 左侧架构环境标签 */}
                  <div className="flex items-center gap-1 flex-wrap min-w-0">
                    {isSystem && (
                      <span className="text-[10px] font-bold bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">
                        {lang === 'zh' ? '系统' : 'SYSTEM'}
                      </span>
                    )}
                    {plugin.execution_mode === 'esm' && (
                      <span className="text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-150 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">
                        ESM
                      </span>
                    )}
                    {(plugin as any).execution_mode === 'legacy' && <LegacyPluginBadge lang={lang} />}
                    {plugin.isolation_mode === 'process' && (
                      <span className="text-[10px] font-bold bg-sky-50 text-sky-800 border border-sky-200 px-1.5 py-0.5 rounded shrink-0">
                        {lang === 'zh' ? '子进程' : 'PROCESS'}
                      </span>
                    )}
                    {plugin.isolation_mode === 'worker' && (
                      <span className="text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded shrink-0">
                        Worker
                      </span>
                    )}
                    {plugin.isolation_mode === 'inline' && (
                      <span className="text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">
                        {lang === 'zh' ? '进程内' : 'IN-PROCESS'}
                      </span>
                    )}
                  </div>

                  {/* 右侧状态与升级标签 */}
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    {hasUpdate && (
                      <span
                        title={
                          lang === 'zh'
                            ? `点击查看新特性${marketItem.isPrerelease ? '（预发布版本）' : ''}并升级至 v${marketItem.latestVersion}`
                            : `Upgradeable to v${marketItem.latestVersion}${marketItem.isPrerelease ? ' (pre-release)' : ''}`
                        }
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1 shrink-0 cursor-pointer ${
                          marketItem.isPrerelease
                            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white animate-pulse'
                            : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white animate-pulse'
                        }`}
                        onClick={() => setChangelogModalPlugin({ ...plugin, marketItem })}
                      >
                        <span>
                          {marketItem.isPrerelease ? '🔶 ' : '⚡ '}
                          {lang === 'zh'
                            ? `${marketItem.isPrerelease ? '预发布 ' : '新版本 '}v${marketItem.latestVersion}`
                            : `${marketItem.isPrerelease ? 'Pre-release ' : 'New '}v${marketItem.latestVersion}`}
                        </span>
                      </span>
                    )}
                    {updateError && !hasUpdate && (
                      <span
                        title={updateError}
                        className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0 cursor-default"
                      >
                        <span>⚠️ {lang === 'zh' ? '检查失败' : 'Check failed'}</span>
                      </span>
                    )}
                    <span
                      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 border transition-all shrink-0 ${
                        plugin.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${plugin.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}
                      />
                      <span>
                        {plugin.status === 'active'
                          ? lang === 'zh'
                            ? '已启用'
                            : 'ACTIVE'
                          : lang === 'zh'
                            ? '已停用'
                            : 'INACTIVE'}
                      </span>
                    </span>
                  </div>
                </div>

                {/* 2. Title & ID Bar: 图标与名称完整独占整行宽，彻底杜绝遮挡 */}
                <div className="flex items-start gap-3 w-full">
                  <div className="w-11 h-11 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center border border-indigo-100 group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0">
                    <Blocks size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold text-gray-900 line-clamp-1" title={plugin.name}>
                        {plugin.name}
                      </h4>
                      {manifestInfo.version && (
                        <span className="text-xs font-mono font-bold bg-gray-100 text-gray-500 border border-gray-200 px-1.5 py-0.5 rounded shrink-0">
                          v{manifestInfo.version}
                        </span>
                      )}
                    </div>
                    {manifestInfo.manifestId && (
                      <p className="text-xs text-gray-400 font-mono truncate mt-0.5" title={manifestInfo.manifestId}>
                        {manifestInfo.manifestId}
                      </p>
                    )}
                  </div>
                </div>

                {/* 3. Description */}
                <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{manifestInfo.description}</p>

                {/* 4. Contribution points */}
                {(manifestInfo.toolCount > 0 ||
                  manifestInfo.studentViewCount > 0 ||
                  manifestInfo.teacherWidgetCount > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {manifestInfo.toolCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                        {lang === 'zh'
                          ? `${manifestInfo.toolCount} 个课堂工具`
                          : `${manifestInfo.toolCount} classroom tool${manifestInfo.toolCount > 1 ? 's' : ''}`}
                      </span>
                    )}
                    {manifestInfo.studentViewCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium bg-sky-50 text-sky-600 border border-sky-100 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                        {lang === 'zh'
                          ? `${manifestInfo.studentViewCount} 个学生视图`
                          : `${manifestInfo.studentViewCount} student view${manifestInfo.studentViewCount > 1 ? 's' : ''}`}
                      </span>
                    )}
                    {manifestInfo.teacherWidgetCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-50 text-amber-600 border border-amber-100 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        {lang === 'zh'
                          ? `${manifestInfo.teacherWidgetCount} 个教师组件`
                          : `${manifestInfo.teacherWidgetCount} teacher widget${manifestInfo.teacherWidgetCount > 1 ? 's' : ''}`}
                      </span>
                    )}
                    {manifestInfo.capabilities.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium bg-rose-50 text-rose-600 border border-rose-100 px-2 py-0.5 rounded-full">
                        <Shield size={9} />
                        {lang === 'zh'
                          ? `${manifestInfo.capabilities.length} 项权限`
                          : `${manifestInfo.capabilities.length} permission${manifestInfo.capabilities.length > 1 ? 's' : ''}`}
                      </span>
                    )}
                  </div>
                )}

                {/* 5. Footer metadata: 单行 nowrap 紧凑排布，两端对齐绝不折行 */}
                <div className="mt-auto flex flex-col gap-2.5 pt-1">
                  <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-2 gap-2 whitespace-nowrap overflow-hidden">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                      <span className="flex items-center gap-1 min-w-0 truncate" title={manifestInfo.author}>
                        <Users size={11} className="shrink-0 text-gray-400" />
                        <span className="truncate">{manifestInfo.author}</span>
                      </span>
                      {sanitizeHref(manifestInfo.repository || manifestInfo.homepage || marketItem?.repository) && (
                        <a
                          href={
                            sanitizeHref(
                              manifestInfo.repository || manifestInfo.homepage || marketItem?.repository,
                            ) as string
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          title={lang === 'zh' ? '查看 Git 开源仓库 (GitHub/Gitee)' : 'View Git Repository'}
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-1.5 py-0.5 rounded border border-indigo-200/60 transition-colors shrink-0"
                        >
                          <Github size={10} />
                          <span className="truncate max-w-[90px]">
                            {(manifestInfo.repository || manifestInfo.homepage || marketItem?.repository).replace(
                              /^https?:\/\//,
                              '',
                            )}
                          </span>
                        </a>
                      )}
                    </div>
                    <span
                      className="flex items-center gap-1 shrink-0 ml-auto font-mono text-[11px] text-gray-400"
                      title={lang === 'zh' ? `安装于: ${installDate}` : `Installed: ${installDate}`}
                    >
                      <Calendar size={11} className="shrink-0 text-gray-400" />
                      <span>{compactInstallDate}</span>
                    </span>
                  </div>

                  {/* 6. Action buttons: 主次分级，单行纯净排布 */}
                  <div className="flex items-center gap-1.5 relative min-h-[30px]">
                    {/* 启用 / 禁用 主开关 */}
                    <button
                      onClick={() => onToggle(plugin.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0 ${
                        plugin.status === 'active'
                          ? 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                          : 'bg-green-50 text-green-600 hover:bg-green-100'
                      }`}
                    >
                      {plugin.status === 'active'
                        ? lang === 'zh'
                          ? '禁用'
                          : 'Disable'
                        : lang === 'zh'
                          ? '启用'
                          : 'Enable'}
                    </button>

                    {/* 总览 开关 */}
                    <button
                      onClick={() => {
                        const next = !dashboardVisible;
                        usePluginHostStore.getState().setDashboardVisibility(plugin.id, next);
                      }}
                      title={
                        dashboardVisible
                          ? lang === 'zh'
                            ? '在系统总览中隐藏'
                            : 'Hide from Dashboard'
                          : lang === 'zh'
                            ? '在系统总览中显示'
                            : 'Show in Dashboard'
                      }
                      className={`px-2 py-1 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                        dashboardVisible
                          ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/60'
                          : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200/60'
                      }`}
                    >
                      <span>{lang === 'zh' ? '总览' : 'Dash'}</span>
                      <span
                        className={`w-6 h-3.5 rounded-full transition-colors flex items-center p-0.5 shrink-0 ${
                          dashboardVisible ? 'bg-indigo-600' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-transform ${
                            dashboardVisible ? 'translate-x-2.5' : 'translate-x-0'
                          }`}
                        />
                      </span>
                    </button>

                    {/* 快捷一键更新（仅在发现新版本时显式呈现） */}
                    {hasUpdate && (
                      <button
                        onClick={() => handleOneClickUpdate(plugin.id, marketItem)}
                        disabled={oneClickUpdatingId === plugin.id}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-sm transition-all flex items-center gap-1 shrink-0 disabled:opacity-50 cursor-pointer"
                        title={
                          lang === 'zh'
                            ? `热更新至 v${marketItem.latestVersion}`
                            : `Update to v${marketItem.latestVersion}`
                        }
                      >
                        {oneClickUpdatingId === plugin.id ? (
                          <RefreshCw size={11} className="animate-spin" />
                        ) : (
                          <span>⚡ {lang === 'zh' ? '更新' : 'Update'}</span>
                        )}
                      </button>
                    )}

                    {/* 更多操作下拉菜单 (···) */}
                    {hasMenuItems && (
                      <div className="relative plugin-action-menu shrink-0 ml-auto">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuPluginId(isMenuOpen ? null : plugin.id);
                          }}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer flex items-center justify-center ${
                            isMenuOpen
                              ? 'bg-gray-200 text-gray-800 border-gray-300'
                              : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200'
                          }`}
                          title={lang === 'zh' ? '更多操作' : 'More actions'}
                          aria-label={lang === 'zh' ? '更多操作' : 'More actions'}
                        >
                          <MoreHorizontal size={14} />
                        </button>

                        {isMenuOpen && (
                          <div className="absolute right-0 bottom-full mb-1.5 w-40 bg-white border border-gray-200 rounded-xl shadow-xl py-1 z-30 text-xs animate-in fade-in zoom-in-95 duration-100">
                            {manifestInfo.hasConfig && (
                              <button
                                onClick={() => {
                                  setOpenMenuPluginId(null);
                                  setSettingsPlugin({ id: plugin.id, name: plugin.name, manifest: plugin.manifest });
                                }}
                                className="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors cursor-pointer"
                              >
                                <Settings size={13} className="text-gray-500" />
                                <span>{lang === 'zh' ? '插件设置' : 'Settings'}</span>
                              </button>
                            )}

                            {manifestInfo.updateSource && (
                              <button
                                onClick={() => {
                                  setOpenMenuPluginId(null);
                                  handleCheckUpdate(plugin.id, manifestInfo.manifestId || plugin.id);
                                }}
                                disabled={checkingUpdateId === plugin.id}
                                className="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                              >
                                <RefreshCw
                                  size={13}
                                  className={`text-gray-500 ${checkingUpdateId === plugin.id ? 'animate-spin' : ''}`}
                                />
                                <span>{lang === 'zh' ? '检查更新' : 'Check for updates'}</span>
                              </button>
                            )}

                            {hasUpdate && (
                              <button
                                onClick={() => {
                                  setOpenMenuPluginId(null);
                                  setChangelogModalPlugin({ ...plugin, marketItem });
                                }}
                                className="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors cursor-pointer"
                              >
                                <FileText size={13} className="text-indigo-500" />
                                <span>{lang === 'zh' ? '版本新特性' : 'Release Notes'}</span>
                              </button>
                            )}

                            {!isSystem && (
                              <button
                                onClick={() => {
                                  setOpenMenuPluginId(null);
                                  setUpdateTargetPluginId(plugin.id);
                                  updateFileInputRef.current?.click();
                                }}
                                className="w-full text-left px-3 py-1.5 text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors cursor-pointer"
                              >
                                <Upload size={13} className="text-gray-500" />
                                <span>{lang === 'zh' ? '上传更新包' : 'Upload Update'}</span>
                              </button>
                            )}

                            {plugin.execution_mode === 'legacy' && (
                              <button
                                onClick={() => {
                                  setOpenMenuPluginId(null);
                                  document.getElementById('zip-plugin-uploader')?.click();
                                }}
                                className="w-full text-left px-3 py-1.5 text-amber-700 hover:bg-amber-50 flex items-center gap-2 transition-colors cursor-pointer"
                              >
                                <RefreshCw size={13} className="text-amber-600" />
                                <span>{lang === 'zh' ? '迁移格式' : 'Migrate'}</span>
                              </button>
                            )}

                            {!isSystem && (
                              <>
                                <div className="border-t border-gray-100 my-1" />
                                <button
                                  onClick={() => {
                                    setOpenMenuPluginId(null);
                                    onDelete(plugin.id);
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                  <Trash2 size={13} className="text-red-500" />
                                  <span>{lang === 'zh' ? '卸载插件' : 'Uninstall'}</span>
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
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
