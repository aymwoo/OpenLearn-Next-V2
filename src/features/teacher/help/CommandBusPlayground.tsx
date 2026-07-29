import React, { useState } from 'react';
import {
  Terminal,
  Blocks,
  BookOpen,
  Users,
  Folder,
  Wand2,
  Puzzle,
  ShieldAlert,
  ChevronRight,
  Activity,
  Loader2,
  PlayCircle,
  CheckCircle2,
  X
} from 'lucide-react';
import { generateInitialPayload, getCommandCategory } from './helpUtils';

export interface CommandBusPlaygroundProps {
  registeredCommands: any[];
  onRefresh: () => void;
}

export const CommandBusPlayground: React.FC<CommandBusPlaygroundProps> = ({
  registeredCommands,
  onRefresh
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'vfs' | 'edu' | 'mgmt' | 'proc' | 'ai' | 'plugin'>('all');
  const [expandedCommandId, setExpandedCommandId] = useState<string | null>(null);
  const [commandPayloads, setCommandPayloads] = useState<Record<string, string>>({});
  const [executionResults, setExecutionResults] = useState<Record<string, { success: boolean; data?: any; error?: string; loading?: boolean }>>({});

  const categories = [
    { id: 'all', name: '全部命令', icon: Blocks },
    { id: 'edu', name: '教学与画板', icon: BookOpen },
    { id: 'mgmt', name: '班级与学生', icon: Users },
    { id: 'vfs', name: '虚拟文件系统', icon: Folder },
    { id: 'proc', name: '进程控制', icon: Terminal },
    { id: 'ai', name: 'AI 规划生成', icon: Wand2 },
    { id: 'plugin', name: '第三方插件', icon: Puzzle }
  ];

  const filteredCommands = registeredCommands.filter(cmd => {
    const matchesCategory = selectedCategory === 'all' || getCommandCategory(cmd.commandType) === selectedCategory;
    const matchesSearch = search === '' ||
      cmd.commandType.toLowerCase().includes(search.toLowerCase()) ||
      (cmd.description && cmd.description.toLowerCase().includes(search.toLowerCase())) ||
      cmd.id.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleExecute = async (commandType: string, cmdId: string) => {
    setExecutionResults(prev => ({ ...prev, [cmdId]: { success: false, loading: true } }));
    try {
      const rawPayload = commandPayloads[cmdId] || '{}';
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(rawPayload);
      } catch (e: any) {
        setExecutionResults(prev => ({
          ...prev,
          [cmdId]: { success: false, error: `JSON 语法解析错误: ${e.message}`, loading: false }
        }));
        return;
      }

      const res = await fetch('/api/commands/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandType, payload: parsedPayload })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setExecutionResults(prev => ({ ...prev, [cmdId]: { success: true, data: data.result, loading: false } }));
        onRefresh();
      } else {
        setExecutionResults(prev => ({ ...prev, [cmdId]: { success: false, error: data.error || '执行命令失败', loading: false } }));
      }
    } catch (err: any) {
      setExecutionResults(prev => ({ ...prev, [cmdId]: { success: false, error: err.message, loading: false } }));
    }
  };

  return (
    <>
      <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-4 shrink-0 col-span-1">
        <div className="relative">
          <Terminal className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input 
            type="text"
            placeholder="通过命令类型、描述或 Action ID 搜索活跃指令..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {categories.map(cat => {
            const CatIcon = cat.icon;
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id as any)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  isActive 
                    ? 'bg-indigo-600 text-white shadow shadow-indigo-200 scale-102 font-bold' 
                    : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300'
                }`}
              >
                <CatIcon size={13} />
                <span>{cat.name}</span>
                {cat.id === 'all' ? (
                  <span className={`ml-1 text-[10px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-indigo-700/80 text-white' : 'bg-gray-100 text-gray-500'}`}>{registeredCommands.length}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
        {filteredCommands.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-400">
            <ShieldAlert size={48} className="text-gray-300 mb-4 animate-pulse" />
            <h3 className="font-semibold text-gray-700">没有找到匹配的指令</h3>
            <p className="text-xs text-gray-500 mt-1">请尝试清空查询条件或检查当前的插件状态</p>
          </div>
        ) : (
          <div className="space-y-4 max-w-5xl mx-auto">
            {filteredCommands.map(cmd => {
              const isExpanded = expandedCommandId === cmd.id;
              const cat = getCommandCategory(cmd.commandType);
              const isHighRisk = cmd.isHighRisk;

              if (commandPayloads[cmd.id] === undefined) {
                commandPayloads[cmd.id] = generateInitialPayload(cmd.inputSchema);
              }

              const execResult = executionResults[cmd.id];

              return (
                <div 
                  key={cmd.id}
                  className={`bg-white rounded-xl border transition-all duration-200 overflow-hidden shadow-sm hover:shadow ${
                    isExpanded ? 'border-indigo-400 ring-1 ring-indigo-100' : isHighRisk ? 'border-orange-200 hover:border-orange-300' : 'border-gray-200 hover:border-indigo-200'
                  }`}
                >
                  <div 
                    onClick={() => {
                      setExpandedCommandId(isExpanded ? null : cmd.id);
                    }}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-gray-50/30 transition-colors select-none"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg shrink-0 ${
                        isHighRisk ? 'bg-orange-50 text-orange-600' : 'bg-indigo-50 text-indigo-600'
                      }`}>
                        {cat === 'vfs' ? <Folder size={18} /> : 
                         cat === 'edu' ? <BookOpen size={18} /> :
                         cat === 'mgmt' ? <Users size={18} /> :
                         cat === 'proc' ? <Terminal size={18} /> :
                         cat === 'ai' ? <Wand2 size={18} /> : <Puzzle size={18} />}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-sm bg-gray-100 text-gray-800 px-2 py-0.5 rounded border border-gray-200">
                            {cmd.commandType}
                          </span>
                          {isHighRisk && (
                            <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 rounded font-extrabold px-1.5 py-0.5 uppercase tracking-wide flex items-center gap-0.5">
                              ⚠️ 高风险操作
                            </span>
                          )}
                          <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2 py-0.5">
                            🔒 {cmd.capabilityRequired || '无公开权限'}
                          </span>
                        </div>
                        <p className="text-gray-600 text-xs mt-1.5 font-medium line-clamp-1">{cmd.description}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <span className="text-[10px] text-gray-400 font-mono hidden md:inline">ID: {cmd.id}</span>
                      <button 
                        className={`text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded-lg font-semibold border hover:bg-gray-200 transition-all flex items-center gap-1 ${
                          isExpanded ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : ''
                        }`}
                      >
                        {isExpanded ? '折叠面板' : '交互调试 Shell'}
                        <ChevronRight size={12} className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50/50 p-5 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-white rounded-lg border border-gray-200 p-4">
                          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-gray-100 pb-2">
                            <Activity size={12} className="text-gray-400" />
                            入参规范 (JSON Schema Definition)
                          </h4>
                          
                          {cmd.inputSchema?.properties ? (
                            <div className="space-y-3 font-mono text-[11px]">
                              {Object.keys(cmd.inputSchema.properties).map(propName => {
                                const prop = cmd.inputSchema.properties[propName];
                                const isRequired = cmd.inputSchema.required?.includes(propName);
                                return (
                                  <div key={propName} className="flex flex-col gap-1 border-b border-gray-50 last:border-b-0 pb-1.5">
                                    <div className="flex items-baseline gap-1.5">
                                      <span className="text-indigo-600 font-semibold">{propName}</span>
                                      <span className="text-gray-400 text-[10px]">({prop.type})</span>
                                      {isRequired && (
                                        <span className="text-red-500 text-[9px] font-bold bg-red-50 border border-red-100 rounded px-1">REQUIRED</span>
                                      )}
                                    </div>
                                    {prop.description && (
                                      <span className="text-gray-500 font-sans leading-relaxed text-xs">{prop.description}</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400 italic">该命令不需要接收任何入参负载 (Payload)。</p>
                          )}
                        </div>

                        <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col">
                          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-gray-100 pb-2 justify-between">
                            <span className="flex items-center gap-1.5">
                              <Terminal size={12} className="text-gray-400" />
                              Payload 调试区
                            </span>
                            <button 
                              onClick={() => {
                                setCommandPayloads(prev => ({
                                  ...prev,
                                  [cmd.id]: generateInitialPayload(cmd.inputSchema)
                                }));
                              }}
                              className="text-[9px] text-indigo-600 hover:underline hover:text-indigo-800 uppercase tracking-wider"
                            >
                              恢复默认模版
                            </button>
                          </h4>

                          <label className="text-[10px] font-semibold text-gray-400 block mb-1">Payload JSON:</label>
                          <textarea
                            value={commandPayloads[cmd.id] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCommandPayloads(prev => ({ ...prev, [cmd.id]: val }));
                            }}
                            rows={6}
                            className="w-full font-mono text-[11px] p-2.5 bg-gray-900 text-indigo-300 border border-gray-800 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none leading-relaxed flex-1 shadow-inner"
                          />

                          <div className="mt-3 flex justify-end">
                            <button
                              onClick={() => handleExecute(cmd.commandType, cmd.id)}
                              disabled={execResult?.loading}
                              className={`px-4 py-2 text-xs font-bold font-sans text-white hover:shadow-md active:scale-95 transition-all flex items-center gap-1.5 rounded-lg ${
                                isHighRisk 
                                  ? 'bg-red-600 hover:bg-red-700' 
                                  : 'bg-indigo-600 hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500'
                              } disabled:opacity-50`}
                            >
                              {execResult?.loading ? (
                                <>
                                  <Loader2 size={13} className="animate-spin" />
                                  <span>内核正在调度总线...</span>
                                </>
                              ) : (
                                <>
                                  <PlayCircle size={13} />
                                  <span>提交执行指令 (Deploy Command)</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {execResult && (
                        <div className={`p-4 rounded-xl border flex flex-col font-mono text-[11px] leading-relaxed relative ${
                          execResult.loading 
                            ? 'bg-gray-50 border-gray-200' 
                            : execResult.success 
                              ? 'bg-green-50/50 border-green-200 text-green-900' 
                              : 'bg-red-50/50 border-red-200 text-red-900'
                        }`}>
                          <div className="absolute top-2 right-3 uppercase text-[10px] font-bold text-gray-400">
                            Console Output log
                          </div>
                          
                          <div className="font-bold flex items-center gap-1.5 mb-1 bg-transparent border-0 p-0 text-xs text-neutral-800">
                            {execResult.loading ? (
                              <span className="text-gray-500">⏳ COMMAND QUEUED...</span>
                            ) : execResult.success ? (
                              <span className="text-green-700 flex items-center gap-1"><CheckCircle2 size={14} /> STATUS: 200 SUCCESS (Action Completed)</span>
                            ) : (
                              <span className="text-red-700 flex items-center gap-1"><X size={14} /> STATUS: 500 INTERNAL_BUS_ERROR</span>
                            )}
                          </div>

                          {!execResult.loading && (
                            <pre className="mt-2 p-3 bg-gray-900/95 text-gray-200 rounded-lg overflow-x-auto border border-gray-800 shadow-inner max-h-56 select-all font-mono">
                              {execResult.success 
                                ? JSON.stringify(execResult.data, null, 2)
                                : execResult.error
                              }
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};
