import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AdaptiveExitTicketModal } from '../AdaptiveExitTicketModal';
import { ConceptWordcloudPanel } from '../ConceptWordcloudPanel';
import { KnowledgeTreeLightingModal } from '../KnowledgeTreeLightingModal';

afterEach(cleanup);

describe('Adaptive Exit Ticket & Knowledge Tree Subsystem', () => {
  // v0.6.1 数据真实性：生产代码不再内置写死的物理题 —— 题目必须由宿主传入。
  // 测试夹具在此显式定义（机制测试用）。
  const TEST_CORE_QUESTION = {
    id: 'core-q-1',
    question: '关于变力沿曲线轨道做功过程，下列说法严格正确的是：',
    options: [
      { key: 'A', text: '可以直接利用恒力做功公式 W = F·s·cosθ 统一计算' },
      { key: 'B', text: '可将位移划分为无限小微元 Δs，在每个微元内以恒代变累加求和' },
      { key: 'C', text: '只要动能有变化，机械能一定严格守恒' },
      { key: 'D', text: '变力做功的数值与运动路径完全无关' },
    ],
    correctOption: 'B',
    explanation: '变力方向或大小随位置改变，不能直接套用恒力公式；微元法是求解变力功的根本方法。',
    scaffoldHint: '⚠️ 巩固支架提示：请回顾牛顿第二定律与微积分思想，变力必须采用 F-s 面积或微元累加！',
  };

  const TEST_CHALLENGE_QUESTION = {
    id: 'challenge-q-1',
    title: '高阶思维跃迁',
    prompt: '若物块在变阻力 f = -kv 作用下滑动并与弹性挡板碰撞，下列守恒与极限关系成立的是：',
    options: [
      { key: 'A', text: '全程动量守恒且机械能保持守恒' },
      { key: 'B', text: '当速度衰减为 0 前，系统动量损耗率与瞬时阻力成正比' },
      { key: 'C', text: '滑动阻力做功仅取决于物块最终停止位置与重力势能无关' },
      { key: 'D', text: '以上均不正确' },
    ],
    correctOption: 'B',
    rewardBadge: '🏅 物理探究思维跃迁徽章',
  };

  describe('1. AdaptiveExitTicketModal', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ success: true }),
        }),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('关闭时不渲染任何元素', () => {
      const { container } = render(<AdaptiveExitTicketModal isOpen={false} onClose={vi.fn()} lessonId="les-1" />);
      expect(container.firstChild).toBeNull();
    });

    it('回答正确时动态解锁 Lv.2 挑战题分支', () => {
      render(
        <AdaptiveExitTicketModal
          isOpen={true}
          onClose={vi.fn()}
          lessonId="les-1"
          coreQuestion={TEST_CORE_QUESTION}
          challengeQuestion={TEST_CHALLENGE_QUESTION}
        />,
      );

      expect(screen.getByText('1. 核心概念过关题')).toBeTruthy();

      // 选择正确选项 B
      const optionB = screen.getByText(/可将位移划分为无限小微元/);
      fireEvent.click(optionB);

      // 点击确认答案
      fireEvent.click(screen.getByText('确认本题答案'));

      // 验证自适应展开了 Lv.2 挑战题
      expect(screen.getByTestId('challenge-branch')).toBeTruthy();
      expect(screen.getByText(/Lv.2 进阶探究挑战题/)).toBeTruthy();
      expect(screen.getByText('✓ 概念通关')).toBeTruthy();
    });

    it('回答错误时动态解锁核心概念支架提示卡分支', () => {
      render(
        <AdaptiveExitTicketModal
          isOpen={true}
          onClose={vi.fn()}
          lessonId="les-1"
          coreQuestion={TEST_CORE_QUESTION}
          challengeQuestion={TEST_CHALLENGE_QUESTION}
        />,
      );

      // 选择错误选项 A
      const optionA = screen.getByText(/可以直接利用恒力做功公式/);
      fireEvent.click(optionA);

      fireEvent.click(screen.getByText('确认本题答案'));

      // 验证自适应展开了支架提示
      expect(screen.getByTestId('scaffold-branch')).toBeTruthy();
      expect(screen.getByText('核心概念支架提示卡')).toBeTruthy();
      expect(screen.getByText('需巩固')).toBeTruthy();
    });

    it('未传题目时只渲染评分/反馈 —— 不再内置写死物理题（数据真实性回归钉）', () => {
      render(<AdaptiveExitTicketModal isOpen={true} onClose={vi.fn()} lessonId="les-1" />);
      expect(screen.queryByText('1. 核心概念过关题')).toBeNull();
      expect(screen.queryByText(/变力沿曲线轨道做功/)).toBeNull();
      // 评分与困惑点输入仍然可用
      expect(screen.getByText(/今日课堂综合掌握感评估/)).toBeTruthy();
      expect(screen.getByText(/今天最困惑或没完全搞懂/)).toBeTruthy();
    });

    it('提交自适应结课通票并调用 API', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      render(
        <AdaptiveExitTicketModal
          isOpen={true}
          onClose={onClose}
          lessonId="les-1"
          onSubmitSuccess={onSuccess}
          coreQuestion={TEST_CORE_QUESTION}
          challengeQuestion={TEST_CHALLENGE_QUESTION}
        />,
      );

      // 答题
      fireEvent.click(screen.getByText(/可将位移划分为无限小微元/));
      fireEvent.click(screen.getByText('确认本题答案'));

      // 点击提交 —— 产品语义：POST /exit-ticket 成功后立即回调 onSubmitSuccess，
      // 同时渲染成功页。此处精确断言「恰好一次」，防止回调被意外重复触发。
      const submitBtn = screen.getByText('提交自适应结课通票');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText('结课通票提交成功！')).toBeTruthy();
        expect(onSuccess).toHaveBeenCalledTimes(1);
      });

      // 成功页「完成」关闭弹窗
      fireEvent.click(screen.getByText('完成'));
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe('2. ConceptWordcloudPanel', () => {
    const mockConcepts = [
      {
        concept: '变力做功微元累加',
        frequency: 18,
        weight: 0.6,
        remediationAdvice: '强调 F-s 面积的几何与代数对应关系。',
      },
      {
        concept: '摩擦突变临界边界',
        frequency: 8,
        weight: 0.3,
        remediationAdvice: '先判断相对运动趋势再列平衡方程。',
      },
    ];

    it('渲染词云气泡与梯级达成度概况', () => {
      render(<ConceptWordcloudPanel concepts={mockConcepts} totalFeedbackCount={26} avgRating={4.7} />);

      expect(screen.getByText('全班困惑概念聚类词云与收口总结')).toBeTruthy();
      expect(screen.getByText('变力做功微元累加')).toBeTruthy();
      expect(screen.getByText('18人')).toBeTruthy();
    });

    it('点击气泡展开 2 分钟收口突破话术建议', () => {
      render(<ConceptWordcloudPanel concepts={mockConcepts} totalFeedbackCount={26} avgRating={4.7} />);

      const adviceBox = screen.getByTestId('recap-advice-box');
      expect(adviceBox).toBeTruthy();
      expect(screen.getByText('强调 F-s 面积的几何与代数对应关系。')).toBeTruthy();
    });

    it('点击点亮知识树触发回调', () => {
      const onOpenTree = vi.fn();
      render(
        <ConceptWordcloudPanel
          concepts={mockConcepts}
          totalFeedbackCount={26}
          avgRating={4.7}
          onOpenKnowledgeTree={onOpenTree}
        />,
      );

      const lightBtn = screen.getByText('🌟 点亮本堂课知识树');
      fireEvent.click(lightBtn);
      expect(onOpenTree).toHaveBeenCalled();
    });
  });

  describe('3. KnowledgeTreeLightingModal', () => {
    it('真实困惑点驱动知识树：展示节点并支持一键点亮', async () => {
      render(
        <KnowledgeTreeLightingModal
          isOpen={true}
          onClose={vi.fn()}
          lessonTitle="变力做功与动能定理"
          masteryPercent={88}
          puzzledConcepts={['变力做功微元累加与动能定理']}
        />,
      );

      expect(screen.getByText('课堂知识树即时点亮仪式')).toBeTruthy();
      expect(screen.getByText('变力做功微元累加与动能定理')).toBeTruthy();

      // 点击点亮知识树
      const lightBtn = screen.getByText('🌟 点亮本堂课困惑点知识树');
      fireEvent.click(lightBtn);

      await waitFor(
        () => {
          expect(screen.getByTestId('tree-lit-badge')).toBeTruthy();
        },
        { timeout: 1500 },
      );
    });
  });
});
