/**
 * PacingDashboardModal — 课堂反馈情绪实时仪表盘
 *
 * 聚合全体学生的节奏反馈（理解 💡 / 困惑 ❓ / 慢一点 🐇 / 快一点 🐢），
 * 以环形饼图 + 进度条实时呈现，辅助教师动态调整教学节奏。
 *
 * 数据源：
 *  - 学生 POST /pacing → 服务端 5 分钟窗口聚合 → socket `classroom:pacing_updated`
 *  - 打开面板时先拉一次快照（GET /api/classroom/sessions/:lessonId 之外的
 *    stage 数据接口），随后完全由 socket 增量驱动
 */
import React, { useState, useEffect, useCallback } from 'react';
import { X, TrendingUp, Gauge, Users } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { getOptionalSocket } from '../../services/socket-service';

export interface PacingSignals {
  TOO_FAST?: number;
  SLOW?: number;
  CONFUSED?: number;
  CLEAR?: number;
  [key: string]: number | undefined;
}

export interface PacingDashboardModalProps {
  lessonId: string;
  lang: 'zh' | 'en';
  signals: PacingSignals;
  onlineCount?: number;
  onClose: () => void;
}

const META = {
  CLEAR: { emoji: '💡', zh: '理解', en: 'Clear', color: '#10b981' },
  CONFUSED: { emoji: '❓', zh: '困惑', en: 'Confused', color: '#f59e0b' },
  TOO_FAST: { emoji: '🐇', zh: '慢一点', en: 'Slow down', color: '#f43f5e' },
  SLOW: { emoji: '🐢', zh: '快一点', en: 'Speed up', color: '#6366f1' },
} as const;

const SIGNAL_KEYS = ['CLEAR', 'CONFUSED', 'TOO_FAST', 'SLOW'] as const;

export function PacingDashboardModal({ lessonId, lang, signals, onlineCount = 0, onClose }: PacingDashboardModalProps) {
  const zh = lang === 'zh';
  const [windowSignals, setWindowSignals] = useState<PacingSignals>(signals);

  // socket 实时增量（服务端 5 分钟窗口聚合）
  useEffect(() => {
    const socketRef = getOptionalSocket();
    if (!socketRef) return;
    const handler = (payload: any) => {
      if (payload?.lessonId !== lessonId) return;
      if (payload?.summary) setWindowSignals(payload.summary);
    };
    socketRef.on('classroom:pacing_updated', handler);
    return () => {
      if (typeof socketRef.off === 'function') socketRef.off('classroom:pacing_updated', handler);
    };
  }, [lessonId]);

  const counts = SIGNAL_KEYS.map((k) => ({ key: k, count: Number(windowSignals[k] ?? 0) }));
  const total = counts.reduce((a, c) => a + c.count, 0);
  const confusion = Number(windowSignals.CONFUSED ?? 0) + Number(windowSignals.TOO_FAST ?? 0) + Number(windowSignals.SLOW ?? 0);
  // 节奏健康度：理解占比（0-100），仅在有信号时计算
  const health = total > 0 ? Math.round(((Number(windowSignals.CLEAR ?? 0)) / total) * 100) : null;

  const buildAdvice = useCallback((): { text: string; tone: string } => {
    if (total === 0) return { text: zh ? '暂无学生反馈，等待中…' : 'No feedback yet', tone: 'text-muted' };
    if (Number(windowSignals.CONFUSED ?? 0) >= Math.max(2, total * 0.3))
      return { text: zh ? '⚠ 较多学生困惑，建议放慢并重新讲解当前环节' : '⚠ Many students are confused — slow down and re-explain', tone: 'text-amber-600' };
    if (Number(windowSignals.TOO_FAST ?? 0) >= Math.max(2, total * 0.3))
      return { text: zh ? '🐇 较多学生希望放慢节奏' : '🐇 Many students want you to slow down', tone: 'text-rose-600' };
    if (Number(windowSignals.SLOW ?? 0) >= Math.max(2, total * 0.3))
      return { text: zh ? '🐢 较多学生希望加快节奏' : '🐢 Many students want you to speed up', tone: 'text-indigo-600' };
    return { text: zh ? '✓ 节奏反馈健康，可按当前节奏继续' : '✓ Pace is healthy — carry on', tone: 'text-emerald-600' };
  }, [windowSignals, total, zh]);

  const pieData = counts
    .filter((c) => c.count > 0)
    .map((c) => ({ name: META[c.key as keyof typeof META][zh ? 'zh' : 'en'], value: c.count, color: META[c.key as keyof typeof META].color }));

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/60 backdrop-blur-2xs" onPointerDown={onClose}>
      <div
        className="bg-surface border border-theme rounded-2xl shadow-2xl w-[560px] max-w-[92vw] max-h-[86vh] overflow-y-auto p-5 font-sans text-main"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary-theme/10 text-primary-theme rounded-xl">
              <Gauge size={18} />
            </div>
            <div>
              <h2 className="text-sm font-black text-main flex items-center gap-1.5">
                {zh ? '课堂反馈情绪仪表盘' : 'Classroom Feedback Dashboard'}
                <span className="flex items-center gap-1 text-2xs font-bold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                  <TrendingUp size={10} /> {zh ? '实时' : 'LIVE'}
                </span>
              </h2>
              <p className="text-2xs text-muted mt-0.5">
                {zh ? '近 5 分钟窗口 · 全班节奏反馈聚合' : 'Last 5 minutes · aggregated pace feedback'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-secondary text-muted cursor-pointer" title={zh ? '关闭' : 'Close'}>
            <X size={16} />
          </button>
        </div>

        {/* 主体：左饼图 / 右数据 */}
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="w-[200px] h-[200px] relative shrink-0">
            {total > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={85}
                    paddingAngle={3}
                    strokeWidth={0}
                    isAnimationActive={false}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl opacity-30">📊</div>
            )}
            {/* 中心指标：健康度 */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xs text-muted flex items-center gap-1">
                <Users size={10} /> {onlineCount} {zh ? '在线' : 'online'}
              </span>
              <span className={`text-xl font-black ${health === null ? 'text-muted' : health >= 60 ? 'text-emerald-600' : health >= 30 ? 'text-amber-600' : 'text-rose-600'}`}>
                {health === null ? '—' : `${health}%`}
              </span>
              <span className="text-2xs text-muted">{zh ? '理解占比' : 'clear ratio'}</span>
            </div>
          </div>

          {/* 四情绪进度条 */}
          <div className="flex-1 w-full flex flex-col gap-2.5">
            {counts.map(({ key, count }) => {
              const meta = META[key as keyof typeof META];
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="font-bold text-main">
                      {meta.emoji} {zh ? meta.zh : meta.en}
                    </span>
                    <span className="text-muted font-mono">
                      {count} · {pct}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-surface-secondary rounded-full overflow-hidden border border-theme/50">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: meta.color }}
                    />
                  </div>
                </div>
              );
            })}
            {/* 教学建议 */}
            <div className={`mt-1 text-xs font-bold ${buildAdvice().tone}`}>{buildAdvice().text}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
