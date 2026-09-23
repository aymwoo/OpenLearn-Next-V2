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

export interface PeerReviewShowcaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdvanceToStage3?: () => void;
  lessonTitle?: string;
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const PeerReviewShowcaseModal: React.FC<PeerReviewShowcaseModalProps> = ({
  isOpen,
  onClose,
  onAdvanceToStage3,
  lessonTitle = 'Python 进阶与图形化编程',
  addToast,
}) => {
  // ── State ─────────────────────────────────────────────────────────────
  const [reviewState, setReviewState] = useState<PeerReviewState>({
    stage: 'STAGE 02.4',
    isLocked: true,
    isDualScreen: true,
    isAnonymous: true,
    timeRemainingSeconds: 138, // 02:18
    totalTimeSeconds: 180, // 03:00
    isPaused: false,
    completedReviews: 28,
    totalStudents: 32,
    totalLikes: 142,
    totalNominations: 6,
    showVoiceDanmaku: true,
    showDanmaku: true,
  });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRubricOpen, setIsRubricOpen] = useState(false);

  // ── Initial Mock Data based on Stitch 21e2dac1 ─────────────────────────
  const [matchingItems, setMatchingItems] = useState<PeerMatchingItem[]>([
    {
      id: 'm1',
      code: '#P01',
      reviewerName: '张子豪',
      reviewerGroup: '攻坚组',
      targetStudentName: '陈子墨',
      targetWorkTitle: '标杆五边形螺旋',
      status: 'submitted',
      statusLabel: '已提交评语',
      score: 5.0,
      maxScore: 5.0,
      stars: 5,
      comment: '画笔粗细自适应很巧妙，颜色过渡的取模算法好严谨！',
    },
    {
      id: 'm2',
      code: '#P02',
      reviewerName: '李晓彤',
      reviewerGroup: '95分',
      targetStudentName: '王语嫣',
      targetWorkTitle: '螺旋多边形变式',
      status: 'in_progress',
      statusLabel: '正在推导 (2/3)',
      progressPercent: 66,
    },
    {
      id: 'm3',
      code: '#P03',
      reviewerName: '周雨彤',
      reviewerGroup: '90分',
      targetStudentName: '孙小博',
      targetWorkTitle: '几何迭代实验',
      status: 'completed',
      statusLabel: '已完成',
      score: 4.8,
      maxScore: 5.0,
      stars: 5,
    },
    {
      id: 'm4',
      code: '#P04',
      reviewerName: '钱浩宇',
      reviewerGroup: '100分',
      targetStudentName: '何雨辰',
      targetWorkTitle: '画笔循环优化题',
      status: 'improvement',
      statusLabel: '提出改进建议 💡',
      score: 4.5,
      maxScore: 5.0,
      stars: 4,
    },
  ]);

  const [badges, setBadges] = useState<LivePeerBadge[]>([
    {
      id: 'b1',
      senderName: '赵若冰',
      receiverName: '林浩',
      badgeTitle: '【思路精妙】徽章',
      emoji: '🎉',
      tagColor: 'text-[#ffb95f]',
    },
    {
      id: 'b2',
      senderName: '郑凯文',
      receiverName: '张子豪',
      badgeTitle: '【纠错自愈标杆】',
      emoji: '💡',
      tagColor: 'text-[#4edea3]',
    },
    {
      id: 'b3',
      senderName: '吴敏',
      receiverName: '陈子墨',
      badgeTitle: '最佳开源解法',
      emoji: '⚡',
      tagColor: 'text-[#c0c1ff]',
    },
  ]);

  const [workA, setWorkA] = useState<SpotlightWorkItem>({
    id: 'work-a',
    slot: 'A',
    studentName: '陈子墨',
    studentInitial: '墨',
    workTitle: '陈子墨 (作品 A)',
    workSubtitle: '六色动态多边形螺旋',
    rating: 4.9,
    reviewCount: 12,
    badges: [
      { label: '🔥 最具创意视觉', colorClass: 'bg-[#ca8100]/30 text-[#ffb95f]' },
      { label: '代码规范标兵', colorClass: 'bg-[#00a572]/20 text-[#4edea3]' },
    ],
    visualType: 'polygon_spiral',
    visualBadgeText: '60 FPS SANDBOX',
    codeTitle: '六色动态螺旋与自适应笔触',
    codeLines: [
      { text: "colors = ['#c0c1ff', '#4edea3', '#ffb95f']" },
      { text: 'for i in range(120):', isHighlight: true },
      { text: 't.pencolor(colors[i % 3])', isHighlight: true, indent: 1 },
      { text: 't.width(i / 30 + 1)', indent: 1 },
      { text: 't.forward(i * 1.5)', indent: 1 },
      { text: 't.left(72)', indent: 1, comment: '# 动态正五边形外角' },
    ],
  });

  const [workB, setWorkB] = useState<SpotlightWorkItem>({
    id: 'work-b',
    slot: 'B',
    studentName: '张子豪',
    studentInitial: '豪',
    workTitle: '张子豪 (作品 B)',
    workSubtitle: '逆风翻盘 · 变式缩进修正版',
    rating: 4.8,
    reviewCount: 10,
    badges: [
      { label: '💪 最佳进步奖', colorClass: 'bg-[#00a572]/20 text-[#4edea3]' },
      { label: '韧性极客标杆', colorClass: 'bg-[#8083ff]/20 text-[#c0c1ff]' },
    ],
    visualType: 'rect_matrix',
    visualBadgeText: '缩进修复运行成功',
    codeTitle: '修复了缩进错位后的四边形矩阵',
    codeLines: [
      { text: 'sides = 4; angle = 360 / sides + 18' },
      { text: 'for step in range(80):' },
      { text: 't.forward(step * 2)', isSuccess: true, indent: 1, comment: '# ✓ 修正：已对齐4空格' },
      { text: 't.right(angle)', isSuccess: true, indent: 1, comment: '# ✓ 循环体内执行正常' },
      { text: 't.speed(0)', indent: 1 },
    ],
  });

  const [annotations, setAnnotations] = useState<TeacherPeerAnnotation[]>([
    {
      id: 'a1',
      authorType: 'teacher',
      authorRole: '主讲教师',
      authorName: '陈老师',
      timeAgo: '1分钟前',
      content: '大家重点看作品B第4-5行，缩进对齐后循环变量每轮自增生效，图形才呈现出规整的发散美！',
      borderColor: '#8083ff',
    },
    {
      id: 'a2',
      authorType: 'peer',
      authorRole: '互评员',
      authorName: '李晓彤',
      timeAgo: '刚刚',
      content: '作品A用 `colors[i % 3]` 进行模运算循环取色，不仅避免了列表越界，还让画面色彩具有规律律动。',
      borderColor: '#00a572',
    },
  ]);

  const [dimensions] = useState<RubricDimensionItem[]>([
    {
      id: 'd1',
      label: '算法逻辑正确性',
      percentage: 98,
      colorClass: 'text-[#c0c1ff]',
      barColorClass: 'bg-[#8083ff]',
    },
    {
      id: 'd2',
      label: '代码规范与缩进',
      percentage: 96,
      colorClass: 'text-[#4edea3]',
      barColorClass: 'bg-[#00a572]',
    },
    {
      id: 'd3',
      label: '创意美感与拓展',
      percentage: 92,
      colorClass: 'text-[#ffb95f]',
      barColorClass: 'bg-[#ca8100]',
    },
  ]);

  const [reactions, setReactions] = useState<ReactionCountItem[]>([
    { id: 'like', emoji: '❤️', label: '超赞', count: 68, colorClass: 'text-[#c0c1ff]' },
    { id: 'inspire', emoji: '💡', label: '灵感启迪', count: 24, colorClass: 'text-[#ffb95f]' },
    { id: 'rigor', emoji: '📐', label: '极度严谨', count: 15, colorClass: 'text-[#4edea3]' },
  ]);

  const [podiumStudents] = useState<NominatedStudent[]>([
    {
      rank: 1,
      name: '陈子墨',
      votes: 18,
      workTitle: '五色动态螺线',
      honorTitle: '最佳开源作者',
      rankBadgeClass: 'bg-[#ffb95f] text-[#2a1700]',
      tagBadgeClass: 'bg-[#ca8100]/20 text-[#ffb95f]',
    },
    {
      rank: 2,
      name: '张子豪',
      votes: 14,
      workTitle: '经典缩进纠错范本',
      honorTitle: '最佳自愈实践',
      rankBadgeClass: 'bg-[#2d3449] text-white',
      tagBadgeClass: 'bg-[#00a572]/20 text-[#4edea3]',
    },
    {
      rank: 3,
      name: '李晓彤',
      votes: 11,
      workTitle: '极简行数高分解',
      honorTitle: '精简代码标兵',
      rankBadgeClass: 'bg-[#2d3449] text-white',
      tagBadgeClass: 'bg-[#171f33] text-[#908fa0]',
    },
  ]);

  const [danmakuList, setDanmakuList] = useState<DanmakuItem[]>([
    { id: 'd1', sender: '林浩', text: '这个模运算真的绝了！', topPercent: 15 },
    { id: 'd2', sender: '王语嫣', text: '作品B的修复思路太清晰啦 🚀', topPercent: 32 },
    { id: 'd3', sender: '何雨辰', text: '给子墨投了一票！', topPercent: 50 },
    { id: 'd4', sender: '周雨彤', text: '原来缩进对齐后效果这么惊艳', topPercent: 68, type: 'voice', voiceDuration: 3 },
  ]);

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
    setReactions((prev) =>
      prev.map((r) => (r.id === id ? { ...r, count: r.count + 1 } : r)),
    );
    setReviewState((prev) => ({ ...prev, totalLikes: prev.totalLikes + 1 }));
  };

  const handleAddAnnotation = (content: string) => {
    const newAnn: TeacherPeerAnnotation = {
      id: `ann-${Date.now()}`,
      authorType: 'teacher',
      authorRole: '主讲教师',
      authorName: '陈老师',
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
      sender: '主讲教师',
      text,
      type,
      voiceDuration: type === 'voice' ? 4 : undefined,
      topPercent: Math.floor(Math.random() * 60) + 15,
      color: 'text-[#4edea3]',
    };
    setDanmakuList((prev) => [...prev, newDanmaku]);
  };

  const handleAwardPeerReviewPoints = () => {
    addToast?.(
      '微勋章已分发',
      '已向全员认真参与互评的学生批量发放 +2 过程性积分！',
      'success',
    );
  };

  const handleArchiveTopWorks = () => {
    addToast?.(
      '作品已入库',
      '陈子墨与张子豪的优秀作品已收录进班级数字展览馆。',
      'success',
    );
  };

  const handleCallStudentMic = (studentName: string) => {
    addToast?.(
      '连麦请求已发起',
      `正在向 ${studentName} 的学生端发起实时语音连麦...`,
      'info',
    );
  };

  const handleInviteScreenShare = (studentName: string) => {
    addToast?.(
      '投屏邀请已下发',
      `已向 ${studentName} 发送大屏投屏演示邀请。`,
      'info',
    );
  };

  const handleAdvanceToStage3 = () => {
    addToast?.(
      '互评阶段已结束',
      '正在推进至 Stage 03 结课巡查与全堂总积分榜...',
      'success',
    );
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
        onToggleVoiceDanmaku={() =>
          setReviewState((prev) => ({ ...prev, showDanmaku: !prev.showDanmaku }))
        }
        onAdvanceStage={handleAdvanceToStage3}
        onAddMinute={handleAddMinute}
        onTogglePauseTimer={handleTogglePauseTimer}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        onClose={onClose}
      />

      {/* 2. Main 3-Column Arena */}
      <main className="relative flex-1 overflow-y-auto w-full px-6 py-5">
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
            <SpotlightDualWorkArena
              workA={workA}
              workB={workB}
              annotations={annotations}
              isAnonymous={reviewState.isAnonymous}
              onFullscreenCanvas={handleToggleFullscreen}
              onSyncSandboxToClass={() => {
                addToast?.(
                  '沙箱广播已生效',
                  '对比范本已同步至全班 32 台学生机控制台',
                  'success',
                );
              }}
              onAddAnnotation={handleAddAnnotation}
            />

            <PeerReviewRubricStats
              dimensions={dimensions}
              averagePercentage={95.3}
              reactions={reactions}
              onReactionClick={handleReactionClick}
              syncedStudentsCount={32}
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
      <PeerReviewRubricModal
        isOpen={isRubricOpen}
        onClose={() => setIsRubricOpen(false)}
      />
    </div>
  );
};
