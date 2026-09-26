import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreClassDiagnosticHub } from '../PreClassDiagnosticHub';
import { PreflightHealthModal } from '../PreflightHealthModal';
import { PreClassReadyView } from '../PreClassReadyView';

describe('PreClassDiagnosticHub & Pre-Class Enhancements', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/pre-class-diagnostic')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              lessonId: 'lesson-101',
              lessonTitle: '物理必修一：牛顿第二定律',
              prepSummary: {
                totalStudents: 30,
                completedCount: 27,
                pendingCount: 3,
                completionRate: 90,
                averageTimeSpentMins: 15,
              },
              topMistakes: [
                {
                  rank: 1,
                  concept: '瞬时加速度与突变受力分析',
                  mistakeRate: 65,
                  sampleQuestion: '轻弹簧与轻绳在剪断瞬间的加速度差异',
                  pedagogicalAdvice: '建议使用随堂受力微仿真模拟演示',
                  status: 'high_priority',
                },
                {
                  rank: 2,
                  concept: '连结体整体法与隔离法转换',
                  mistakeRate: 48,
                  sampleQuestion: '两物块具有不同加速度时的牛二定律应用',
                  pedagogicalAdvice: '建议在环节二使用白板双色画笔逐一隔离',
                  status: 'medium_priority',
                },
                {
                  rank: 3,
                  concept: '超重与失重状态的本质判定',
                  mistakeRate: 28,
                  sampleQuestion: '电梯减速上升过程中的视重与实重对比',
                  pedagogicalAdvice: '抽问基础层同学回答视重定义',
                  status: 'low_priority',
                },
              ],
              icebreakerStats: {
                fullPower: 20,
                needCoffee: 8,
                needHelp: 2,
              },
            }),
        });
      }

      if (url.includes('/preflight-health')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              classId: 'class-1',
              healthScore: 99,
              status: 'healthy',
              checks: {
                localApiLatencyMs: 4,
                staticResources: { status: 'passed', message: '课件媒体文件已校验完整' },
                pluginSandbox: { status: 'passed', message: '微前端沙箱策略就绪' },
                socketMesh: { status: 'passed', message: '局域网通信正常' },
              },
            }),
        });
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    global.fetch = fetchMock as any;
    window.fetch = fetchMock as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('PreClassDiagnosticHub Component', () => {
    it('renders prep summary with completion percentage', async () => {
      render(<PreClassDiagnosticHub lessonId="lesson-101" classId="class-1" lang="zh" />);

      expect(screen.getByText(/预习学情穿透看板/)).toBeDefined();

      await waitFor(() => {
        expect(screen.getByText('90%')).toBeDefined();
        expect(screen.getByText('(27/30 人)')).toBeDefined();
      });
    });

    it('displays Top 3 mistake concepts and allows expanding teaching strategy', async () => {
      render(<PreClassDiagnosticHub lessonId="lesson-101" classId="class-1" lang="zh" />);

      await waitFor(() => {
        expect(screen.getAllByText('瞬时加速度与突变受力分析').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('连结体整体法与隔离法转换').length).toBeGreaterThanOrEqual(1);
      });

      // Expand rank 2
      const rank2 = screen.getAllByText('连结体整体法与隔离法转换')[0];
      fireEvent.click(rank2);

      await waitFor(() => {
        expect(screen.getByText(/建议在环节二使用白板双色画笔逐一隔离/)).toBeDefined();
      });
    });

    it('renders honest empty states when no diagnostic data exists', async () => {
      fetchMock.mockImplementationOnce((url: string) => {
        if (url.includes('/pre-class-diagnostic')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                lessonId: 'lesson-102',
                prepSummary: {
                  totalStudents: 30,
                  completedCount: 0,
                  pendingCount: 30,
                  completionRate: 0,
                  averageTimeSpentMins: 0,
                },
                topMistakes: [],
                icebreakerStats: { fullPower: 0, needCoffee: 0, needHelp: 0 },
              }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      render(<PreClassDiagnosticHub lessonId="lesson-102" classId="class-1" lang="zh" />);

      await waitFor(() => {
        expect(screen.getByText('0%')).toBeDefined();
        expect(screen.getByText('(0/30 人)')).toBeDefined();
        expect(screen.getByText(/等待学生课前打卡破冰/)).toBeDefined();
        expect(screen.getByText(/暂无前置练习错题卡点/)).toBeDefined();
      });
    });
  });

  describe('PreflightHealthModal Component', () => {
    it('runs preflight environmental healthcheck and displays latency and overall score', async () => {
      const onClose = vi.fn();
      render(
        <PreflightHealthModal
          isOpen={true}
          onClose={onClose}
          classId="class-1"
          className="高一(3)班"
          lang="zh"
        />,
      );

      expect(screen.getAllByText(/课前环境一键预检飞检/).length).toBeGreaterThanOrEqual(1);

      await waitFor(() => {
        expect(screen.getByText('99 / 100')).toBeDefined();
        expect(screen.getByText('4 ms')).toBeDefined();
        expect(screen.getByText('课件媒体文件已校验完整')).toBeDefined();
      });

      // Dismiss modal
      fireEvent.click(screen.getByText('完成自检并返回'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('PreClassReadyView Dynamic Check-in & Healthcheck integration', () => {
    it('renders dynamic 4-digit check-in OTP and environmental healthcheck trigger button', () => {
      render(
        <PreClassReadyView
          selectedLesson="lesson-101"
          lessonTitle="物理必修一"
          selectedClassId="class-1"
          className="高一(3)班"
          students={[{ id: 's1', name: '张明', student_number: '101' } as any]}
          onlineStudentIds={['s1']}
          timelineSegments={[{ id: 'seg1', title: '环节一', duration: 300 }]}
          lang="zh"
          isClassLocked={false}
          onToggleClassLock={vi.fn()}
          onStartClass={vi.fn()}
          onOpenStudentWindow={vi.fn()}
          isStudentWindowOpen={false}
          addToast={vi.fn()}
        />,
      );

      // Verify dynamic OTP banner
      expect(screen.getByText('防代签动态签到码')).toBeDefined();
      expect(screen.getByText(/后滚动/)).toBeDefined();

      // Verify environmental healthcheck trigger button
      const healthBtn = screen.getByText('环境一键飞检');
      expect(healthBtn).toBeDefined();

      // Click opens modal
      fireEvent.click(healthBtn);
      expect(screen.getAllByText(/课前环境一键预检飞检/).length).toBeGreaterThanOrEqual(1);
    });
  });
});
