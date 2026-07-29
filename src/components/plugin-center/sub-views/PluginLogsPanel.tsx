import React from 'react';
import { Loader2 } from 'lucide-react';
import type { Language } from '../../types';

export function PluginLogsPanel({ lang }: { lang: Language }) {
  const [logs, setLogs] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [autoRefresh, setAutoRefresh] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [levelFilter, setLevelFilter] = React.useState('');
  const [componentFilter, setComponentFilter] = React.useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let url = '/api/admin/logs?limit=300';
      if (levelFilter) url += `&level=${levelFilter}`;
      if (componentFilter) url += `&component=${componentFilter}`;
      
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs || []);
      }
    } catch (e) {
      console.error('Error fetching logs:', e);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchLogs();
  }, [levelFilter, componentFilter]);

  React.useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      let url = '/api/admin/logs?limit=300';
      if (levelFilter) url += `&level=${levelFilter}`;
      if (componentFilter) url += `&component=${componentFilter}`;
      fetch(url)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setLogs(data.logs || []);
          }
        })
        .catch(e => console.error(e));
    }, 3000);
    return () => clearInterval(timer);
  }, [autoRefresh, levelFilter, componentFilter]);

  const components = React.useMemo(() => {
    const set = new Set<string>();
    logs.forEach(log => {
      if (log.component) set.add(log.component);
    });
    return Array.from(set);
  }, [logs]);

  const filteredLogs = React.useMemo(() => {
    if (!search) return logs;
    const query = search.toLowerCase();
    return logs.filter(log => {
      const msg = (log.msg || '').toLowerCase();
      const comp = (log.component || '').toLowerCase();
      return msg.includes(query) || comp.includes(query);
    });
  }, [logs, search]);

  const levelColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-rose-500 font-semibold';
      case 'warn': return 'text-amber-500 font-semibold';
      case 'debug': return 'text-blue-400';
      default: return 'text-emerald-400';
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 bg-slate-900 text-slate-100 font-mono text-sm overflow-hidden h-full min-h-[500px]">
      <div className="flex flex-wrap gap-4 items-center justify-between border-b border-slate-800 pb-4 shrink-0 font-sans">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder={lang === 'zh' ? '搜索日志内容...' : 'Search logs...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg focus:outline-none focus:border-indigo-500 placeholder-slate-500 text-xs w-48"
          />
          <select
            value={levelFilter}
            onChange={e => setLevelFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg focus:outline-none focus:border-indigo-500 text-xs"
          >
            <option value="">{lang === 'zh' ? '所有级别' : 'All Levels'}</option>
            <option value="info">INFO</option>
            <option value="warn">WARN</option>
            <option value="error">ERROR</option>
            <option value="debug">DEBUG</option>
          </select>
          <select
            value={componentFilter}
            onChange={e => setComponentFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg focus:outline-none focus:border-indigo-500 text-xs max-w-48"
          >
            <option value="">{lang === 'zh' ? '所有组件' : 'All Components'}</option>
            {components.map(comp => (
              <option key={comp} value={comp}>{comp}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-400 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-0 focus:ring-offset-0"
            />
            {lang === 'zh' ? '自动刷新 (3s)' : 'Auto-refresh (3s)'}
          </label>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="bg-slate-800 hover:bg-slate-700 active:bg-slate-750 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : null}
            {lang === 'zh' ? '刷新' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto mt-4 p-4 bg-slate-950 border border-slate-800 rounded-xl flex flex-col gap-1.5 min-h-0 select-text">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            {lang === 'zh' ? '暂无匹配的运行日志数据' : 'No logs found.'}
          </div>
        ) : (
          filteredLogs.map((log, idx) => (
            <div key={idx} className="flex gap-3 text-xs leading-relaxed hover:bg-slate-900/60 p-1 rounded transition-colors">
              <span className="text-slate-500 shrink-0 select-none">
                {new Date(log.timestamp || Date.now()).toLocaleTimeString()}
              </span>
              <span className={`uppercase font-bold w-12 shrink-0 ${levelColor(log.level)}`}>
                {log.level || 'info'}
              </span>
              <span className="text-indigo-400 shrink-0 font-semibold w-24 truncate" title={log.component}>
                [{log.component || 'system'}]
              </span>
              <span className="text-slate-200 flex-1 break-all whitespace-pre-wrap">
                {log.msg}
                {log.meta && Object.keys(log.meta).length > 0 && (
                  <span className="text-slate-500 ml-2 font-mono text-[11px]">
                    {JSON.stringify(log.meta)}
                  </span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
