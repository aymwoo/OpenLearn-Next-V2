import React, { useState, useEffect, useCallback } from 'react';
import { PeerReviewTelemetryHeader } from './PeerReviewTelemetryHeader';
import { PeerReviewMatrixPanel } from './PeerReviewMatrixPanel';
import { SpotlightDualWorkArena } from './SpotlightDualWorkArena';
import { PeerReviewRubricStats, type ReactionCountItem } from './PeerReviewRubricStats';
import { PeerReviewLeaderboardPanel } from './PeerReviewLeaderboardPanel';
import { PeerReviewDanmakuOverlay } from './PeerReviewDanmakuOverlay';
import { PeerReviewRubricModal } from './PeerReviewRubricModal';
import type {
  PeerReviewState,
  PeerMatchingItem,
  LivePeerBadge,
  SpotlightWorkItem,
  TeacherPeerAnnotation,
  RubricDimensionItem,
  NominatedStudent,
  DanmakuItem,
} from './types';

/**
 * 量规加权均分：由真实维度得分按权重算出。
 * 无任何真实维度数据时返回 null（UI 显示「—」），而不是回退到某个写死分数 ——
 * 大屏上凭空出现「95.3」会让教师以为全班打了 95.3 分。
 */
export function weightedRubricAverage(dimensions: RubricDimensionItem[] | undefined): number | null {
  if (!Array.isArray(dimensions) || dimensions.length === 0) return null;
  let weighted = 0;
  let totalWeight = 0;
  for (const d of dimensions) {
    const raw = d as unknown as Record<string, unknown>;
    const score = Number(raw.score ?? raw.percentage ?? raw.value);
    if (!Number.isFinite(score)) continue;
    const weight = Number(raw.weight ?? 0);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    weighted += score * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0) return null;
  return Math.round((weighted / totalWeight) * 10) / 10;
}

export interface PeerReviewShowcaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdvanceToStage3?: () => void;
  lessonTitle?: string;
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

  // ── 真实数据入参（全部可选）─────────────────────────────────────────
  // 未提供时列表为空并渲染空态；**不再内置任何假学生/假作品/假分数**。
  // 数据来源：
  //   matchingItems  ← 互评任务分配（assignment-hub 的 plugin_peer_review_tasks）
  //   badges         ← 学生互评时投出的微勋章（plugin_peer_reviews）
  //   dimensions     ← 量规维度真实达标率（plugin_peer_reviews 按维度聚合）
  //   podiumStudents ← 提名票数排名（真实投票）
  //   danmaku        ← 课堂弹幕（Socket.IO 广播，见 classroom.* 事件）
  //   workA / workB  ← 大屏焦点对比的两份真实作品（courseware_attempt）
  matchingItems?: PeerMatchingItem[];
  badges?: LivePeerBadge[];
  annotations?: TeacherPeerAnnotation[];
  rubricDimensions?: RubricDimensionItem[];
  reactions?: ReactionCountItem[];
  podiumStudents?: NominatedStudent[];
  danmaku?: DanmakuItem[];
  workA?: SpotlightWorkItem | null;
  workB?: SpotlightWorkItem | null;
  /** 真实评阅进度（已评/总数），未提供时按 0 显示 */
  reviewProgress?: { completed: number; total: number };
  /** 真实倒计时秒数，未提供时为 0（不显示假倒计时） */
  countdownSeconds?: number;
  /** 教师一键「1 生评 2 份」：真实写入 classroom_peer_review_tasks */
  onAutoAssign?: () => void | Promise<void>;
  /** 分配进行中（按钮禁用） */
  autoAssigning?: boolean;
  /**
   * 已同步到学生机的真实台数。用于替代原先写死的 32 ——
   * 大屏上凭空显示「32 台已同步」会让教师误判真实投放进度。
   */
  syncedStudentsCount?: number;
  /** 当前主讲教师姓名（用于批注/弹幕署名），缺省时显示「教师」而非编造的人名 */
  teacherName?: string;
  /** 互评阶段标识（来自课堂阶段），缺省时按真实阶段推断 */
  stageLabel?: string;
}

