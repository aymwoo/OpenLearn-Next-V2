import React from 'react';
import {
  ShieldAlert,
  Loader2,
  CheckCircle2,
  Upload,
  Wand2,
  Sparkles,
  Shield,
  PenTool,
  Eye,
  Users,
  Database,
  Terminal,
  Puzzle
} from 'lucide-react';
import type { Language, PluginType } from '../types';
import { parsePluginSource, DEFAULT_PLUGIN } from '../utils/pluginCenterUtils';
import { CAPABILITY_INFO } from '../types';

export interface PluginDevPanelProps {
  lang: Language;
  pluginCode: string;
  setPluginCode: (code: string) => void;
  plugins: PluginType[];
  installingPlugin: boolean;
  onInstall: () => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  setUpdateTargetPluginId: (id: string | null) => void;
  updateFileInputRef: React.RefObject<HTMLInputElement | null>;
  setStoreTab: (tab: 'store' | 'widgets' | 'dev' | 'logs') => void;
  handleZipDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  zipError: string | null;
  setZipError: (err: string | null) => void;
  zipPreview: { name: string; id: string; version: string } | null;
  setZipPreview: (preview: any) => void;
  zipProcessing: boolean;
  hasLegacyPlugins: boolean;
  dismissMigration: boolean;
  MigrationPromptBanner: React.FC;
}

