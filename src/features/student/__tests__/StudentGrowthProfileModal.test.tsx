import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { StudentGrowthProfileModal } from '../StudentGrowthProfileModal';
import { ClassroomAttributionModal } from '../../classroom/ClassroomAttributionModal';
import { ClassroomLeaderboardModal } from '../../classroom/ClassroomLeaderboardModal';

// Mock ExtensionPointRenderer to test plugin slots
vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: ({ slot }: { slot: string }) => (
    <div data-testid={`extension-slot-${slot}`}>Slot: {slot}</div>
  ),
}));

describe('StudentGrowthProfileModal (Stitch Screen 07fd3861)', () => {
  const mockStudent = {
    id: 's-101',
    name: '李晓彤',
    student_number: '240101',
    role: '组长',
    group_name: '第 1 组 · 飞鹰极客队',
    className: '人工智能与创意编程示范班',
    points: 28,
    deltaPoints: 4,
    focusPercentage: 98,
    accuracyPercentage: 100,
    helpCount: 3,
    competencyScores: {
      logic: 95,
      engineering: 90,
      creativity: 88,
      collaboration: 96,
      focus: 98,
    },
  };

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    student: mockStudent,
    lessonId: 'lesson-nested-loop',
    classId: 'class-ai-demo',
    lang: 'zh' as const,
    addToast: vi.fn(),
    onInspectSandbox: vi.fn(),
    onCastStudentScreen: vi.fn(),
    onAwardPoints: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders student header details, role tag, and focus status correctly', () => {
    render(<StudentGrowthProfileModal {...defaultProps} />);

    expect(screen.getByText('李晓彤')).toBeDefined();
    expect(screen.getByText('组长')).toBeDefined();
    expect(screen.getByText('第 1 组 · 飞鹰极客队')).toBeDefined();
    expect(screen.getByText(/98% 专注在线/)).toBeDefined();
    expect(screen.getByText(/240101/)).toBeDefined();
  });

  it('renders the 4 key summary metric cards with Stitch styling', () => {
    render(<StudentGrowthProfileModal {...defaultProps} />);

    // Metric 1: Points
    expect(screen.getByText('本节总积分')).toBeDefined();
    expect(screen.getByText('28')).toBeDefined();
    expect(screen.getByText('+4')).toBeDefined();

    // Metric 2: Focus
    expect(screen.getByText('本堂专注度')).toBeDefined();
    expect(screen.getByText(/击败全班/)).toBeDefined();

    // Metric 3: Accuracy
    expect(screen.getByText('答题正确率')).toBeDefined();
    expect(screen.getByText('100%')).toBeDefined();

    // Metric 4: Collaboration
    expect(screen.getByText('互助答疑频次')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
  });

  it('renders native SVG pentagon radar chart with all 5 competency dimensions', () => {
    render(<StudentGrowthProfileModal {...defaultProps} />);

    expect(screen.getByText('多维素养与计算思维雷达')).toBeDefined();
    expect(screen.getByText('综合评级 A+')).toBeDefined();

    // Radar chart dimensions
    expect(screen.getByText(/算法逻辑 95/)).toBeDefined();
    expect(screen.getByText(/代码工程 90/)).toBeDefined();
    expect(screen.getByText(/创新思维 88/)).toBeDefined();
    expect(screen.getByText(/团队协作 96/)).toBeDefined();
    expect(screen.getByText(/课堂专注 98/)).toBeDefined();
  });

  it('renders AI pedagogical review insights and growth recommendations', () => {
    render(<StudentGrowthProfileModal {...defaultProps} />);

    expect(screen.getByText('AI 导师学情评语与成长潜质')).toBeDefined();
    expect(screen.getByText(/在循环变量步长与嵌套边界控制方面表现出超前理解力/)).toBeDefined();
    expect(screen.getByText('推荐进入算法创新挑战营')).toBeDefined();
  });

  it('renders timeline events and handles inspect sandbox action', () => {
    render(<StudentGrowthProfileModal {...defaultProps} />);

    expect(screen.getByText(/极速投票 · 循环嵌套条件判断/)).toBeDefined();
    expect(screen.getByText(/随堂抽问发言 · 多维归因表彰/)).toBeDefined();
    expect(screen.getByText(/编程沙箱实操 · 螺旋彩虹绘制程序/)).toBeDefined();
    expect(screen.getByText(/毫秒级抢答夺魁/)).toBeDefined();

    // Click inspect sandbox button on submission event
    const inspectBtn = screen.getByRole('button', { name: /查验代码沙箱/ });
    fireEvent.click(inspectBtn);
    expect(defaultProps.onInspectSandbox).toHaveBeenCalledWith('s-101', 'sub-2401');
  });

  it('handles quick attribution point award from modal footer', () => {
    render(<StudentGrowthProfileModal {...defaultProps} />);

    const logicAwardBtn = screen.getByRole('button', { name: /💡 \+2 逻辑/ });
    fireEvent.click(logicAwardBtn);

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('s-101', 2, '逻辑清晰');
    expect(defaultProps.addToast).toHaveBeenCalledWith(
      expect.stringContaining('积分已发放'),
      expect.stringContaining('李晓彤'),
      'success',
    );
  });

  it('handles casting student screen to stage display', () => {
    render(<StudentGrowthProfileModal {...defaultProps} />);

    const castBtn = screen.getByRole('button', { name: /投屏其工作台/ });
    fireEvent.click(castBtn);

    expect(defaultProps.onCastStudentScreen).toHaveBeenCalledWith('s-101');
  });

  it('mounts all third-party plugin extension slots', () => {
    render(<StudentGrowthProfileModal {...defaultProps} />);

    expect(screen.getAllByTestId('extension-slot-student.profile.action').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('extension-slot-student.profile.dimension')).toBeDefined();
    expect(screen.getByTestId('extension-slot-student.profile.card')).toBeDefined();
    expect(screen.getByTestId('extension-slot-student.profile.timeline_item')).toBeDefined();
  });
});

