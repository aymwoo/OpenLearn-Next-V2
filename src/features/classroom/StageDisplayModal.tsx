import React, { useEffect, useState } from 'react';
import {
  X,
  Maximize,
  Minimize,
  Radio,
  Bell,
  Clock,
  CheckCircle,
  HelpCircle,
  TrendingUp,
  Sparkles,
  Award,
  Zap,
  GitCompare,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { PeerReviewShowcaseModal } from './peer-review/PeerReviewShowcaseModal';

export interface StageDisplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  lessonId: string;
  lessonTitle?: string;
  lang?: 'zh' | 'en';
}

export function StageDisplayModal({
  isOpen,
  onClose,
  lessonId,
  lessonTitle = '互动课堂',
  lang = 'zh',
}: StageDisplayModalProps) {
  const [data, setData] = useState<{
    stage: string;
    checkinCode: string | null;
    activePoll: any;
    activeBuzzer: any;
    pacing: { TOO_FAST: number; CONFUSED: number; CLEAR: number };
  }>({
    stage: 'IN_CLASS_TEACHING',
    checkinCode: null,
    activePoll: null,
    activeBuzzer: null,
    pacing: { TOO_FAST: 0, CONFUSED: 0, CLEAR: 0 },
  });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState('');
  const [isPeerReviewOpen, setIsPeerReviewOpen] = useState(false);

  // Clock updater
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Polling / fetching stage data
  useEffect(() => {
    if (!isOpen || !lessonId) return;

    let mounted = true;
    const fetchStageData = async () => {
      try {
        const res = await fetch(`/api/classroom/stage/${lessonId}/data`);
        if (res.ok && mounted) {
          const json = await res.json();
          setData(json);
        }
      } catch (err) {
        console.warn('[StageDisplay] Fetch error:', err);
      }
    };

    fetchStageData();
    const interval = setInterval(fetchStageData, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isOpen, lessonId]);

  if (!isOpen) return null;

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
        setIsFullscreen(false);
      }
    }
  };

  const stageNames: Record<string, string> = {
    PRE_CLASS_READY: lang === 'zh' ? '课前就绪 · 准备上课' : 'Pre-Class Preparation',
    IN_CLASS_TEACHING: lang === 'zh' ? '课中授课 · 互动探索' : 'Interactive Teaching',
    WRAP_UP_EXIT_TICKET: lang === 'zh' ? '总结提升 · 结课通票' : 'Wrap-Up & Exit Ticket',
    ARCHIVED_REPORT: lang === 'zh' ? '下课归档 · 学情简报' : 'Archived Report',
  };

  const totalPacing = (data.pacing.TOO_FAST || 0) + (data.pacing.CONFUSED || 0) + (data.pacing.CLEAR || 0);

  return (
    <div
      id="stage-display-modal"
      className="fixed inset-0 z-[9999] bg-slate-950 text-slate-100 flex flex-col select-none overflow-hidden"
    >
      {/* 顶部状态栏 */}
      <header className="h-20 px-8 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5 px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded-full text-blue-400 font-semibold text-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping" />
            <span>{lang === 'zh' ? '大屏教学展台' : 'Stage Display'}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white line-clamp-1">{lessonTitle}</h1>
          <span className="px-3 py-1 bg-slate-800 text-slate-300 text-xs font-mono rounded-md border border-slate-700">
            {stageNames[data.stage] || stageNames.IN_CLASS_TEACHING}
          </span>
        </div>

        <div className="flex items-center gap-6">
          {/* 大屏时钟 */}
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/60 rounded-xl border border-slate-700/60 font-mono text-xl font-bold text-slate-200">
            <Clock size={20} className="text-blue-400" />
            <span>{currentTime}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="stage-peer-review-toggle"
              type="button"
              onClick={() => setIsPeerReviewOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 rounded-xl transition-colors border border-teal-500/40 text-xs font-semibold cursor-pointer"
              title="进入全班大屏作业互评与协同赏析模式 (Stitch 21e2dac1)"
            >
              <GitCompare size={15} />
              <span>作业互评赏析</span>
            </button>
            <button
              id="stage-fullscreen-toggle"
              onClick={toggleFullscreen}
              className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors border border-slate-700 cursor-pointer"
              title={isFullscreen ? '退出全屏' : '全屏展示'}
            >
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
            <button
              id="stage-close-button"
              onClick={onClose}
              className="p-3 bg-rose-900/40 hover:bg-rose-900/70 text-rose-300 rounded-xl transition-colors border border-rose-800/50 cursor-pointer"
              title="关闭展台"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* 主展示区 */}
      <main className="flex-1 p-8 grid grid-cols-12 gap-8 overflow-y-auto">
        {/* 左侧重点展示区 (8 列) */}
        <section className="col-span-8 flex flex-col gap-6">
          {/* 签到就绪卡片（课前） */}
          {data.stage === 'PRE_CLASS_READY' && (
            <div className="flex-1 bg-gradient-to-br from-slate-900 to-slate-850 rounded-3xl border border-slate-800 p-10 flex flex-col justify-center items-center text-center shadow-2xl">
              <div className="p-4 bg-blue-500/10 rounded-3xl border border-blue-500/20 text-blue-400 mb-6">
                <Radio size={48} className="animate-pulse" />
              </div>
              <h2 className="text-3xl font-extrabold text-white mb-2">
                {lang === 'zh' ? '即将开始上课，请同学们准备' : 'Class Starting Soon'}
              </h2>
              <p className="text-slate-400 text-lg mb-8 max-w-md">
                {lang === 'zh'
                  ? '请打开平板或电脑进入课堂，输入口令加入'
                  : 'Please join the interactive session using your device'}
              </p>
              {data.checkinCode && (
                <div className="px-10 py-6 bg-slate-800/90 rounded-2xl border border-blue-500/40 shadow-inner flex flex-col items-center">
                  <span className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-2">
                    {lang === 'zh' ? '课堂入课口令' : 'Class Code'}
                  </span>
                  <span className="text-6xl font-mono font-black tracking-wider text-blue-400">
                    {data.checkinCode}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 极速单选投票卡片 */}
          {data.activePoll && (
            <div className="bg-slate-900/90 rounded-3xl border border-slate-800 p-8 shadow-xl flex flex-col gap-6">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-3">
                  <span className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
                    <Sparkles size={24} />
                  </span>
                  <div>
                    <span className="text-xs font-bold text-amber-400 uppercase tracking-wide">
                      {lang === 'zh' ? '课堂极速互动' : 'Quick Activity'}
                    </span>
                    <h3 className="text-xl font-bold text-white">{data.activePoll.title}</h3>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-3xl font-black text-amber-400 font-mono">
                    {data.activePoll.totalVotes || 0}
                  </span>
                  <span className="text-xs text-slate-400 block">{lang === 'zh' ? '人已作答' : 'Responded'}</span>
                </div>
              </div>

              {/* 选项柱状图聚合 */}
              <div className="grid grid-cols-2 gap-4 my-2">
                {(data.activePoll.options || ['A', 'B', 'C', 'D']).map((opt: string) => {
                  const count = data.activePoll.distribution?.[opt] || 0;
                  const total = data.activePoll.totalVotes || 1;
                  const percent = Math.round((count / (data.activePoll.totalVotes || 1)) * 100);

                  return (
                    <div
                      key={opt}
                      className="p-5 bg-slate-800/50 rounded-2xl border border-slate-700/50 flex flex-col gap-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="w-10 h-10 rounded-xl bg-blue-500 text-white font-bold text-lg flex items-center justify-center shadow-md">
                            {opt}
                          </span>
                          <span className="font-semibold text-slate-200 text-lg">选项 {opt}</span>
                        </div>
                        <span className="font-mono font-bold text-xl text-blue-400">
                          {percent}% ({count})
                        </span>
                      </div>
                      <div className="h-4 w-full bg-slate-700/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500 rounded-full"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 抢答器热点卡片 */}
          {data.activeBuzzer && (
            <div className="bg-slate-900/90 rounded-3xl border border-slate-800 p-8 shadow-xl flex flex-col items-center text-center justify-center">
              <div className="p-4 bg-rose-500/10 rounded-2xl border border-rose-500/20 text-rose-400 mb-4">
                <Bell size={36} className="animate-bounce" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">{data.activeBuzzer.title}</h3>

              {data.activeBuzzer.status === 'READY' ? (
                <div className="my-6 py-6 px-12 bg-rose-950/30 border border-rose-500/30 rounded-2xl">
                  <span className="text-4xl font-extrabold text-rose-400 animate-pulse block">
                    {lang === 'zh' ? '⚡ 全班抢答中...' : '⚡ Buzzing in progress...'}
                  </span>
                  <span className="text-sm text-slate-400 mt-2 block">
                    {lang === 'zh' ? '请按手中的抢答按钮！' : 'Press your buzzer now!'}
                  </span>
                </div>
              ) : (
                <div className="my-6 py-6 px-12 bg-emerald-950/30 border border-emerald-500/40 rounded-2xl flex flex-col items-center">
                  <Award size={48} className="text-amber-400 mb-2" />
                  <span className="text-sm text-emerald-400 font-bold tracking-wide uppercase">
                    {lang === 'zh' ? '🎉 抢答成功！' : '🎉 First to Buzz!'}
                  </span>
                  <span className="text-5xl font-black text-white my-2 font-mono">
                    {data.activeBuzzer.winnerName || '同学'}
                  </span>
                  {data.activeBuzzer.responseTimeMs && (
                    <span className="text-sm font-mono text-emerald-300">
                      {lang === 'zh'
                        ? `响应用时：${data.activeBuzzer.responseTimeMs} 毫秒`
                        : `Reaction time: ${data.activeBuzzer.responseTimeMs} ms`}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 结课通票大屏展示 */}
          {data.stage === 'WRAP_UP_EXIT_TICKET' && (
            <div className="bg-gradient-to-br from-indigo-950/40 to-slate-900 rounded-3xl border border-indigo-800/40 p-8 shadow-xl flex flex-col items-center text-center">
              <CheckCircle size={48} className="text-indigo-400 mb-4" />
              <h3 className="text-3xl font-extrabold text-white mb-2">
                {lang === 'zh' ? '60 秒结课通票 (Exit Ticket)' : '60s Exit Ticket'}
              </h3>
              <p className="text-slate-300 text-lg max-w-lg mb-6">
                {lang === 'zh'
                  ? '请同学们打开设备完成本次课堂评估：选星级、写下今天最困惑的一个知识点。'
                  : 'Please complete your 60-second summary ticket on your device.'}
              </p>
            </div>
          )}

          {/* 第三方大屏展台扩展卡槽 */}
          <ExtensionPointRenderer
            slot="stage.display.card"
            slotProps={{
              lessonId,
              stage: data.stage,
            }}
          />
        </section>

        {/* 右侧边栏：学习节奏晴雨表 & 统计 (4 列) */}
        <aside className="col-span-4 flex flex-col gap-6">
          {/* 实时听懂晴雨表 */}
          <div className="bg-slate-900/90 rounded-3xl border border-slate-800 p-6 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <TrendingUp size={18} className="text-blue-400" />
                <span>{lang === 'zh' ? '学习节奏晴雨表' : 'Pacing Barometer'}</span>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {totalPacing} {lang === 'zh' ? '次反馈' : 'signals'}
              </span>
            </div>

            <div className="flex flex-col gap-3 my-1">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-emerald-300 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  {lang === 'zh' ? '听懂了 / 节奏合适' : 'Clear & Smooth'}
                </span>
                <span className="font-mono font-bold text-white">{data.pacing.CLEAR || 0}</span>
              </div>
              <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${totalPacing > 0 ? ((data.pacing.CLEAR || 0) / totalPacing) * 100 : 0}%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-sm pt-2">
                <span className="flex items-center gap-2 text-amber-300 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  {lang === 'zh' ? '有些困惑 / 需点拨' : 'Confused'}
                </span>
                <span className="font-mono font-bold text-white">{data.pacing.CONFUSED || 0}</span>
              </div>
              <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${totalPacing > 0 ? ((data.pacing.CONFUSED || 0) / totalPacing) * 100 : 0}%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-sm pt-2">
                <span className="flex items-center gap-2 text-rose-300 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                  {lang === 'zh' ? '讲太快了 / 跟不上' : 'Too Fast'}
                </span>
                <span className="font-mono font-bold text-white">{data.pacing.TOO_FAST || 0}</span>
              </div>
              <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${totalPacing > 0 ? ((data.pacing.TOO_FAST || 0) / totalPacing) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            <p className="text-xs text-slate-500 text-center mt-2">
              {lang === 'zh'
                ? '提示：此数据来自学生端匿名点击，自动脱敏保护学生自尊。'
                : 'Aggregated anonymized signals from student devices.'}
            </p>
          </div>
        </aside>
      </main>

      {isPeerReviewOpen && (
        <PeerReviewShowcaseModal
          isOpen={isPeerReviewOpen}
          onClose={() => setIsPeerReviewOpen(false)}
          lessonTitle={lessonTitle}
        />
      )}
    </div>
  );
}
