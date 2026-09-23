import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ClassroomAttributionModal } from '../ClassroomAttributionModal';
import { ClassroomLeaderboardModal } from '../ClassroomLeaderboardModal';
import { ClassroomStandardTopbar } from '../ClassroomStandardTopbar';

// Mock ExtensionPointRenderer to test plugin slots cleanly
vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: ({ slot, placement }: any) => (
    <div data-testid={`extension-slot-${slot}${placement ? `-${placement}` : ''}`}>
      ExtensionSlot: {slot}
    </div>
  ),
}));

describe('Classroom Attribution & Leaderboard (Stitch Specification)', () => {
  const mockStudents = [
    {
      id: 'st-001',
      name: '李晓彤',
      studentNo: '20240308',
      groupName: '飞鹰极客队',
      seatNumber: '3组 08',
      currentPoints: 28,
      focusScore: 98,
      pickedCountToday: 1,
    },
    {
      id: 'st-002',
      name: '张子豪',
      studentNo: '20240309',
      groupName: '飞鹰极客队',
      seatNumber: '3组 09',
      currentPoints: 26,
      focusScore: 92,
      pickedCountToday: 0,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, logItem: { id: 'log-1' } }),
      }),
    ) as any;
  });

  afterEach(() => {
    cleanup();
  });

  describe('ClassroomAttributionModal', () => {
    it('renders selected student profile and stats', () => {
      render(
        <ClassroomAttributionModal
          isOpen={true}
          onClose={vi.fn()}
          classId="cls-1"
          lessonId="les-1"
          students={mockStudents}
          initialStudent={mockStudents[0]}
          lang="zh"
        />,
      );

      expect(screen.getByText('李晓彤')).toBeDefined();
      expect(screen.getByText('飞鹰极客队')).toBeDefined();
      expect(screen.getByText(/28分/)).toBeDefined();
      expect(screen.getByText(/98%/)).toBeDefined();
    });

    it('renders all four builtin attribution award cards', () => {
      render(
        <ClassroomAttributionModal
          isOpen={true}
          onClose={vi.fn()}
          classId="cls-1"
          lessonId="les-1"
          students={mockStudents}
          initialStudent={mockStudents[0]}
          lang="zh"
        />,
      );

      expect(screen.getByText('逻辑清晰')).toBeDefined();
      expect(screen.getByText('创意满分')).toBeDefined();
      expect(screen.getByText('勇于发言')).toBeDefined();
      expect(screen.getByText('互助示范')).toBeDefined();
    });

    it('clicking an award calls points API and updates live score', async () => {
      const addToast = vi.fn();
      render(
        <ClassroomAttributionModal
          isOpen={true}
          onClose={vi.fn()}
          classId="cls-1"
          lessonId="les-1"
          students={mockStudents}
          initialStudent={mockStudents[0]}
          lang="zh"
          addToast={addToast}
        />,
      );

      const awardBtn = screen.getByText('逻辑清晰');
      fireEvent.click(awardBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/students/st-001/points',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"dimensionId":"logic_clarity"'),
          }),
        );
        expect(addToast).toHaveBeenCalledWith(
          '加分成功',
          expect.stringContaining('李晓彤 +2'),
          'success',
        );
      });
    });

    it('provides third-party plugin extension slots', () => {
      render(
        <ClassroomAttributionModal
          isOpen={true}
          onClose={vi.fn()}
          classId="cls-1"
          lessonId="les-1"
          students={mockStudents}
          initialStudent={mockStudents[0]}
          lang="zh"
        />,
      );

      expect(screen.getByTestId('extension-slot-classroom.attribution.award')).toBeDefined();
      expect(screen.getByTestId('extension-slot-classroom.attribution.action')).toBeDefined();
      expect(screen.getByTestId('extension-slot-anchor:classroom-attribution:awards-before')).toBeDefined();
      expect(screen.getByTestId('extension-slot-anchor:classroom-attribution:awards-after')).toBeDefined();
    });
  });

  describe('ClassroomLeaderboardModal', () => {
    it('renders team league rankings and members', () => {
      render(
        <ClassroomLeaderboardModal
          isOpen={true}
          onClose={vi.fn()}
          classId="cls-1"
          lessonId="les-1"
          students={mockStudents}
          lang="zh"
        />,
      );

      expect(screen.getByText('第 1 组 · 飞鹰极客队')).toBeDefined();
      expect(screen.getByText('全班积分榜与小组积分明细', { exact: false })).toBeDefined();
    });

    it('supports whole-group batch points awarding', () => {
      const addToast = vi.fn();
      render(
        <ClassroomLeaderboardModal
          isOpen={true}
          onClose={vi.fn()}
          classId="cls-1"
          lessonId="les-1"
          students={mockStudents}
          lang="zh"
          addToast={addToast}
        />,
      );

      const collabBtns = screen.getAllByText(/\+2 协作/);
      expect(collabBtns.length).toBeGreaterThan(0);
      fireEvent.click(collabBtns[0]);

      expect(addToast).toHaveBeenCalledWith(
        '小组集体加分',
        expect.stringContaining('+2'),
        'success',
      );
    });

    it('provides third-party plugin extension slot for leaderboard actions', () => {
      render(
        <ClassroomLeaderboardModal
          isOpen={true}
          onClose={vi.fn()}
          classId="cls-1"
          lessonId="les-1"
          students={mockStudents}
          lang="zh"
        />,
      );

      expect(screen.getByTestId('extension-slot-classroom.leaderboard.action')).toBeDefined();
    });
  });

  describe('ClassroomStandardTopbar', () => {
    it('renders 48px unified topbar with phase pills and action buttons', () => {
      render(
        <ClassroomStandardTopbar
          lessonId="les-1"
          lessonTitle="Python 图形化编程"
          classId="cls-1"
          className="人工智能示范班"
          currentStage="IN_CLASS_TEACHING"
          onStageChange={vi.fn()}
          lang="zh"
        />,
      );

      expect(screen.getByText('1. 预习')).toBeDefined();
      expect(screen.getByText('2. 核心讲解')).toBeDefined();
      expect(screen.getByText('3. 实操通票')).toBeDefined();
      expect(screen.getByText('4. 总结简报')).toBeDefined();
      expect(screen.getByText('+2m')).toBeDefined();
      expect(screen.getByText('HD')).toBeDefined();
    });

    it('provides third-party plugin slots for topbar actions and pills', () => {
      render(
        <ClassroomStandardTopbar
          lessonId="les-1"
          classId="cls-1"
          currentStage="IN_CLASS_TEACHING"
          onStageChange={vi.fn()}
          lang="zh"
        />,
      );

      expect(screen.getByTestId('extension-slot-classroom.topbar.action')).toBeDefined();
      expect(screen.getByTestId('extension-slot-classroom.topbar.pill')).toBeDefined();
      expect(screen.getByTestId('extension-slot-anchor:classroom-topbar:stages-before')).toBeDefined();
      expect(screen.getByTestId('extension-slot-anchor:classroom-topbar:stages-after')).toBeDefined();
      expect(screen.getByTestId('extension-slot-anchor:classroom-topbar:context-before')).toBeDefined();
      expect(screen.getByTestId('extension-slot-anchor:classroom-topbar:context-after')).toBeDefined();
      expect(screen.getByTestId('extension-slot-anchor:classroom-topbar:actions-after')).toBeDefined();
    });
  });
});
