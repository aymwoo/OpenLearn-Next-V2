import React from 'react';
import { ShieldCheck, Database, Unplug, RefreshCw } from 'lucide-react';
import type { AdminDashboardCardSlotProps } from '../../../plugin-host/types';
import { useSmartEduStatus } from '../useSmartEduStatus';

/**
 * 管理后台国家平台接入看板 —— 全部指标来自真实来源：
 * - 网关状态/延迟/同步课程数：smart_edu.get_status 真实探测；
 * - 本地库容量：宿主注入的 sqliteStats。
 * 不再渲染任何硬编码指标（v0.6.0 审计 B-5：此前“3 门 / 100% / 16 ms”纯假数据）。
 */
export function SmartEduAdminCard({ sqliteStats, lang = 'zh' }: AdminDashboardCardSlotProps) {
  const { status, loading, refetch } = useSmartEduStatus(60_000);
  const zh = lang === 'zh';
  const configured = status?.configured ?? false;
  const connected = status?.connected ?? false;

  return (
    <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-5 shadow-lg relative overflow-hidden">
      <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />

      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">{zh ? '国家智慧教育公共服务平台 · 接入看板' : 'National Smart Education Gateway'}</h4>
            <p className="text-[11px] text-slate-400">{zh ? '数据网关真实连接状态' : 'Live gateway connection status'}</p>
          </div>
        </div>

        <span
          className={`px-2 py-0.5 text-[10px] font-bold border rounded-full flex items-center gap-1 ${
            !configured
              ? 'bg-slate-500/20 text-slate-300 border-slate-500/40'
              : connected
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                : 'bg-rose-500/20 text-rose-400 border-rose-500/40'
          }`}
        >
          {!configured ? (
            <>
              <Unplug className="w-3 h-3" />
              {zh ? '未配置' : 'Not configured'}
            </>
          ) : connected ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {zh ? '已连通' : 'Connected'}
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              {zh ? '离线' : 'Offline'}
            </>
          )}
        </span>
      </div>

      {!configured ? (
        <div className="mt-4 bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-[11px] text-slate-400 leading-relaxed">
          {zh ? (
            <>
              尚未配置国家平台数据网关。请在服务端 <code className="text-amber-300">.env</code> 中设置{' '}
              <code className="text-amber-300">SMARTEDU_API_BASE</code>（可选{' '}
              <code className="text-amber-300">SMARTEDU_APP_KEY</code> /{' '}
              <code className="text-amber-300">SMARTEDU_APP_SECRET</code>）后重启服务。
            </>
          ) : (
            <>
              Gateway not configured. Set <code className="text-amber-300">SMARTEDU_API_BASE</code> (optional{' '}
              <code className="text-amber-300">SMARTEDU_APP_KEY</code> /{' '}
              <code className="text-amber-300">SMARTEDU_APP_SECRET</code>) in the server .env and restart.
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="text-[11px] text-slate-400">{zh ? '已同步课程' : 'Synced courses'}</div>
            <div className="text-lg font-bold text-amber-400 mt-1">{status?.syncedCoursesCount ?? 0} 门</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{zh ? '本地国家平台认证课程' : 'locally certified'}</div>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="text-[11px] text-slate-400">{zh ? '网关延迟' : 'Gateway RTT'}</div>
            <div className={`text-lg font-bold mt-1 ${connected ? 'text-cyan-400' : 'text-slate-500'}`}>
              {connected && status?.rttMs != null ? `${Math.round(status.rttMs)} ms` : '—'}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">{zh ? '真实探测往返' : 'measured round-trip'}</div>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div className="text-[11px] text-slate-400">{zh ? '本地库状态' : 'Local database'}</div>
            <div className="text-sm font-bold text-emerald-400 mt-1 flex items-center gap-1">
              <Database className="w-4 h-4" />
              {sqliteStats?.status === 'connected' ? (zh ? '正常' : 'OK') : (zh ? '未知' : 'Unknown')}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">{sqliteStats?.diskUsageFriendly || '—'}</div>
          </div>
        </div>
      )}

      {configured && (
        <button
          onClick={() => void refetch()}
          className="mt-3 w-full py-1.5 text-[11px] text-slate-400 hover:text-white border border-slate-800 hover:border-slate-600 rounded-lg flex items-center justify-center gap-1 transition"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {zh ? '重新探测网关' : 'Re-probe gateway'}
        </button>
      )}
    </div>
  );
}
