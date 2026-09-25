import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Server, RefreshCw, CheckCircle2, ShieldAlert } from 'lucide-react';
import { edgeLanDetector } from './EdgeLanDetector';
import type { NetworkHealthState } from '../types';

export interface EdgeLanStatusIndicatorProps {
  className?: string;
  onRefreshManual?: () => void;
}

export function EdgeLanStatusIndicator({ className = '', onRefreshManual }: EdgeLanStatusIndicatorProps) {
  const [state, setState] = useState<NetworkHealthState>(edgeLanDetector.getState());
  const [showDetails, setShowDetails] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const unsubscribe = edgeLanDetector.subscribe((newState) => {
      setState(newState);
    });
    return () => unsubscribe();
  }, []);

  const handleManualCheck = async () => {
    setChecking(true);
    await edgeLanDetector.checkConnectivity();
    if (onRefreshManual) onRefreshManual();
    setTimeout(() => setChecking(false), 400);
  };

  const isOnline = state.mode === 'CLOUD_ONLINE';
  const isEdgeLan = state.mode === 'EDGE_LAN_ONLY';
  const isDisconnected = state.mode === 'OFFLINE_DISCONNECTED';

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      {/* 状态徽标胶囊 */}
      <button
        type="button"
        onClick={() => setShowDetails(!showDetails)}
        className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs ${
          isOnline
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
            : isEdgeLan
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40 animate-pulse hover:bg-amber-500/25'
              : 'bg-rose-500/15 text-rose-600 border-rose-500/30 hover:bg-rose-500/25'
        }`}
        title="点击查看网络与边缘局域网状态"
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isOnline ? 'bg-emerald-500' : isEdgeLan ? 'bg-amber-500' : 'bg-rose-500'
          }`}
        />
        {isOnline && <Wifi size={12} />}
        {isEdgeLan && <Server size={12} />}
        {isDisconnected && <WifiOff size={12} />}

        <span className="hidden sm:inline">
          {isOnline
            ? '云端在线'
            : isEdgeLan
              ? '局域网高可用模式'
              : '网络已断开'}
        </span>

        {isEdgeLan && state.bufferedOfflineEventsCount > 0 && (
          <span className="px-1 py-0.2 bg-amber-500/30 text-amber-900 dark:text-amber-200 rounded text-[9px] font-mono">
            {state.bufferedOfflineEventsCount} 待同步
          </span>
        )}
      </button>

      {/* 展开浮层 */}
      {showDetails && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-surface border border-theme rounded-2xl p-4 shadow-xl z-50 flex flex-col gap-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-theme pb-2">
            <span className="text-xs font-black text-main">网络拓扑与边缘节点监控</span>
            <button
              type="button"
              onClick={handleManualCheck}
              disabled={checking}
              className="text-muted hover:text-main p-1 rounded-lg hover:bg-surface-secondary cursor-pointer"
              title="立即检测网络连通性"
            >
              <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex flex-col gap-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted">当前运行模式</span>
              <span className="font-bold text-main">
                {isOnline ? '全功能云端在线' : isEdgeLan ? '局域网 Mesh 离线直连' : '无网络连接'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted">智慧教室本地主机</span>
              <span className={`font-mono font-bold ${state.isLocalServerReachable ? 'text-emerald-600' : 'text-rose-500'}`}>
                {state.isLocalServerReachable ? '✓ 正常响应' : '✗ 未响应'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted">校园外网云端连接</span>
              <span className={`font-mono font-bold ${state.isInternetReachable ? 'text-emerald-600' : 'text-amber-600'}`}>
                {state.isInternetReachable ? '✓ 连通' : '离线 (自动降级)'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted">待同步学情日志</span>
              <span className="font-mono text-main">{state.bufferedOfflineEventsCount} 条</span>
            </div>
          </div>

          {isEdgeLan && (
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <ShieldAlert size={14} className="shrink-0 mt-0.5" />
              <span>
                外网中断不影响当堂授课：师生抢答、白板同步、投屏与测验均基于本地 Socket.IO 正常运转，待网络恢复后自动完成云端数据对账。
              </span>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => setShowDetails(false)}
              className="text-[11px] text-primary-theme font-bold hover:underline cursor-pointer"
            >
              收起详情
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
