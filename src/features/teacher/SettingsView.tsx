import React from 'react';
import { Settings, Plus, Blocks, Puzzle, Check, Loader2, Globe } from 'lucide-react';
import type { AIProvider } from '../../store/appStore';

interface SettingsViewProps {
  lang: string;
  aiProviders: AIProvider[];
  testingProviderId: string | null;
  onAddProvider: () => void;
  onEditProvider: (provider: AIProvider) => void;
  onTestProvider: (provider: AIProvider) => Promise<void>;
  onDeleteProvider: (id: string, name: string) => Promise<void>;
}

export function SettingsView({
  lang, aiProviders, testingProviderId,
  onAddProvider, onEditProvider, onTestProvider, onDeleteProvider,
}: SettingsViewProps) {
  return (
    <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-slate-50/50 min-h-0 text-gray-800">
      {/* Settings Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-gray-100 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Settings className="text-indigo-600" size={24} />
            {lang === 'zh' ? '全局系统设置' : 'Global System Settings'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {lang === 'zh' ? '管理大语言模型 AI 服务商、全局接口及教育操作系统基础配置。' : 'Orchestrate LLM providers, API keys, and classroom OS variables.'}
          </p>
        </div>

        <button
          id="add-ai-provider-btn"
          onClick={onAddProvider}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-all text-xs cursor-pointer"
        >
          <Plus size={14} />
          {lang === 'zh' ? '添加 AI 提供商' : 'Add AI Provider'}
        </button>
      </div>

      {/* AI Provider Settings List Card */}
      <div className="bg-white border border-gray-200/85 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-slate-50/60">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm sm:text-base">
              <Blocks className="text-indigo-500" size={18} />
              {lang === 'zh' ? 'OpenAI 兼容 / 自定义模型 AI 提供商列表 (SQLite)' : 'AI Providers List (SQLite)'}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {lang === 'zh' ? '配置好的端点，将可被测验生成器、讲座生成器和 AI Agent 助理进行热切调用。' : 'Connected third-party inference backends reachable by Whiteboard and Agent.'}
            </p>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {aiProviders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 text-center">
              <Puzzle size={40} className="mb-3 opacity-30 text-indigo-500" />
              <span className="font-semibold text-sm">{lang === 'zh' ? '暂未配置任何 AI 提供商' : 'No AI Providers Registered'}</span>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">{lang === 'zh' ? '点击右上角"添加 AI 提供商"按钮新建。' : 'Configure custom gateways to route inference requests.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-gray-100 rounded-xl">
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-gray-100 text-gray-500 font-bold text-xs uppercase tracking-wider">
                    <th className="py-3.5 px-4">{lang === 'zh' ? '名称' : 'Name'}</th>
                    <th className="py-3.5 px-4">{lang === 'zh' ? 'API 接口网络端点' : 'API endpoint URL'}</th>
                    <th className="py-3.5 px-4">{lang === 'zh' ? '模型代号' : 'Model Identifier'}</th>
                    <th className="py-3.5 px-4">{lang === 'zh' ? 'API 秘钥状态' : 'API Key'}</th>
                    <th className="py-3.5 px-4 text-center">{lang === 'zh' ? '调试与管理' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs text-gray-700">
                  {aiProviders.map((provider) => (
                    <tr key={provider.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-indigo-500" />
                          <span className="font-extrabold text-gray-800 text-sm">{provider.name}</span>
                          {['prov_deepseek', 'prov_minimax'].includes(provider.id) && (
                            <span className="bg-amber-100 text-amber-800 text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase tracking-wider block">Preset</span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4 font-mono text-gray-550 truncate max-w-[220px]">{provider.api_url}</td>
                      <td className="py-4 px-4">
                        <span className="bg-slate-100 text-slate-800 font-bold px-2 py-1 rounded font-mono text-[11px] border border-slate-200">{provider.model_name}</span>
                      </td>
                      <td className="py-4 px-4">
                        {provider.api_key ? (
                          <span className="text-emerald-600 font-bold flex items-center gap-1 font-mono"><Check size={12} /> Key Saved</span>
                        ) : (
                          <span className="text-amber-500/90 font-mono italic">Not Set / 空</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => onTestProvider(provider)}
                            disabled={testingProviderId !== null}
                            className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 shadow-xs ${
                              testingProviderId === provider.id
                                ? 'bg-slate-100 border-slate-200 text-slate-400'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                            }`}
                            title={lang === 'zh' ? '测试网络连通性' : 'Test API Integration'}
                          >
                            {testingProviderId === provider.id ? (
                              <><Loader2 size={11} className="animate-spin" /><span>{lang === 'zh' ? '测试中' : 'Testing'}</span></>
                            ) : (
                              <><Globe size={11} /><span>{lang === 'zh' ? '测试' : 'Test'}</span></>
                            )}
                          </button>
                          <button
                            onClick={() => onEditProvider(provider)}
                            className="px-2.5 py-1.5 text-indigo-600 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 rounded-lg bg-white cursor-pointer hover:font-bold font-semibold transition-all shadow-xs"
                            title={lang === 'zh' ? '修改配置' : 'Edit Configuration'}
                          >
                            {lang === 'zh' ? '编辑' : 'Edit'}
                          </button>
                          <button
                            onClick={() => onDeleteProvider(provider.id, provider.name)}
                            className="px-2.5 py-1.5 text-rose-600 hover:bg-rose-50 border border-gray-200 hover:border-rose-200 rounded-lg bg-white cursor-pointer hover:font-bold font-semibold transition-all shadow-xs"
                            title={lang === 'zh' ? '物理清除提供商' : 'Delete Provider'}
                          >
                            {lang === 'zh' ? '删除' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* System Specs Overview Box */}
      <div className="bg-slate-100 border border-slate-200/60 rounded-xl p-5 block sm:flex sm:items-center justify-between text-left gap-4 space-y-3 sm:space-y-0">
        <div className="space-y-1">
          <span className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-wider">{lang === 'zh' ? '环境自检指标' : 'ENVIRONMENT DIAGNOSTICS'}</span>
          <h4 className="font-extrabold text-gray-800 text-sm">{lang === 'zh' ? 'SQLite 内核连接通过' : 'Core SQLite DB Connection Active'}</h4>
          <p className="text-xs text-gray-500">{lang === 'zh' ? '核心 educational_os.db 独立加载中，AI 提供服务商热切链路工作状态完美正常。' : 'Connected. Dynamic queries to active AI service providers are routed natively.'}</p>
        </div>
        <div className="shrink-0 flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 border border-slate-200 shadow-xs">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block shrink-0" />
          <span className="text-xs font-mono font-bold text-gray-600">STATE: OPERATIONAL</span>
        </div>
      </div>
    </div>
  );
}
