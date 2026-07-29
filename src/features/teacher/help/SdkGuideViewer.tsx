import React from 'react';
import {
  Puzzle,
  FileText,
  Terminal,
  Database,
  Search,
  Code,
  Check,
  Activity,
  Shield,
  Loader2
} from 'lucide-react';
import Markdown from 'react-markdown';

export interface SdkGuideViewerProps {
  pluginGuideMd: string;
  loadingMd: boolean;
  copiedId: string | null;
  handleCopy: (id: string, text: string) => void;
  pluginBoilerplateCode: string;
  pluginInteractiveCode: string;
  pluginExamCode: string;
}

export const SdkGuideViewer: React.FC<SdkGuideViewerProps> = ({
  pluginGuideMd,
  loadingMd,
  copiedId,
  handleCopy,
  pluginBoilerplateCode,
  pluginInteractiveCode,
  pluginExamCode
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Markdown Document if loaded */}
        {loadingMd ? (
          <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-gray-200">
            <Loader2 size={32} className="animate-spin text-indigo-600 mb-2" />
            <span className="text-xs text-gray-500 font-semibold">正在从服务器拉取 SDK 文档...</span>
          </div>
        ) : pluginGuideMd ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm prose prose-slate max-w-none text-xs leading-relaxed">
            <Markdown>{pluginGuideMd}</Markdown>
          </div>
        ) : null}

        {/* 顶部总揽 */}
        <div className="bg-white rounded-2xl border border-indigo-100 p-6 shadow-sm flex flex-col md:flex-row gap-5 items-start">
          <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl shrink-0">
            <Puzzle size={28} />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-bold text-gray-900">Edu-OS 插件开发指南 & API 参考</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              Edu-OS 基于 <span className="font-semibold text-indigo-600">CommandBus（命令总线）</span> + <span className="font-semibold text-indigo-600">EventBus（事件总线）</span> 微内核架构。
              插件通过标准 ESM 模块导出 <code className="bg-gray-100 text-rose-600 px-1 rounded text-[10px]">activate(ctx)</code> 函数接收 <span className="font-semibold">PluginContext</span>，
              进而访问 7 大内核服务。本页提供完整的 API 参考、参数说明和可运行示例。
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">🔄 DI 依赖注入</span>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-medium">🔒 能力安全模型</span>
              <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full font-medium">⚡ 热重载 + Worker 隔离</span>
              <span className="text-[10px] bg-rose-50 text-rose-700 border border-rose-100 px-2 py-0.5 rounded-full font-medium">📦 ESM + CommonJS 双格式</span>
              <span className="text-[10px] bg-sky-50 text-sky-700 border border-sky-100 px-2 py-0.5 rounded-full font-medium">🆔 别名生命周期 (Alias Lifecycle)</span>
              <span className="text-[10px] bg-teal-50 text-teal-700 border border-teal-100 px-2 py-0.5 rounded-full font-medium">🛡️ Worker Storage 安全隔离</span>
            </div>
          </div>
        </div>

        {/* 示例代码块 1 */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start gap-2">
              <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded"><Code size={16} /></div>
              <div>
                <h4 className="text-xs font-bold text-gray-900">示例 1：思维导图插件 — 注册 Action + 处理器 + 发布事件</h4>
                <p className="text-[10px] text-gray-500 mt-0.5">演示 ctx.services 解构、Action 注册、createCommand 创建信封、eventBus.publish 发布事件</p>
              </div>
            </div>
            <button onClick={() => handleCopy('tpl1', pluginBoilerplateCode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shrink-0 ${
                copiedId === 'tpl1' ? 'bg-emerald-50 text-emerald-700 border border-emerald-250' : 'bg-white text-indigo-600 border border-indigo-150 hover:bg-indigo-50'
              }`}>
              {copiedId === 'tpl1' ? <Check size={12} /> : <FileText size={12} />}
              <span>{copiedId === 'tpl1' ? '已复制！' : '复制代码'}</span>
            </button>
          </div>
          <pre className="text-xs font-mono p-5 bg-gray-950 text-gray-200 overflow-x-auto leading-relaxed max-h-[360px] shadow-inner select-all">{pluginBoilerplateCode}</pre>
        </div>

        {/* 示例代码块 2 */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start gap-2">
              <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded"><Code size={16} /></div>
              <div>
                <h4 className="text-xs font-bold text-gray-900">示例 2：AI 作业批改插件 — 演示 AI + 事件订阅 + 存储 + DI</h4>
                <p className="text-[10px] text-gray-500 mt-0.5">演示 ctx.resolve 获取数据库、services.ai 生成文本、services.storage 持久化、eventBus 订阅</p>
              </div>
            </div>
            <button onClick={() => handleCopy('tpl2', pluginInteractiveCode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shrink-0 ${
                copiedId === 'tpl2' ? 'bg-emerald-50 text-emerald-700 border border-emerald-250' : 'bg-white text-emerald-600 border border-emerald-150 hover:bg-emerald-50'
              }`}>
              {copiedId === 'tpl2' ? <Check size={12} /> : <FileText size={12} />}
              <span>{copiedId === 'tpl2' ? '已复制！' : '复制代码'}</span>
            </button>
          </div>
          <pre className="text-xs font-mono p-5 bg-gray-950 text-gray-200 overflow-x-auto leading-relaxed max-h-[360px] shadow-inner select-all">{pluginInteractiveCode}</pre>
        </div>

        {/* 示例代码块 3 */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start gap-2">
              <div className="p-1.5 bg-amber-50 text-amber-600 rounded"><Code size={16} /></div>
              <div>
                <h4 className="text-xs font-bold text-gray-900">示例 3：考试系统插件 — 演示 ctx.db 自建表 + deactivate 清理</h4>
                <p className="text-[10px] text-gray-500 mt-0.5">演示 ctx.db.ensureTable 建表、ctx.db.table 获取带前缀表名、deactivate 生命周期</p>
              </div>
            </div>
            <button onClick={() => handleCopy('tpl3', pluginExamCode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shrink-0 ${
                copiedId === 'tpl3' ? 'bg-emerald-50 text-emerald-700 border border-emerald-250' : 'bg-white text-amber-600 border border-amber-150 hover:bg-amber-50'
              }`}>
              {copiedId === 'tpl3' ? <Check size={12} /> : <FileText size={12} />}
              <span>{copiedId === 'tpl3' ? '已复制！' : '复制代码'}</span>
            </button>
          </div>
          <pre className="text-xs font-mono p-5 bg-gray-950 text-gray-200 overflow-x-auto leading-relaxed max-h-[360px] shadow-inner select-all">{pluginExamCode}</pre>
        </div>

      </div>
    </div>
  );
};
