import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  ClassroomCockpitHeader,
  ClassroomWorkflowSubHeader,
  ClassroomAgendaPanel,
  ClassroomCanvasArea,
  ClassroomEngagementConsole,
  StudentAttentionGauges,
  TypedAuditStream,
} from '../index';
import { ContributionRegistry } from '../../../../../packages/core/plugin-host/contribution-registry';

// Mock child modals that make fetch requests to avoid unhandled rejections
vi.mock('../../ClassroomAttributionModal', () => ({
  ClassroomAttributionModal: () => <div data-testid="classroom-attribution-modal">AttributionModal</div>,
}));

vi.mock('../../ClassroomLeaderboardModal', () => ({
  ClassroomLeaderboardModal: () => <div data-testid="classroom-leaderboard-modal">LeaderboardModal</div>,
}));

vi.mock('../../ClassroomStageDisplayModal', () => ({
  ClassroomStageDisplayModal: () => <div data-testid="classroom-stage-display-modal">StageDisplayModal</div>,
}));

describe('Classroom Cockpit Subsystem (Stitch Screen 1219a481)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. ClassroomCockpitHeader', () => {
    const mockProps = {
      lessonId: 'l-101',
      lessonTitle: '物理探究实验课',
      classId: 'c-g1',
      className: '高一1班',
      lessons: [
        { id: 'l-101', title: '物理探究实验课' },
        { id: 'l-102', title: '数学建模基础' },
      ],
      classes: [
        { id: 'c-g1', name: '高一1班' },
        { id: 'c-g2', name: '高一2班' },
      ],
      onSelectLesson: vi.fn(),
      onSelectClass: vi.fn(),
      isClassLocked: false,
      lockingClass: false,
      onToggleClassLock: vi.fn(),
      isStudentWindowOpen: false,
      onOpenStudentWindow: vi.fn(),
      studentCount: 32,
      onlineCount: 28,
      lang: 'zh' as const,
      addToast: vi.fn(),
    };

    it('renders global topbar branding, course context, and independent student preview tab button', () => {
      render(<ClassroomCockpitHeader {...mockProps} />);

      expect(screen.getByText('OpenLearn')).toBeDefined();
      expect(screen.getByText('Next')).toBeDefined();
      expect(screen.getByText('智能授课工作流控制中心')).toBeDefined();
      expect(screen.getByText('物理探究实验课')).toBeDefined();
      expect(screen.getByText(/高一1班/)).toBeDefined();

      // Unlinked student window button
      const previewBtn = screen.getByRole('button', { name: /学生视角预览 \(独立Tab\)/ });
      expect(previewBtn).toBeDefined();

      fireEvent.click(previewBtn);
      expect(mockProps.onOpenStudentWindow).toHaveBeenCalledTimes(1);
    });

    it('renders linked active state button when student window is already opened', () => {
      render(<ClassroomCockpitHeader {...mockProps} isStudentWindowOpen={true} />);

      expect(screen.getByText(/学生端已联动 \(激活Tab\)/)).toBeDefined();
    });

    it('toggles focus screen lock on click', () => {
      render(<ClassroomCockpitHeader {...mockProps} isClassLocked={false} />);

      const lockBtn = screen.getByTitle('一键锁屏/解锁全班学生机');
      expect(lockBtn).toBeDefined();

      fireEvent.click(lockBtn);
      expect(mockProps.onToggleClassLock).toHaveBeenCalledWith(true);
    });
  });

  describe('2. ClassroomWorkflowSubHeader', () => {
    const mockProps = {
      currentStage: 'IN_CLASS_TEACHING',
      onStageChange: vi.fn(),
      lang: 'zh' as const,
      lessonId: 'l-101',
      lessonTitle: '物理探究实验课',
      classId: 'c-g1',
      className: '高一1班',
      students: [{ id: 'st-1', name: '张小明' }],
      addToast: vi.fn(),
      pollSubmissionsCount: 24,
      buzzerReadyCount: 2,
      countdownSeconds: 60,
    };

    it('renders all four workflow stage buttons with active state highlighting', () => {
      render(<ClassroomWorkflowSubHeader {...mockProps} />);

      expect(screen.getByText('1. 课前就绪')).toBeDefined();
      expect(screen.getByText('2. 课中授课')).toBeDefined();
      expect(screen.getByText('3. 结课巡查')).toBeDefined();
      expect(screen.getByText('4. 学情简报')).toBeDefined();

      // Click to transition to Wrap-up stage
      const wrapUpBtn = screen.getByText('3. 结课巡查');
      fireEvent.click(wrapUpBtn);
      expect(mockProps.onStageChange).toHaveBeenCalledWith('WRAP_UP_EXIT_TICKET');
    });

    it('renders quick interaction activity buttons with counter badges and rhythm barometer', () => {
      render(<ClassroomWorkflowSubHeader {...mockProps} />);

      expect(screen.getByTitle(/极速投票/)).toBeDefined();
      expect(screen.getByText('24')).toBeDefined();
      expect(screen.getByTitle(/随堂抢答/)).toBeDefined();
      const twoBadges = screen.getAllByText('2');
      expect(twoBadges.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByTitle(/60s 限时互动冲刺/)).toBeDefined();
      expect(screen.getByText('60s')).toBeDefined();

      // Rhythm Barometer metrics
      expect(screen.getByText('94%')).toBeDefined();
      expect(screen.getByText('28')).toBeDefined();
    });
  });

  describe('3. ClassroomAgendaPanel', () => {
    const mockSegments = [
      { id: 'seg-1', title: '开场引入与预习反馈', duration: '5m', notes: '温习上一节内容', completed: true },
      { id: 'seg-2', title: '讲授新课：循环嵌套结构', duration: '20m', notes: '核心概念双重循环', completed: false },
      { id: 'seg-3', title: '随堂编程互动练习', duration: 900, notes: '螺旋网格绘制', completed: false },
    ];

    const mockProps = {
      timelineSegments: mockSegments,
      activeSegmentId: 'seg-2',
      onSelectSegment: vi.fn(),
      isCollapsed: false,
      onToggleCollapse: vi.fn(),
      lang: 'zh' as const,
      timeRemaining: 525, // 08:45
      setTimeRemaining: vi.fn(),
      isActive: true,
      setIsActive: vi.fn(),
      addToast: vi.fn(),
    };

    it('renders digital countdown timer with formatted minutes and seconds', () => {
      render(<ClassroomAgendaPanel {...mockProps} />);

      expect(screen.getByText('08:45')).toBeDefined();
      expect(screen.getByText('/ 20:00')).toBeDefined();
    });

    it('handles +2m time compensation on click', () => {
      render(<ClassroomAgendaPanel {...mockProps} />);

      const compensateBtn = screen.getByTitle('+2分钟补时');
      expect(compensateBtn).toBeDefined();

      fireEvent.click(compensateBtn);
      expect(mockProps.setTimeRemaining).toHaveBeenCalledWith(525 + 120);
    });

    it('renders 3-state cards and opens notes modal for active segment', () => {
      render(<ClassroomAgendaPanel {...mockProps} />);

      expect(screen.getByText('开场引入与预习反馈')).toBeDefined();
      expect(screen.getByText('讲授新课：循环嵌套结构')).toBeDefined();
      expect(screen.getByText('随堂编程互动练习')).toBeDefined();

      // Active card shows broadcasting pill and notes button
      expect(screen.getByText('当前同步中')).toBeDefined();
      const notesBtn = screen.getByRole('button', { name: '课件附注' });
      fireEvent.click(notesBtn);

      // Notes modal opens
      expect(screen.getByText('课件备课附注与教学指导')).toBeDefined();
      const notesElements = screen.getAllByText('核心概念双重循环');
      expect(notesElements.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('4. ClassroomCanvasArea', () => {
    const mockProps = {
      currentTab: 'whiteboard' as const,
      onTabChange: vi.fn(),
      lang: 'zh' as const,
      isLiveBroadcasterConnected: true,
      studentErrorCount: 0,
      submissionsCount: 29,
      showDemoTaskCard: true,
    };

    it('renders mode switch tabs and live broadcaster badge', () => {
      render(
        <ClassroomCanvasArea {...mockProps}>
          <div data-testid="canvas-child">Canvas Content</div>
        </ClassroomCanvasArea>,
      );

      expect(screen.getByText('演示白板')).toBeDefined();
      expect(screen.getByText('学生提交数据')).toBeDefined();
      expect(screen.getByText('作业成绩评定')).toBeDefined();
      expect(screen.getByText('随堂测验榜')).toBeDefined();
      expect(screen.getByText('LIVE BROADCASTER CONNECTED')).toBeDefined();
      expect(screen.getByTestId('canvas-child')).toBeDefined();
    });

    it('renders floating assignment task card with correct submission percentage', () => {
      render(
        <ClassroomCanvasArea {...mockProps}>
          <div>Canvas</div>
        </ClassroomCanvasArea>,
      );

      expect(screen.getByText('test作业1：螺旋彩虹绘制程序')).toBeDefined();
      expect(screen.getByText(/已提交:/)).toBeDefined();
      expect(screen.getByText(/90.6% 完成率/)).toBeDefined();
    });

    it('switches tabs when another mode tab is clicked', () => {
      render(
        <ClassroomCanvasArea {...mockProps}>
          <div>Canvas</div>
        </ClassroomCanvasArea>,
      );

      const submissionsTab = screen.getByText('学生提交数据');
      fireEvent.click(submissionsTab);
      expect(mockProps.onTabChange).toHaveBeenCalledWith('submissions');
    });
  });

  describe('5. ClassroomEngagementConsole & Attention Gauges', () => {
    const mockStudents = [
      { id: 's1', name: '张小明', focusPercent: 88, isOnline: true, isLocked: true },
      { id: 's2', name: '李华', focusPercent: 42, isOnline: true, isLocked: false },
      { id: 's3', name: '王芳', focusPercent: 0, isOnline: false, isLocked: false },
    ];

    const mockEvents = [
      { id: 'e1', time: '10:04:12', level: 'WARNING' as const, message: '学生 李华 离开主视窗 30 秒' },
      { id: 'e2', time: '10:05:00', level: 'ANSWER' as const, message: '张小明 提交了随堂练习代码' },
      { id: 'e3', time: '10:06:20', level: 'SYSTEM' as const, message: '全班屏幕锁定状态已激活' },
    ];

    const mockProps = {
      students: mockStudents,
      events: mockEvents,
      onClearEvents: vi.fn(),
      onRandomPick: vi.fn(),
      onPingStudent: vi.fn(),
      onToggleLockStudent: vi.fn(),
      onSelectStudentProfile: vi.fn(),
      totalStudentsCount: 32,
      onlineStudentsCount: 2,
      lockedCount: 1,
      averageProgress: 65,
      lang: 'zh' as const,
    };

    it('renders student attention gauges with focus percentages and names', () => {
      render(<ClassroomEngagementConsole {...mockProps} />);

      expect(screen.getByText('学生专注力监控')).toBeDefined();
      expect(screen.getByText('张小明')).toBeDefined();
      expect(screen.getByText('李华')).toBeDefined();
      expect(screen.getByText('王芳')).toBeDefined();
      expect(screen.getByText('88%')).toBeDefined();
      expect(screen.getByText('42%')).toBeDefined();
      expect(screen.getByText('0%')).toBeDefined();
    });

    it('renders class overview statistics cards', () => {
      render(<ClassroomEngagementConsole {...mockProps} />);

      expect(screen.getByText('班级学情概况')).toBeDefined();
      expect(screen.getByText(/LOCKED/)).toBeDefined();
      expect(screen.getByText('65%')).toBeDefined(); // 平均进度
    });

    it('renders typed audit stream with color-coded level badges and handles clear', () => {
      render(<ClassroomEngagementConsole {...mockProps} />);

      expect(screen.getByText('课堂互动反馈流')).toBeDefined();
      expect(screen.getByText('WARNING')).toBeDefined();
      expect(screen.getByText('ANSWER')).toBeDefined();
      expect(screen.getByText('SYSTEM')).toBeDefined();
      expect(screen.getByText('学生 李华 离开主视窗 30 秒')).toBeDefined();

      const clearBtn = screen.getByRole('button', { name: 'Clear' });
      fireEvent.click(clearBtn);
      expect(mockProps.onClearEvents).toHaveBeenCalledTimes(1);
    });

    it('triggers random pick callback when rollcall button is clicked', () => {
      render(<ClassroomEngagementConsole {...mockProps} />);

      const pickBtn = screen.getByRole('button', { name: /随机抽问/ });
      fireEvent.click(pickBtn);
      expect(mockProps.onRandomPick).toHaveBeenCalledTimes(1);
    });
  });

  describe('6. Third-Party Plugin Extension Slots', () => {
    it('provides contribution registry definitions for canvas widgets and barometer metrics', () => {
      const registry = new ContributionRegistry();
      expect(typeof registry.register).toBe('function');
      expect(typeof registry.getBySlot).toBe('function');

      // Register mock plugin contribution
      registry.register('test-ai-cockpit-plugin', {
        'classroom.barometer.metric': [
          {
            id: 'ai-metric',
            label: 'AI 疑惑度分析',
          },
        ],
        'whiteboard.canvas.widget': [
          {
            id: 'ai-whiteboard-widget',
            name: '随堂互助小助手',
          },
        ],
      });

      const metrics = registry.getBySlot('classroom.barometer.metric');
      expect(metrics.length).toBe(1);
      expect((metrics[0] as any).label).toBe('AI 疑惑度分析');

      const widgets = registry.getBySlot('whiteboard.canvas.widget');
      expect(widgets.length).toBe(1);
      expect((widgets[0] as any).name).toBe('随堂互助小助手');

      // Unregister
      registry.unregister('test-ai-cockpit-plugin');
      expect(registry.getBySlot('classroom.barometer.metric').length).toBe(0);
      expect(registry.getBySlot('whiteboard.canvas.widget').length).toBe(0);
    });
  });
});