export function PluginDevPanel({
  lang,
  pluginCode,
  setPluginCode,
  plugins,
  installingPlugin,
  onInstall,
  onToggle,
  onDelete,
  setUpdateTargetPluginId,
  updateFileInputRef,
  setStoreTab,
  handleZipDrop,
  zipError,
  setZipError,
  zipPreview,
  setZipPreview,
  zipProcessing,
  hasLegacyPlugins,
  dismissMigration,
  MigrationPromptBanner
}: PluginDevPanelProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
      <div className="p-4 bg-gray-900 border-b border-gray-800 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-amber-400" />
          <div>
            <p className="text-xs font-semibold text-gray-200">
              {lang === 'zh'
                ? '开发者工具: 插件旁路加载与实时 Manifest 校验'
                : 'Developer Tools: Plugin Sideloading & Real-time Manifest Validation'}
            </p>
            <p className="text-[10px] text-gray-505">
              {lang === 'zh'
                ? '在安装前系统将进行解析、安全授权与注册接口预览机制'
                : 'Parse metadata, proposed permissions, and registered triggers before installation'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase font-bold rounded-lg cursor-pointer transition-all ${
              zipError
                ? 'border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                : zipPreview
                  ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  : zipProcessing
                    ? 'border border-indigo-500/30 bg-indigo-500/10 text-indigo-400'
                    : 'border border-dashed border-gray-600 text-gray-400 hover:text-white hover:border-indigo-400 hover:bg-indigo-500/10'
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add('border-indigo-400', 'bg-indigo-50/50');
            }}
            onDragLeave={(e) => {
              e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/50');
            }}
            onDrop={handleZipDrop}
            onClick={() => {
              setZipError(null);
              setZipPreview(null);
              document.getElementById('zip-plugin-uploader')?.click();
            }}
          >
            {zipProcessing ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                <span>{lang === 'zh' ? '分析中...' : 'Analyzing...'}</span>
              </>
            ) : zipPreview ? (
              <>
                <CheckCircle2 size={11} />
                <span className="max-w-[100px] truncate">{zipPreview.name}</span>
              </>
            ) : zipError ? (
              <>
                <ShieldAlert size={11} />
                <span>{lang === 'zh' ? '重试' : 'Retry'}</span>
              </>
            ) : (
              <>
                <Upload size={11} />
                <span>{lang === 'zh' ? '拖拽安装' : 'Drop ZIP'}</span>
              </>
            )}
          </div>
          <button
            onClick={() => setPluginCode(DEFAULT_PLUGIN)}
            className="px-2.5 py-1 text-[10px] uppercase font-bold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
            title="Reset to default example"
          >
            <Wand2 size={11} className="text-indigo-450" />
            {lang === 'zh' ? '示例：智能测验生成器' : 'Quiz Sample'}
          </button>
        </div>
      </div>

      {hasLegacyPlugins && !dismissMigration && (
        <div className="px-4 pt-4 bg-gray-950">
          <MigrationPromptBanner />
        </div>
      )}

      {/* Split layout */}
      <div className="flex-1 flex overflow-hidden min-h-0 bg-gray-950">
        {/* Left Column: Code Editor */}
        <div className="w-7/12 flex flex-col border-r border-gray-800 h-full p-4 min-h-0">
          <div className="flex justify-between items-center mb-1 text-[10px] uppercase font-bold text-gray-400 select-none shrink-0">
            <span>
              {lang === 'zh'
                ? '⚙️ 插件主程序 JS 源代码'
                : '⚙️ Plugin Source Code (JavaScript)'}
            </span>
            <span className="font-mono text-[9px] text-gray-500">
              Node Sandbox Ready
            </span>
          </div>
          <textarea
            value={pluginCode}
            onChange={(e) => setPluginCode(e.target.value)}
            className="w-full flex-1 font-mono text-[11px] p-4 bg-gray-900 border border-gray-800 text-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none leading-relaxed overflow-y-auto"
          />
        </div>

        {/* Right Column: Manifest Verification & Live Preview */}
        <div className="w-5/12 flex flex-col bg-gray-900/40 p-4 h-full overflow-y-auto min-h-0">
          <div className="mb-3">
            <div className="text-[10px] uppercase font-bold text-gray-400 select-none mb-1.5 flex justify-between items-center">
              <span>
                {lang === 'zh'
                  ? '🔍 MANIFEST 实时解析与权限审计'
                  : '🔍 Manifest Extraction & Audit'}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-400 border border-indigo-900 font-mono">
                Live Static
              </span>
            </div>

            {(() => {
              const parsed = parsePluginSource(pluginCode);
              const hasManifest =
                parsed && parsed.manifest && parsed.manifest.id && parsed.manifest.name;

              return (
                <div className="space-y-3.5">
                  <div
                    className={`p-3 rounded-lg border flex items-start gap-2 ${
                      hasManifest
                        ? 'bg-emerald-950/45 border-emerald-800/60 text-emerald-300'
                        : 'bg-amber-955/40 border-amber-800/60 text-amber-300'
                    }`}
                  >
                    {hasManifest ? (
                      <>
                        <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <h5 className="text-xs font-bold font-sans">
                            {lang === 'zh'
                              ? '✓ Manifest 静态合法性验证通过'
                              : '✓ Manifest Validation Passed'}
                          </h5>
                          <p className="text-[10px] text-emerald-400/80 mt-0.5 leading-tight">
                            {lang === 'zh'
                              ? '检测到完整的插件标识。可在安全白名单和命令总线中顺利完成挂载。'
                              : 'Completed identifier extraction. Secure initialization is ready to deploy.'}
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <h5 className="text-xs font-bold font-sans">
                            {lang === 'zh'
                              ? '⚠️ 未匹配到有效 Manifest 描述符'
                              : '⚠️ Searching for valid Metadata'}
                          </h5>
                          <p className="text-[10px] text-amber-400/80 mt-0.5 leading-tight">
                            {lang === 'zh'
                              ? '请在代码段中指定完整的 manifest 包含 id、name 属性，系统才能自动进行预览与权限挂载。'
                              : 'Please provide manifest object inside exports.default with unique id/name properties to active automatic registration.'}
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {hasManifest && parsed && parsed.manifest && (
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3.5 space-y-2.5">
                      <div className="border-b border-gray-800 pb-2 flex justify-between items-center">
                        <h6 className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">
                          {lang === 'zh' ? '基本描述元数据' : 'Metadata Details'}
                        </h6>
                        <span className="text-[9px] text-indigo-400 font-mono px-1 bg-indigo-950 rounded">
                          v{parsed.manifest.version || '1.0.0'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                        <div className="text-gray-500">{lang === 'zh' ? '名称:' : 'Name:'}</div>
                        <div className="col-span-2 text-gray-200 font-sans font-semibold">
                          {parsed.manifest.name}
                        </div>
                        <div className="text-gray-500">{lang === 'zh' ? '唯一标识:' : 'UUID/ID:'}</div>
                        <div className="col-span-2 text-gray-305">{parsed.manifest.id}</div>
                        <div className="text-gray-500">{lang === 'zh' ? '开发者:' : 'Author:'}</div>
                        <div className="col-span-2 text-indigo-305">{parsed.manifest.author || 'Community'}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="mt-5 bg-gray-900 border border-gray-800 rounded-xl p-3.5 space-y-3 shrink-0">
            <h6 className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider pb-1.5 border-b border-gray-800 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Puzzle size={11} className="text-indigo-400 animate-pulse" />
                <span>{lang === 'zh' ? `已加载插件管理 (${plugins.length})` : `Active Plugins (${plugins.length})`}</span>
              </span>
              <button 
                onClick={() => setStoreTab('store')} 
                className="text-[9px] text-gray-500 hover:text-indigo-400 transition-colors uppercase tracking-wider font-semibold"
              >
                {lang === 'zh' ? '管理大图 ➔' : 'View Grid ➔'}
              </button>
            </h6>
            
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {plugins.length === 0 ? (
                <div className="text-[10px] text-gray-550 italic py-2 text-center">
                  {lang === 'zh' ? '暂无安装的插件' : 'No plugins sideloaded.'}
                </div>
              ) : (
                plugins.map((plugin) => (
                  <div key={plugin.id} className="p-2.5 bg-gray-950 border border-gray-900 rounded-lg flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-bold text-gray-200 truncate">{plugin.name}</span>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${plugin.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
                      </div>
                      <span className="text-[10px] text-gray-500 font-mono block truncate select-all">{plugin.id}</span>
                    </div>
                    
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => onToggle(plugin.id)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded transition-colors ${
                          plugin.status === 'active'
                            ? 'bg-amber-950/60 border border-amber-900/50 text-amber-400 hover:bg-amber-900/80'
                            : 'bg-emerald-950/60 border border-emerald-900/50 text-emerald-400 hover:bg-emerald-900/80'
                        }`}
                      >
                        {plugin.status === 'active' ? (lang === 'zh' ? '禁用' : 'Disable') : (lang === 'zh' ? '启用' : 'Enable')}
                      </button>
                      {!plugin.id.startsWith('@openlearn/') && (
                        <>
                          <button
                            onClick={() => {
                              setUpdateTargetPluginId(plugin.id);
                              updateFileInputRef.current?.click();
                            }}
                            className="px-2 py-1 text-[10px] font-bold bg-sky-950/60 border border-sky-900/50 text-sky-300 hover:bg-sky-900/80 rounded transition-colors"
                          >
                            {lang === 'zh' ? '更新' : 'Update'}
                          </button>
                          <button
                            onClick={() => onDelete(plugin.id)}
                            className="px-2 py-1 text-[10px] font-bold bg-red-950/60 border border-red-900/50 text-red-400 hover:bg-red-900/80 rounded transition-colors"
                          >
                            {lang === 'zh' ? '删除' : 'Delete'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Control actions footer */}
      <div className="p-4 border-t border-gray-800 bg-gray-950 flex justify-between items-center shrink-0 select-none">
        <span className="text-[10px] text-gray-500 font-mono">
          Secure Sideload Mode &bull; Sandbox Integrity Check
        </span>
        <div className="flex justify-end gap-3">
          <button
            onClick={onInstall}
            disabled={installingPlugin || !pluginCode.trim()}
            className="px-4 py-2 text-xs bg-indigo-600 font-bold hover:bg-indigo-700 text-white rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 hover:shadow-lg active:scale-97 cursor-pointer"
          >
            {installingPlugin ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                <span>{lang === 'zh' ? '集成挂载中...' : 'Registering...'}</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={13} />
                <span>{lang === 'zh' ? '部署并安装到课堂内核' : 'Deploy & Install Plugin'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
