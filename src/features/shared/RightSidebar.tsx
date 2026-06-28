import React, { useRef, useEffect } from 'react';
import { Wand2, Terminal, PanelRightClose, ChevronDown, MessageSquare, FileText, X, Paperclip } from 'lucide-react';

interface RightSidebarProps {
  showRightSidebar: boolean;
  setShowRightSidebar: (v: boolean) => void;
  rightSidebarTab: 'agent' | 'shell';
  setRightSidebarTab: (t: 'agent' | 'shell') => void;
  effectiveAgentProviderId: string;
  agentProviderId: string;
  setAgentProviderId: (id: string) => void;
  aiProviders: any[];
  selectedAgentProvider: any | null;
  chatLog: { role: string; content: string }[];
  loading: boolean;
  input: string;
  setInput: (v: string) => void;
  handleSend: (e: React.FormEvent) => Promise<void>;
  chatAttachments: { name: string; content: string }[];
  setChatAttachments: React.Dispatch<React.SetStateAction<{ name: string; content: string }[]>>;
  handleChatFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleChatDrop: (e: React.DragEvent) => void;
  events: any[];
  lang: string;
  t: Record<string, string>;
}

export function RightSidebar({
  showRightSidebar, setShowRightSidebar,
  rightSidebarTab, setRightSidebarTab,
  effectiveAgentProviderId, agentProviderId, setAgentProviderId,
  aiProviders, selectedAgentProvider,
  chatLog, loading, input, setInput, handleSend,
  chatAttachments, setChatAttachments,
  handleChatFileChange, handleChatDrop,
  events, lang, t,
}: RightSidebarProps) {
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog]);

  return (
    <div className={`transition-all duration-300 bg-white border-l border-gray-200 flex flex-col shadow-xl relative z-30 shrink-0 ${showRightSidebar ? 'w-96' : 'w-12 items-center cursor-pointer hover:bg-gray-50'}`}>
      {showRightSidebar ? (
        <>
          <div className="flex bg-gray-100 p-1 m-4 rounded-lg shrink-0">
             <button
               onClick={() => setRightSidebarTab('agent')}
               className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${rightSidebarTab === 'agent' ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
             >
               <Wand2 size={14} /> Agent
             </button>
             <button
               onClick={() => setRightSidebarTab('shell')}
               className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 ${rightSidebarTab === 'shell' ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
             >
               <Terminal size={14} /> Shell
             </button>
             <button onClick={() => setShowRightSidebar(false)} className="ml-1 p-1.5 text-gray-400 hover:text-gray-600 rounded-md">
               <PanelRightClose size={14} />
             </button>
          </div>

          {rightSidebarTab === 'agent' ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 border-b border-gray-100 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                      <Wand2 size={16} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-semibold text-gray-900 text-sm">{t.agentTitle}</h2>
                      <p className="text-[10px] text-gray-500">{t.agentSubtitle}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 min-w-[150px] max-w-[50%]">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                      {lang === 'zh' ? 'AI 提供商' : 'AI Provider'}
                    </span>
                    <div className="relative w-full">
                      <select
                        value={effectiveAgentProviderId}
                        onChange={(e) => setAgentProviderId(e.target.value)}
                        className="w-full appearance-none rounded-xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 px-3 py-2 pr-9 text-[11px] font-medium text-gray-700 shadow-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      >
                        <option value="system">{lang === 'zh' ? '系统默认（Gemini）' : 'System Default (Gemini)'}</option>
                        {aiProviders.map((provider) => (
                          <option key={provider.id} value={provider.id}>{provider.name}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    </div>
                    <div className="text-[10px] text-gray-400 truncate w-full text-right" title={effectiveAgentProviderId === 'system' ? (lang === 'zh' ? '使用内置 Gemini 系统模型' : 'Using the built-in Gemini system model') : selectedAgentProvider?.model_name || ''}>
                      {effectiveAgentProviderId === 'system'
                        ? (lang === 'zh' ? '内置系统模型' : 'Built-in system model')
                        : `${selectedAgentProvider?.name || (lang === 'zh' ? '已选提供商' : 'Selected provider')}`}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {chatLog.map((msg, i) => (
                  <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`px-4 py-2.5 rounded-2xl max-w-[85%] text-xs whitespace-pre-wrap ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'}`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex items-start">
                    <div className="px-4 py-2.5 rounded-2xl max-w-[85%] text-xs bg-gray-100 text-gray-500 rounded-bl-none flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{animationDelay: '0.1s'}}></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{animationDelay: '0.2s'}}></span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form
                onSubmit={handleSend}
                className="p-3 border-t border-gray-100 bg-white shrink-0 font-sans"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleChatDrop}
              >
                {chatAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2 px-1">
                    {chatAttachments.map((f, i) => (
                      <div key={i} className="flex items-center gap-1 bg-indigo-50 border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-[10px]">
                        <FileText size={10} className="shrink-0" />
                        <span className="truncate max-w-[100px]" title={f.name}>{f.name}</span>
                        <button
                          type="button"
                          onClick={() => setChatAttachments(prev => prev.filter((_, idx) => idx !== i))}
                          className="hover:bg-indigo-200 rounded-full p-0.5 cursor-pointer ml-0.5 transition-colors text-indigo-400 hover:text-indigo-600"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <label className="p-1 px-1.5 text-gray-500 hover:text-indigo-600 rounded-full hover:bg-gray-100 cursor-pointer transition-colors shrink-0">
                    <Paperclip size={14} />
                    <input type="file" multiple className="hidden" onChange={handleChatFileChange} accept=".csv,.txt,.json,.md" />
                  </label>
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      placeholder={t.placeholder}
                      className="w-full bg-gray-50 border border-gray-200 rounded-full pl-4 pr-10 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    />
                    <button
                      type="submit"
                      disabled={loading || !input.trim()}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      <MessageSquare size={10} />
                    </button>
                  </div>
                </div>
              </form>
            </div>
          ) : (
            <div className="flex-1 flex flex-col bg-black text-green-400 font-mono text-[10px] min-h-0 mx-4 mb-4 rounded-xl shadow-inner border border-gray-800 overflow-hidden">
              <div className="p-3 border-b border-gray-800 flex items-center justify-between shrink-0 bg-gray-900">
                <div className="flex items-center gap-2 text-gray-300 font-sans tracking-wide">
                  <Terminal size={14} />
                  <span className="text-xs">{t.eventStream}</span>
                </div>
              </div>
              <div className="p-3 overflow-y-auto flex-1 flex flex-col gap-1 select-text">
                {events.length === 0 ? (
                  <div className="text-gray-600 italic">Waiting for events...</div>
                ) : (
                  events.map((ev, i) => (
                    <div key={i} className="flex flex-col gap-1 hover:bg-gray-800/50 p-2 rounded mb-1">
                      <div className="flex items-center gap-2 justify-between">
                        <span className="text-gray-500 shrink-0 text-[9px]">[{new Date(ev.timestamp).toLocaleTimeString()}]</span>
                        <span className="text-blue-400 shrink-0 truncate text-[9px]" title={ev.source}>{ev.source}</span>
                      </div>
                      <div className="text-green-300 font-bold">{ev.type}</div>
                      <div className="text-gray-400 break-words mt-1 leading-tight">{ev.payload}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center py-6 h-full text-gray-400 w-full" onClick={() => setShowRightSidebar(true)}>
          <Wand2 size={18} className="mb-6 hover:text-indigo-500" />
          <Terminal size={18} className="hover:text-indigo-500" />
          <div className="mt-8 flex-1 flex flex-col justify-end pb-8">
            <div className="uppercase tracking-widest text-[9px] rotate-180" style={{ writingMode: 'vertical-rl' }}>OS Core Options</div>
          </div>
        </div>
      )}
    </div>
  );
}