describe('Classroom Attribution & Leaderboard -> Student Growth Profile Integration', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens StudentGrowthProfileModal from ClassroomAttributionModal when clicking 学情档案', () => {
    const student = {
      id: 's-101',
      name: '李晓彤',
      studentNo: '240101',
      groupName: '飞鹰极客队',
      currentPoints: 28,
      focusScore: 98,
    };

    render(
      <ClassroomAttributionModal
        isOpen={true}
        onClose={vi.fn()}
        classId="class-1"
        lessonId="lesson-1"
        students={[student]}
        initialStudent={student}
      />,
    );

    const profileBtn = screen.getByRole('button', { name: /学情档案/ });
    expect(profileBtn).toBeDefined();

    fireEvent.click(profileBtn);

    // StudentGrowthProfileModal should now be open
    expect(document.getElementById('student-growth-profile-modal-backdrop')).toBeTruthy();
    expect(screen.getByText('多维素养与计算思维雷达')).toBeDefined();
  });

  it('opens StudentGrowthProfileModal from ClassroomLeaderboardModal when clicking 档案 in individual rank', () => {
    const student = {
      id: 's-101',
      name: '李晓彤',
      studentNo: '240101',
      groupName: '飞鹰极客队',
      currentPoints: 28,
      focusScore: 98,
    };

    render(
      <ClassroomLeaderboardModal
        isOpen={true}
        onClose={vi.fn()}
        classId="class-1"
        lessonId="lesson-1"
        students={[student]}
      />,
    );

    // Switch to individual rank tab
    const individualTabBtn = screen.getByRole('button', { name: /个人英雄榜/ });
    fireEvent.click(individualTabBtn);

    // Click profile button on student row
    const profileBtn = screen.getByRole('button', { name: /档案/ });
    expect(profileBtn).toBeDefined();
    fireEvent.click(profileBtn);

    // StudentGrowthProfileModal should be open
    expect(document.getElementById('student-growth-profile-modal-backdrop')).toBeTruthy();
    expect(screen.getByText('本堂答题与互动轨迹 (Live Timeline)')).toBeDefined();
  });
});
