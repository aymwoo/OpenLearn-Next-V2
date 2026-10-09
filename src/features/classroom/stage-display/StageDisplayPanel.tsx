/**
 * 大屏展台 · 展示面板（纯展示）
 *
 * 从原 `StageDisplayModal` 抽出的无状态展示层，供两种宿主复用：
 *  - `StageDisplayModal`：同页模态框（弹窗被拦截时的降级路径 / 旧调用方）
 *  - `StageDisplayView`：独立窗口（副屏 / 投影，主路径）
 *
 * 之所以抽出来而不是复制一份：两处展示逻辑必须逐像素一致，
 * 复制会导致「模态框里改了文案、独立窗口没改」这类漂移。
 */
import React, { useEffect, useState } from 'react';
import {
  X,
  Maximize,
  Minimize,
  Radio,
  Bell,
  Clock,
  CheckCircle,
  TrendingUp,
  Sparkles,
  Award,
  GitCompare,
  Presentation,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { PeerReviewShowcaseModal, type PeerReviewShowcaseModalProps } from '../peer-review/PeerReviewShowcaseModal';
import { EMPTY_STAGE_DATA, type StageDisplayData, type FeedHealth } from './useStageDisplayFeed';
import { stageLabel } from './stage-notices';
import { ConnectionBadge } from './StageNoticeStack';
import { useViewportFullscreen } from './useViewportFullscreen';
import { StageAttendanceCard, StageCoursewareCard, StageExitTicketProgress, StageFeedCard } from './StageRealDataCards';

export interface StageDisplayPanelProps {
  lessonId: string;
  lessonTitle?: string;
  data: StageDisplayData;
  lang?: 'zh' | 'en';
  /** 连接健康度；不传则不显示连接指示（保持与旧版一致的极简顶栏） */
  health?: FeedHealth;
  lastSyncedAt?: number | null;
  /** 独立窗口模式下隐藏关闭按钮（改为提示教师自行关标签页） */
  showCloseButton?: boolean;
  onClose?: () => void;
  /**
   * 互评赏析所需的真实数据与回调（isOpen/onClose 由本面板管理，故此处省略）。
   * 此前展台只传 lessonTitle，导致整个互评模块是空壳（数据源 usePeerReviewData 存在却没接上），
   * 且弹窗内部残留 95.3 / 32 等写死值。现由调用方用真实数据驱动。
   */
  peerReview?: Omit<PeerReviewShowcaseModalProps, 'isOpen' | 'onClose'>;
  /** 已同步到学生机的真实台数（替代原先写死的 32） */
  syncedStudentsCount?: number;
  /** 互评赏析开关（受控）：由宿主控制，以便在打开前先拉取真实数据 */
  peerReviewOpen?: boolean;
  onOpenPeerReview?: () => void;
  onClosePeerReview?: () => void;
}

export function StageDisplayPanel({
  lessonId,
  lessonTitle = '互动课堂',
  data,
  lang = 'zh',
  health,
  lastSyncedAt,
  showCloseButton = true,
  onClose,
  peerReview,
  syncedStudentsCount,
  peerReviewOpen,
  onOpenPeerReview,
  onClosePeerReview,
}: StageDisplayPanelProps) {
  const { isFullscreen, toggle: toggleFullscreen } = useViewportFullscreen();
  const [currentTime, setCurrentTime] = useState('');
  // 受控优先（独立窗口需要先拉真实数据再打开）；未受控时保留内部状态（同页模态框用法）
  const [peerReviewOpenInternal, setPeerReviewOpenInternal] = useState(false);
  const isPeerReviewOpen = peerReviewOpen ?? peerReviewOpenInternal;
  const setPeerReviewOpen = (v: boolean) => {
    if (peerReviewOpen === undefined) setPeerReviewOpenInternal(v);
    if (v) onOpenPeerReview?.();
    else onClosePeerReview?.();
  };

  // Clock updater
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // 全屏（含原生全屏被拒后的「仅占满视口」降级态）的进入/退出与 Esc 交由
  // useViewportFullscreen 统一处理，见该文件顶部对降级必要性的说明。

  const pacing = data.pacing ?? EMPTY_STAGE_DATA.pacing;
  const totalPacing = (pacing.TOO_FAST || 0) + (pacing.CONFUSED || 0) + (pacing.CLEAR || 0);

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
            {stageLabel(data.stage, lang)}
          </span>
        </div>

        <div className="flex items-center gap-6">
          {/* 连接健康度：常驻无人看管的副屏必须让人一眼看出数据是否还在更新 */}
          {health && <ConnectionBadge health={health} lastSyncedAt={lastSyncedAt ?? null} lang={lang} />}

          {/* 大屏时钟 */}
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/60 rounded-xl border border-slate-700/60 font-mono text-xl font-bold text-slate-200">
            <Clock size={20} className="text-blue-400" />
            <span>{currentTime}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* 第三方大屏展台快捷操作扩展槽 */}
            <ExtensionPointRenderer
              slot="stage.display.action"
              slotProps={{
                lessonId,
                lessonTitle,
                stage: data.stage,
                data,
                isFullscreen,
                lang,
                onToggleFullscreen: toggleFullscreen,
                onOpenPeerReview: () => setPeerReviewOpen(true),
              }}
            />
            <button
              id="stage-peer-review-toggle"
              type="button"
              onClick={() => setPeerReviewOpen(true)}
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
            {showCloseButton && (
              <button
                id="stage-close-button"
                onClick={onClose}
                className="p-3 bg-rose-900/40 hover:bg-rose-900/70 text-rose-300 rounded-xl transition-colors border border-rose-800/50 cursor-pointer"
                title="关闭展台"
              >
                <X size={20} />
              </button>
            )}
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
                  <span className="text-6xl font-mono font-black tracking-wider text-blue-400">{data.checkinCode}</span>
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

              {/* 选项柱状图聚合。
                  绝不兜底成 ['A','B','C','D']：接口没给选项就说明数据异常，
                  画四条假柱子会让学生看到不存在的题目结构。 */}
              <div className="grid grid-cols-2 gap-4 my-2">
                {(Array.isArray(data.activePoll.options) && data.activePoll.options.length > 0
                  ? data.activePoll.options
                  : []
                ).map((opt: string) => {
                  const count = data.activePoll.distribution?.[opt] || 0;
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

          {/* 无任何互动进行中：明确说明「在等什么」，而不是留一大片空白让投影看起来像坏了 */}
          {!data.activePoll &&
            !data.activeBuzzer &&
            data.stage !== 'PRE_CLASS_READY' &&
            data.stage !== 'WRAP_UP_EXIT_TICKET' && (
              <div className="flex-1 min-h-[220px] bg-gradient-to-br from-slate-900 to-slate-850 rounded-3xl border border-slate-800 p-10 flex flex-col justify-center items-center text-center">
                <div className="p-4 bg-slate-800/60 rounded-3xl border border-slate-700/50 text-slate-400 mb-5">
                  <Presentation size={40} />
                </div>
                <h3 className="text-2xl font-extrabold text-white mb-2">
                  {lang === 'zh' ? '等待课堂互动' : 'Waiting for classroom activity'}
                </h3>
                <p className="text-slate-400 text-base max-w-lg">
                  {lang === 'zh'
                    ? '当前没有进行中的投票或抢答。教师发起互动后，这里会立刻展示实时结果；右侧的出勤、课件参与与课堂动态为实时数据。'
                    : 'No poll or buzz-in is running. Real-time results will appear here; attendance and activity metrics are live on the right.'}
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

        {/* 右侧边栏：真实课堂指标 (4 列) */}
        <aside className="col-span-4 flex flex-col gap-6">
          {/* 课堂出勤（在线 / 应到 / 实到）—— 来自 presence 实时在线名单 + 班级名单 */}
          <StageAttendanceCard attendance={data.attendance} zh={lang === 'zh'} />

          {/* 互动课件参与 —— 来自 courseware_attempt / submission_result */}
          <StageCoursewareCard stats={data.courseware} zh={lang === 'zh'} />

          {/* 结课通票提交进度 */}
          {data.stage === 'WRAP_UP_EXIT_TICKET' && (
            <div className="bg-slate-900/90 rounded-3xl border border-slate-800 p-5 shadow-xl">
              <StageExitTicketProgress
                submitted={data.exitTicketSubmitted}
                expected={data.attendance?.expected}
                zh={lang === 'zh'}
              />
            </div>
          )}

          {/* 课堂动态流 —— 来自 classroom_feed 真实事件 */}
          <StageFeedCard feed={data.feed} zh={lang === 'zh'} />

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
                <span className="font-mono font-bold text-white">{pacing.CLEAR || 0}</span>
              </div>
              <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${totalPacing > 0 ? ((pacing.CLEAR || 0) / totalPacing) * 100 : 0}%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-sm pt-2">
                <span className="flex items-center gap-2 text-amber-300 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  {lang === 'zh' ? '有些困惑 / 需点拨' : 'Confused'}
                </span>
                <span className="font-mono font-bold text-white">{pacing.CONFUSED || 0}</span>
              </div>
              <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${totalPacing > 0 ? ((pacing.CONFUSED || 0) / totalPacing) * 100 : 0}%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-sm pt-2">
                <span className="flex items-center gap-2 text-rose-300 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                  {lang === 'zh' ? '讲太快了 / 跟不上' : 'Too Fast'}
                </span>
                <span className="font-mono font-bold text-white">{pacing.TOO_FAST || 0}</span>
              </div>
              <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${totalPacing > 0 ? ((pacing.TOO_FAST || 0) / totalPacing) * 100 : 0}%`,
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
          onClose={() => setPeerReviewOpen(false)}
          lessonTitle={lessonTitle}
          syncedStudentsCount={syncedStudentsCount}
          {...(peerReview ?? {})}
        />
      )}

      {/* 第三方大屏全屏 HUD 覆盖层（全班弹幕、抢答倒计时、仪式动效等） */}
      <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
        <ExtensionPointRenderer
          slot="stage.display.overlay"
          slotProps={{
            lessonId,
            lessonTitle,
            stage: data.stage,
            data,
            isFullscreen,
            lang,
          }}
        />
      </div>
    </div>
  );
}
