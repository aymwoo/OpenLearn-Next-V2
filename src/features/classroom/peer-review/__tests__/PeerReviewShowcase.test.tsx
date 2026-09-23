import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PeerReviewTelemetryHeader } from '../PeerReviewTelemetryHeader';
import { PeerReviewMatrixPanel } from '../PeerReviewMatrixPanel';
import { SpotlightDualWorkArena } from '../SpotlightDualWorkArena';
import { PeerReviewRubricStats } from '../PeerReviewRubricStats';
import { PeerReviewLeaderboardPanel } from '../PeerReviewLeaderboardPanel';
import { PeerReviewRubricModal } from '../PeerReviewRubricModal';
import { PeerReviewShowcaseModal } from '../PeerReviewShowcaseModal';
import type {
  PeerReviewState,
  PeerMatchingItem,
  LivePeerBadge,
  SpotlightWorkItem,
  TeacherPeerAnnotation,
  RubricDimensionItem,
  NominatedStudent,
} from '../types';

// Mock plugin renderer
vi.mock('../../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: ({ slot }: { slot: string }) => (
    <div data-testid={`extension-slot-${slot}`}>{slot}</div>
  ),
}));

describe('PeerReviewShowcase Subsystem (Stitch Screen 21e2dac1)', () => {
  afterEach(() => {
    cleanup();
  });
  const defaultState: PeerReviewState = {
    stage: 'STAGE 02.4',
    isLocked: true,
    isDualScreen: true,
    isAnonymous: false,
    timeRemainingSeconds: 138,
    totalTimeSeconds: 180,
    isPaused: false,
    completedReviews: 28,
    totalStudents: 32,
    totalLikes: 142,
    totalNominations: 6,
    showVoiceDanmaku: true,
    showDanmaku: true,
  };

  const sampleMatchingItems: PeerMatchingItem[] = [
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
  ];

  const sampleBadges: LivePeerBadge[] = [
    {
      id: 'b1',
      senderName: '赵若冰',
      receiverName: '林浩',
      badgeTitle: '【思路精妙】徽章',
      emoji: '🎉',
      tagColor: 'text-amber-400',
    },
  ];

  const sampleWorkA: SpotlightWorkItem = {
    id: 'work-a',
    slot: 'A',
    studentName: '陈子墨',
    studentInitial: '墨',
    workTitle: '陈子墨 (作品 A)',
    workSubtitle: '六色动态多边形螺旋',
    rating: 4.9,
    reviewCount: 12,
    badges: [{ label: '🔥 最具创意视觉', colorClass: 'bg-amber-500/20 text-amber-300' }],
    visualType: 'polygon_spiral',
    visualBadgeText: '60 FPS SANDBOX',
    codeTitle: '六色动态螺旋与自适应笔触',
    codeLines: [
      { text: "colors = ['#c0c1ff', '#4edea3', '#ffb95f']" },
      { text: 'for i in range(120):', isHighlight: true },
    ],
  };

  const sampleWorkB: SpotlightWorkItem = {
    id: 'work-b',
    slot: 'B',
    studentName: '张子豪',
    studentInitial: '豪',
    workTitle: '张子豪 (作品 B)',
    workSubtitle: '逆风翻盘 · 变式缩进修正版',
    rating: 4.8,
    reviewCount: 10,
    badges: [{ label: '💪 最佳进步奖', colorClass: 'bg-emerald-500/20 text-emerald-300' }],
    visualType: 'rect_matrix',
    visualBadgeText: '缩进修复运行成功',
    codeTitle: '修复了缩进错位后的四边形矩阵',
    codeLines: [
      { text: 't.forward(step * 2)', isSuccess: true, comment: '# ✓ 修正：已对齐4空格' },
    ],
  };

  const sampleAnnotations: TeacherPeerAnnotation[] = [
    {
      id: 'a1',
      authorType: 'teacher',
      authorRole: '主讲教师',
      authorName: '陈老师',
      timeAgo: '1分钟前',
      content: '大家重点看作品B第4-5行，缩进对齐后循环生效！',
      borderColor: '#8083ff',
    },
  ];

  const sampleDimensions: RubricDimensionItem[] = [
    { id: 'd1', label: '算法逻辑正确性', percentage: 98, colorClass: 'text-indigo-400', barColorClass: 'bg-indigo-500' },
    { id: 'd2', label: '代码规范与缩进', percentage: 96, colorClass: 'text-emerald-400', barColorClass: 'bg-emerald-500' },
  ];

  const samplePodium: NominatedStudent[] = [
    {
      rank: 1,
      name: '陈子墨',
      votes: 18,
      workTitle: '五色动态螺线',
      honorTitle: '最佳开源作者',
      rankBadgeClass: 'bg-amber-400 text-black',
      tagBadgeClass: 'bg-amber-400/20 text-amber-300',
    },
    {
      rank: 2,
      name: '张子豪',
      votes: 14,
      workTitle: '经典缩进纠错范本',
      honorTitle: '最佳自愈实践',
      rankBadgeClass: 'bg-slate-700 text-white',
      tagBadgeClass: 'bg-emerald-500/20 text-emerald-300',
    },
  ];

  describe('1. PeerReviewTelemetryHeader', () => {
    it('renders breadcrumb, stage status, countdown and submissions accurately', () => {
      render(
        <PeerReviewTelemetryHeader
          state={defaultState}
          onToggleAnonymous={vi.fn()}
          onOpenRubricModal={vi.fn()}
          onToggleVoiceDanmaku={vi.fn()}
          onAdvanceStage={vi.fn()}
        />,
      );

      expect(screen.getByText('STAGE 02.4')).toBeDefined();
      expect(screen.getByText(/全班大屏协同互评阶段/)).toBeDefined();
      expect(screen.getByText(/02:18/)).toBeDefined();
      expect(screen.getByText(/28 \/ 32 人已评/)).toBeDefined();
      expect(screen.getByText(/142 次点赞/)).toBeDefined();
      expect(screen.getByTestId('extension-slot-peer_review.action')).toBeDefined();
    });

    it('triggers action callbacks when clicking buttons', () => {
      const onToggleAnon = vi.fn();
      const onOpenRubric = vi.fn();
      const onToggleDanmaku = vi.fn();
      const onAdvance = vi.fn();
      const onAddMin = vi.fn();

      render(
        <PeerReviewTelemetryHeader
          state={defaultState}
          onToggleAnonymous={onToggleAnon}
          onOpenRubricModal={onOpenRubric}
          onToggleVoiceDanmaku={onToggleDanmaku}
          onAdvanceStage={onAdvance}
          onAddMinute={onAddMin}
        />,
      );

      fireEvent.click(screen.getByLabelText(/双盲匿名/));
      expect(onToggleAnon).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText('互评量规'));
      expect(onOpenRubric).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText('全员语音弹幕'));
      expect(onToggleDanmaku).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText('揭晓勋章榜'));
      expect(onAdvance).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText('+1m'));
      expect(onAddMin).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. PeerReviewMatrixPanel', () => {
    it('renders smart cross matching feed and live badge stream', () => {
      render(
        <PeerReviewMatrixPanel
          matchingItems={sampleMatchingItems}
          badges={sampleBadges}
          isAnonymous={false}
        />,
      );

      expect(screen.getByText('智能交叉互评')).toBeDefined();
      expect(screen.getByText('1生评2份')).toBeDefined();
      expect(screen.getByText('#P01')).toBeDefined();
      expect(screen.getByText(/张子豪/)).toBeDefined();
      expect(screen.getByText(/陈子墨 · 标杆五边形螺旋/)).toBeDefined();
      expect(screen.getByText('【思路精妙】徽章')).toBeDefined();
      expect(screen.getByTestId('extension-slot-peer_review.badge')).toBeDefined();
    });

    it('masks student names when isAnonymous is true', () => {
      render(
        <PeerReviewMatrixPanel
          matchingItems={sampleMatchingItems}
          badges={sampleBadges}
          isAnonymous={true}
        />,
      );

      expect(screen.getByText(/张\*\*/)).toBeDefined();
      expect(screen.getByText(/陈\*\* · 标杆五边形螺旋/)).toBeDefined();
    });
  });

  describe('3. SpotlightDualWorkArena', () => {
    it('renders dual works side by side with code and annotations', () => {
      render(
        <SpotlightDualWorkArena
          workA={sampleWorkA}
          workB={sampleWorkB}
          annotations={sampleAnnotations}
          isAnonymous={false}
        />,
      );

      expect(screen.getByText('大屏焦点作品对比赏析')).toBeDefined();
      expect(screen.getByText(/陈子墨 \(作品 A\)/)).toBeDefined();
      expect(screen.getByText('60 FPS SANDBOX')).toBeDefined();
      expect(screen.getByText(/张子豪 \(作品 B\)/)).toBeDefined();
      expect(screen.getByText('缩进修复运行成功')).toBeDefined();
      expect(screen.getByText(/大家重点看作品B第4-5行/)).toBeDefined();
      expect(screen.getByTestId('extension-slot-peer_review.showcase.widget')).toBeDefined();
    });

    it('supports adding a teacher annotation', () => {
      const onAddAnn = vi.fn();
      render(
        <SpotlightDualWorkArena
          workA={sampleWorkA}
          workB={sampleWorkB}
          annotations={sampleAnnotations}
          onAddAnnotation={onAddAnn}
        />,
      );

      fireEvent.click(screen.getByText('+ 追加教师批注'));
      const input = screen.getByPlaceholderText('输入大屏协同批注要点...');
      fireEvent.change(input, { target: { value: '测试批注内容' } });
      fireEvent.click(screen.getByText('发送批注'));

      expect(onAddAnn).toHaveBeenCalledWith('测试批注内容');
    });
  });

  describe('4. PeerReviewRubricStats', () => {
    it('renders 3D rubric bars and responds to reaction clicks', () => {
      const onReaction = vi.fn();
      const reactions = [
        { id: 'like', emoji: '❤️', label: '超赞', count: 68, colorClass: 'text-indigo-400' },
      ];

      render(
        <PeerReviewRubricStats
          dimensions={sampleDimensions}
          averagePercentage={97.0}
          reactions={reactions}
          onReactionClick={onReaction}
          syncedStudentsCount={32}
        />,
      );

      expect(screen.getByText('全班三维量规综合达标率')).toBeDefined();
      expect(screen.getByText('AVERAGE: 97.0%')).toBeDefined();
      expect(screen.getByText('算法逻辑正确性')).toBeDefined();
      expect(screen.getByText('98%')).toBeDefined();
      expect(screen.getByText(/32台学生端已同步点赞动画/)).toBeDefined();
      expect(screen.getByTestId('extension-slot-peer_review.rubric.dimension')).toBeDefined();

      fireEvent.click(screen.getByText('超赞'));
      expect(onReaction).toHaveBeenCalledWith('like');
    });
  });

  describe('5. PeerReviewLeaderboardPanel', () => {
    it('renders podium ranks, micro-badges dispatcher and broadcast buttons', () => {
      const onAward = vi.fn();
      const onArchive = vi.fn();
      const onCall = vi.fn();
      const onShare = vi.fn();
      const onAdvance = vi.fn();

      render(
        <PeerReviewLeaderboardPanel
          podiumStudents={samplePodium}
          onAwardPeerReviewPoints={onAward}
          onArchiveTopWorks={onArchive}
          onCallStudentMic={onCall}
          onInviteScreenShare={onShare}
          onAdvanceToStage3={onAdvance}
        />,
      );

      expect(screen.getByText('互评推荐先锋榜')).toBeDefined();
      expect(screen.getByText('陈子墨')).toBeDefined();
      expect(screen.getByText('18 票推荐')).toBeDefined();

      fireEvent.click(screen.getByText('为全员互评认真学生 +2 积分'));
      expect(onAward).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText('TOP 2 优秀代码入库数字馆'));
      expect(onArchive).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText(/连麦作者/));
      expect(onCall).toHaveBeenCalledWith('陈子墨');

      fireEvent.click(screen.getByText(/邀请.*投屏/));
      expect(onShare).toHaveBeenCalledWith('张子豪');

      fireEvent.click(screen.getByText('结束互评，公布全堂总积分榜与学情报告'));
      expect(onAdvance).toHaveBeenCalledTimes(1);
    });
  });

  describe('6. PeerReviewRubricModal', () => {
    it('renders rubric criteria modal and closes on button click', () => {
      const onClose = vi.fn();
      render(<PeerReviewRubricModal isOpen={true} onClose={onClose} />);

      expect(screen.getByText('随堂交叉互评量规细则')).toBeDefined();
      expect(screen.getByText(/算法逻辑正确性 \(40% 权重\)/)).toBeDefined();
      expect(screen.getByText(/代码规范与缩进 \(30% 权重\)/)).toBeDefined();
      expect(screen.getByText(/创意美感与拓展 \(30% 权重\)/)).toBeDefined();

      fireEvent.click(screen.getByText('我已知晓'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('7. PeerReviewShowcaseModal Integration', () => {
    it('renders master showcase modal and handles Enter hotkey to advance stage', () => {
      const onClose = vi.fn();
      const onAdvance = vi.fn();
      const addToast = vi.fn();

      render(
        <PeerReviewShowcaseModal
          isOpen={true}
          onClose={onClose}
          onAdvanceToStage3={onAdvance}
          addToast={addToast}
        />,
      );

      expect(screen.getByText('STAGE 02.4')).toBeDefined();
      expect(screen.getByText('智能交叉互评')).toBeDefined();
      expect(screen.getByText('大屏焦点作品对比赏析')).toBeDefined();
      expect(screen.getByText('互评推荐先锋榜')).toBeDefined();

      // Press Enter to advance
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(onAdvance).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('handles Escape hotkey to close modal directly', () => {
      const onClose = vi.fn();

      render(
        <PeerReviewShowcaseModal
          isOpen={true}
          onClose={onClose}
        />,
      );

      // Press Escape to close
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
