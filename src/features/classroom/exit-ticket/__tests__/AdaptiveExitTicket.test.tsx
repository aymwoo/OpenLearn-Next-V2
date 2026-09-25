import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AdaptiveExitTicketModal } from '../AdaptiveExitTicketModal';
import { ConceptWordcloudPanel } from '../ConceptWordcloudPanel';
import { KnowledgeTreeLightingModal } from '../KnowledgeTreeLightingModal';

afterEach(cleanup);

describe('Adaptive Exit Ticket & Knowledge Tree Subsystem', () => {
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
      const { container } = render(
        <AdaptiveExitTicketModal isOpen={false} onClose={vi.fn()} lessonId="les-1" />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('回答正确时动态解锁 Lv.2 挑战题分支', () => {
      render(
        <AdaptiveExitTicketModal isOpen={true} onClose={vi.fn()} lessonId="les-1" />,
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
        <AdaptiveExitTicketModal isOpen={true} onClose={vi.fn()} lessonId="les-1" />,
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

    it('提交自适应结课通票并调用 API', async () => {
      const onSuccess = vi.fn();
      render(
        <AdaptiveExitTicketModal
          isOpen={true}
          onClose={vi.fn()}
          lessonId="les-1"
          onSubmitSuccess={onSuccess}
        />,
      );

      // 答题
      fireEvent.click(screen.getByText(/可将位移划分为无限小微元/));
      fireEvent.click(screen.getByText('确认本题答案'));

      // 点击提交
      const submitBtn = screen.getByText('提交自适应结课通票');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText('结课通票提交成功！')).toBeTruthy();
        expect(onSuccess).toHaveBeenCalled();
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
      render(
        <ConceptWordcloudPanel
          concepts={mockConcepts}
          totalFeedbackCount={26}
          avgRating={4.7}
        />,
      );

      expect(screen.getByText('全班困惑概念聚类词云与收口总结')).toBeTruthy();
      expect(screen.getByText('变力做功微元累加')).toBeTruthy();
      expect(screen.getByText('18人')).toBeTruthy();
    });

    it('点击气泡展开 2 分钟收口突破话术建议', () => {
      render(
        <ConceptWordcloudPanel
          concepts={mockConcepts}
          totalFeedbackCount={26}
          avgRating={4.7}
        />,
      );

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
    it('打开时展示前置节点并支持一键点亮核心知识树', async () => {
      render(
        <KnowledgeTreeLightingModal
          isOpen={true}
          onClose={vi.fn()}
          lessonTitle="变力做功与动能定理"
          masteryPercent={88}
        />,
      );

      expect(screen.getByText('课堂知识树即时点亮仪式')).toBeTruthy();
      expect(screen.getByText('变力做功微元累加与动能定理')).toBeTruthy();

      // 点击点亮知识树
      const lightBtn = screen.getByText('🌟 点亮本堂课知识树');
      fireEvent.click(lightBtn);

      await waitFor(
        () => {
          expect(screen.getByTestId('tree-lit-badge')).toBeTruthy();
          expect(screen.getByText(/全班核心素养达成度：88%/)).toBeTruthy();
        },
        { timeout: 1500 },
      );
    });
  });
});