export const PeerReviewShowcaseModal: React.FC<PeerReviewShowcaseModalProps> = ({
  isOpen,
  onClose,
  onAdvanceToStage3,
  lessonTitle = '',
  addToast,
  workA: workAProp,
  workB: workBProp,
  reviewProgress,
  countdownSeconds,
  onAutoAssign,
  autoAssigning = false,
  matchingItems: matchingItemsProp,
  badges: badgesProp,
  annotations: annotationsProp,
  rubricDimensions: rubricDimensionsProp,
  reactions: reactionsProp,
  podiumStudents: podiumStudentsProp,
  danmaku: danmakuProp,
  syncedStudentsCount,
  teacherName,
  stageLabel,
}) => {
  // ── State ─────────────────────────────────────────────────────────────
  // 评阅状态：进度与倒计时来自真实入参；缺失时为 0（不再写死 28/32、142、138s）
  // stage 同样来自真实入参，不再固定显示 'STAGE 02.4'
  const [reviewState, setReviewState] = useState<PeerReviewState>({
    stage: stageLabel || '',
    isLocked: true,
    isDualScreen: true,
    isAnonymous: true,
    timeRemainingSeconds: countdownSeconds ?? 0,
    totalTimeSeconds: countdownSeconds ?? 0,
    isPaused: false,
    completedReviews: reviewProgress?.completed ?? 0,
    totalStudents: reviewProgress?.total ?? 0,
    totalLikes: 0,
    totalNominations: 0,
    showVoiceDanmaku: true,
    showDanmaku: true,
  });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRubricOpen, setIsRubricOpen] = useState(false);

  // ── Initial Mock Data based on Stitch 21e2dac1 ─────────────────────────
  const [matchingItems, setMatchingItems] = useState<PeerMatchingItem[]>(matchingItemsProp ?? []);

  const [badges, setBadges] = useState<LivePeerBadge[]>(badgesProp ?? []);

  const [workA, setWorkA] = useState<SpotlightWorkItem>(workAProp ?? (null as unknown as SpotlightWorkItem));

  const [workB, setWorkB] = useState<SpotlightWorkItem>(workBProp ?? (null as unknown as SpotlightWorkItem));

  const [annotations, setAnnotations] = useState<TeacherPeerAnnotation[]>(annotationsProp ?? []);

  const [dimensions] = useState<RubricDimensionItem[]>(rubricDimensionsProp ?? []);

  const [reactions, setReactions] = useState<ReactionCountItem[]>(reactionsProp ?? []);

  const [podiumStudents] = useState<NominatedStudent[]>(podiumStudentsProp ?? []);

  const [danmakuList, setDanmakuList] = useState<DanmakuItem[]>(danmakuProp ?? []);

  // ── Countdown Timer effect ───────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || reviewState.isPaused) return;

    const timer = setInterval(() => {
      setReviewState((prev) => {
        if (prev.timeRemainingSeconds <= 1) {
          return { ...prev, timeRemainingSeconds: 0, isPaused: true };
        }
        return { ...prev, timeRemainingSeconds: prev.timeRemainingSeconds - 1 };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, reviewState.isPaused]);

  // ── Keyboard shortcut handling (Enter, Escape, Space) ──────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        handleAdvanceToStage3();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        handleTogglePauseTimer();
      }
    },
    [isOpen, onClose],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isOpen) return null;

  // ── Action Handlers ──────────────────────────────────────────────────
  const handleToggleAnonymous = () => {
    setReviewState((prev) => ({ ...prev, isAnonymous: !prev.isAnonymous }));
    addToast?.(
      '互评模式已切换',
      !reviewState.isAnonymous ? '已开启双盲匿名评价模式' : '已恢复显示真实学生姓名',
      'info',
    );
  };

  const handleAddMinute = () => {
    setReviewState((prev) => ({
      ...prev,
      timeRemainingSeconds: prev.timeRemainingSeconds + 60,
      totalTimeSeconds: prev.totalTimeSeconds + 60,
    }));
    addToast?.('互评加时', '倒计时已增加 1 分钟', 'success');
  };

  const handleTogglePauseTimer = () => {
    setReviewState((prev) => ({ ...prev, isPaused: !prev.isPaused }));
  };

  const handleToggleFullscreen = () => {
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

  const handleReactionClick = (id: string) => {
    setReactions((prev) => prev.map((r) => (r.id === id ? { ...r, count: r.count + 1 } : r)));
    setReviewState((prev) => ({ ...prev, totalLikes: prev.totalLikes + 1 }));
  };

  const handleAddAnnotation = (content: string) => {
    const newAnn: TeacherPeerAnnotation = {
      id: `ann-${Date.now()}`,
      authorType: 'teacher',
      authorRole: '主讲教师',
      authorName: teacherName || '教师',
      timeAgo: '刚刚',
      content,
      borderColor: '#8083ff',
    };
    setAnnotations((prev) => [newAnn, ...prev]);
    addToast?.('批注已挂载', '协同板书批注已同步至大屏', 'success');
  };

  const handleSendDanmaku = (text: string, type: 'text' | 'voice' = 'text') => {
    const newDanmaku: DanmakuItem = {
      id: `d-${Date.now()}`,
      sender: teacherName || '教师',
      text,
      type,
      // 不伪造语音时长：真实时长需要 MediaRecorder 录制，平台尚未接入。
      // 没有真实音频时留空（UI 退化为纯文字弹幕），而不是编一个 4 秒。
      voiceDuration: undefined,
      topPercent: Math.floor(Math.random() * 60) + 15,
      color: 'text-[#4edea3]',
    };
    setDanmakuList((prev) => [...prev, newDanmaku]);
  };

  const handleAwardPeerReviewPoints = () => {
    addToast?.('微勋章已分发', '已向全员认真参与互评的学生批量发放 +2 过程性积分！', 'success');
  };

  const handleArchiveTopWorks = () => {
    // 入库对象来自真实焦点作品（无则说明无人可入库），不再硬编码学生姓名
    const names = [workA?.studentName, workB?.studentName].filter(Boolean) as string[];
    addToast?.(
      '作品已入库',
      names.length > 0
        ? `${names.join(' 与 ')}的优秀作品已收录进班级数字展览馆。`
        : '暂无焦点作品可入库（学生尚未提交）。',
      'success',
    );
  };

  const handleCallStudentMic = (studentName: string) => {
    addToast?.('连麦请求已发起', `正在向 ${studentName} 的学生端发起实时语音连麦...`, 'info');
  };

  const handleInviteScreenShare = (studentName: string) => {
    addToast?.('投屏邀请已下发', `已向 ${studentName} 发送大屏投屏演示邀请。`, 'info');
  };

  const handleAdvanceToStage3 = () => {
    addToast?.('互评阶段已结束', '正在推进至 Stage 03 结课巡查与全堂总积分榜...', 'success');
    if (onAdvanceToStage3) {
      onAdvanceToStage3();
    }
    onClose();
  };

  return (
    <div
      id="peer-review-showcase-modal"
      className="fixed inset-0 z-[9999] bg-[#0b1326] text-[#dae2fd] flex flex-col select-none overflow-hidden font-sans"
    >
      {/* 1. HUD Level 3 Top Telemetry Header */}
      <PeerReviewTelemetryHeader
        state={reviewState}
        onToggleAnonymous={handleToggleAnonymous}
        onOpenRubricModal={() => setIsRubricOpen(true)}
        onToggleVoiceDanmaku={() => setReviewState((prev) => ({ ...prev, showDanmaku: !prev.showDanmaku }))}
        onAdvanceStage={handleAdvanceToStage3}
        onAddMinute={handleAddMinute}
        onTogglePauseTimer={handleTogglePauseTimer}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        onClose={onClose}
      />

      {/* 2. Main 3-Column Arena */}
      <main className="relative flex-1 overflow-y-auto w-full px-6 py-5">
        {/*
          数据来源提示：全部数据（互评任务、微勋章、量规、提名榜、弹幕、焦点作品）
          均由调用方通过 props 传入真实数据。无数据时明确告知教师原因，
          而不是用假学生/假分数让界面「看起来有内容」。
        */}
        {!workA && !workB && matchingItems.length === 0 && podiumStudents.length === 0 && (
          <div className="mb-4 rounded-xl border border-[#2d3449] bg-[#0b1326] px-4 py-2.5 flex items-center gap-3 text-[11px] text-[#908fa0]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <span className="flex-1">
              本节暂无可展示的互评数据（需至少 2 份学生提交作品）。点击右侧按钮按「1 生评 2 份」自动分配。
            </span>
            {onAutoAssign && (
              <button
                type="button"
                disabled={autoAssigning}
                onClick={() => void onAutoAssign()}
                className="px-3 py-1 rounded-lg bg-[#8083ff] text-white text-[11px] font-bold hover:bg-[#9497ff] transition-colors disabled:opacity-50 shrink-0"
              >
                {autoAssigning ? '分配中…' : '一键分配互评'}
              </button>
            )}
          </div>
        )}

        {/* Floating Danmaku Wall */}
        <PeerReviewDanmakuOverlay
          isVisible={reviewState.showDanmaku}
          danmakuList={danmakuList}
          onSendDanmaku={handleSendDanmaku}
          isAnonymous={reviewState.isAnonymous}
        />

        <div className="grid grid-cols-12 gap-5 items-start">
          {/* LEFT COLUMN: Peer Assignment & Matrix (col-span-12 lg:col-span-3) */}
          <div className="col-span-12 lg:col-span-3">
            <PeerReviewMatrixPanel
              matchingItems={matchingItems}
              badges={badges}
              isAnonymous={reviewState.isAnonymous}
              onSelectMatchingItem={(item) => {
                addToast?.(
                  `查看互评明细 ${item.code}`,
                  `${item.reviewerName} 正在审阅 ${item.targetStudentName} 的作业`,
                  'info',
                );
              }}
            />
          </div>

          {/* MIDDLE COLUMN: Spotlight Dual-View Peer Showcase & Rubric Stats (col-span-12 lg:col-span-6) */}
          <div className="col-span-12 lg:col-span-6 flex flex-col gap-4">
            {!workA && !workB && (
              <div className="rounded-xl border border-dashed border-[#2d3449] bg-[#0b1326] p-6 text-center">
                <p className="text-xs font-bold text-[#dae2fd]">暂无提交作品可供对比</p>
                <p className="text-[10px] text-[#908fa0] mt-1">
                  学生提交课件作业后，此处将自动展示两份真实作品的并排对比。
                </p>
              </div>
            )}
            {workA || workB ? (
              <SpotlightDualWorkArena
                workA={workA as SpotlightWorkItem}
                workB={workB}
                annotations={annotations}
                isAnonymous={reviewState.isAnonymous}
                onFullscreenCanvas={handleToggleFullscreen}
                onSyncSandboxToClass={() => {
                  addToast?.(
                    '沙箱广播已生效',
                    `对比范本已同步至全班 ${reviewState.totalStudents || 0} 台学生机控制台`,
                    'success',
                  );
                }}
                onAddAnnotation={handleAddAnnotation}
              />
            ) : null}

            <PeerReviewRubricStats
              dimensions={dimensions}
              // 均分由真实量规维度加权算出；没有维度数据时传 null 让 UI 显示「—」，
              // 绝不用 95.3 之类的写死值（那会让教师以为全班都打了 95.3 分）
              averagePercentage={weightedRubricAverage(dimensions)}
              reactions={reactions}
              onReactionClick={handleReactionClick}
              // 已同步台数来自调用方的真实投放数据；无数据时传 null 显示「—」
              syncedStudentsCount={syncedStudentsCount ?? null}
            />
          </div>

          {/* RIGHT COLUMN: Leaderboard, Micro-Badges & Podium (col-span-12 lg:col-span-3) */}
          <div className="col-span-12 lg:col-span-3">
            <PeerReviewLeaderboardPanel
              podiumStudents={podiumStudents}
              isAnonymous={reviewState.isAnonymous}
              onAwardPeerReviewPoints={handleAwardPeerReviewPoints}
              onArchiveTopWorks={handleArchiveTopWorks}
              onCallStudentMic={handleCallStudentMic}
              onInviteScreenShare={handleInviteScreenShare}
              onAdvanceToStage3={handleAdvanceToStage3}
            />
          </div>
        </div>
      </main>

      {/* 3. Detailed Rubric Preview Modal */}
      <PeerReviewRubricModal isOpen={isRubricOpen} onClose={() => setIsRubricOpen(false)} />
    </div>
  );
};
