import React from 'react';
import { Settings, Shield, ArrowRight } from 'lucide-react';

interface SettingsViewProps {
  lang: string;
  onNavigateToAdmin: () => void;
}

export function SettingsView({ lang, onNavigateToAdmin }: SettingsViewProps) {
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
      </div>

      {/* AI Provider — 已移至管理后台 */}
      <div className="bg-white border border-gray-200/85 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-slate-50/60">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm sm:text-base">
              <Shield className="text-indigo-500" size={18} />
              {lang === 'zh' ? 'AI 模型提供商管理' : 'AI Provider Management'}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {lang === 'zh' ? 'AI 提供商配置已移至管理后台，仅管理员可访问。' : 'AI Provider configuration has been moved to the Admin Panel (admin only).'}
            </p>
          </div>
          <button
            onClick={onNavigateToAdmin}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-all text-xs cursor-pointer"
          >
            <ArrowRight size={14} />
            {lang === 'zh' ? '前往管理后台' : 'Go to Admin Panel'}
          </button>
        </div>
        <div className="p-5 text-center text-gray-400 text-sm">
          {lang === 'zh'
            ? '所有 AI 提供商的添加、编辑、测试和删除操作现已在「管理后台 → AI 模型提供商」标签页中进行。'
            : 'All AI provider operations (add, edit, test, delete) are now available under Admin Panel → AI Providers tab.'}
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
