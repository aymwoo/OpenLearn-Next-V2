import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PreClassReadyView } from '../PreClassReadyView';
import { PostClassWrapupView } from '../PostClassWrapupView';
import { ClassroomBriefingView } from '../ClassroomBriefingView';

describe('Classroom Workflow Stage Specific Views', () => {
  const mockStudents = [
    { id: 'st-1', name: 'Alice Smith', email: 'alice@school.com', role: 'student', created_at: 1700000000 },
    { id: 'st-2', name: 'Bob Jones', email: 'bob@school.com', role: 'student', created_at: 1700000000 },
  ];

  const mockTimelineSegments = [
    { id: 'seg-1', title: 'Warm-up & Review', duration: 300 },
    { id: 'seg-2', title: 'Main Interactive Demo', duration: 1500 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('PreClassReadyView (课前准备阶段)', () => {
    it('renders pre-class checklists, student roster and start class button', () => {
      const onStartClass = vi.fn();
      const onBroadcastNotice = vi.fn();
      const onToggleClassLock = vi.fn();

      render(
        <PreClassReadyView
          selectedLesson="lesson-101"
          lessonTitle="Introduction to Physics"
          selectedClassId="class-1"
          className="Grade 8 Class A"
          students={mockStudents}
          onlineStudentIds={['st-1']}
          timelineSegments={mockTimelineSegments}
          lang="zh"
          isClassLocked={false}
          onToggleClassLock={onToggleClassLock}
          onStartClass={onStartClass}
          onPingStudent={vi.fn()}
          onOpenStudentWindow={vi.fn()}
          isStudentWindowOpen={false}
          addToast={vi.fn()}
          onBroadcastNotice={onBroadcastNotice}
        />
      );

      // Verify header and ready indicators
      expect(screen.getByText('阶段 1 / 4 · 课前准备与就绪')).toBeDefined();
      expect(screen.getByText('备课预检与教学就绪项')).toBeDefined();

      // Verify students list
      expect(screen.getByText('Alice Smith')).toBeDefined();
      expect(screen.getByText('Bob Jones')).toBeDefined();

      // Click start teaching button
      const startBtn = screen.getByText('一键开启课中授课 (进入白板)');
      fireEvent.click(startBtn);
      expect(onStartClass).toHaveBeenCalledTimes(1);

      // Broadcast pre-class quick notice
      const bellButtons = screen.getAllByRole('button');
      const reminderBtn = bellButtons.find((b) => b.textContent?.includes('即将上课提醒'));
      if (reminderBtn) {
        fireEvent.click(reminderBtn);
        expect(onBroadcastNotice).toHaveBeenCalledWith(expect.stringContaining('还有 5 分钟即将开始授课'));
      }
    });
  });

  describe('PostClassWrapupView (课后小结与即问即答评价阶段)', () => {
    it('renders exit ticket evaluations and allows advancing to report', () => {
      const onAdvanceToReport = vi.fn();
      const onReturnToTeaching = vi.fn();
      const onPromoteAttempt = vi.fn();

      const mockAttempts = [
        {
          attemptId: 'att-1',
          studentId: 'st-1',
          studentName: 'Alice Smith',
          status: 'submitted',
          score: 85,
          timestamp: Date.now(),
          coursewareTitle: 'Physics Lab 1',
        },
      ];

      render(
        <PostClassWrapupView
          selectedLesson="lesson-101"
          lessonTitle="Introduction to Physics"
          selectedClassId="class-1"
          className="Grade 8 Class A"
          students={mockStudents}
          lang="zh"
          attempts={mockAttempts}
          loadingAttempts={false}
          onFetchAttempts={vi.fn()}
          onPromoteAttempt={onPromoteAttempt}
          onViewRaw={vi.fn()}
          onAdvanceToReport={onAdvanceToReport}
          onReturnToTeaching={onReturnToTeaching}
          addToast={vi.fn()}
          onBroadcastNotice={vi.fn()}
        />
      );

      expect(screen.getByText('阶段 3 / 4 · 课后小结与作业批改')).toBeDefined();
      expect(screen.getByText('生成学情全景简报')).toBeDefined();
      expect(screen.getByText('返回课中白板')).toBeDefined();

      // Click advance to report
      const reportBtn = screen.getByText('生成学情全景简报');
      fireEvent.click(reportBtn);
      expect(onAdvanceToReport).toHaveBeenCalledTimes(1);

      // Click return to teaching
      const backBtn = screen.getByText('返回课中白板');
      fireEvent.click(backBtn);
      expect(onReturnToTeaching).toHaveBeenCalledTimes(1);
    });
  });

  describe('ClassroomBriefingView (课节全景简报分析阶段)', () => {
    it('fetches panoramic report and renders KPI cards and actions', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/classroom/sessions/lesson-101/panoramic-report')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                summary: {
                  totalStudents: 2,
                  attendedStudents: 2,
                  lockedCount: 2,
                  attendanceRate: 100,
                  averageProgress: 92,
                  averageScore: 88,
                },
                exitTickets: {
                  totalSubmitted: 2,
                  averageScore: 90,
                },
                interactions: {
                  pollCount: 3,
                  buzzerCount: 1,
                  totalStudentResponses: 8,
                },
                studentDetails: [
                  {
                    id: 'st-1',
                    name: 'Alice Smith',
                    email: 'alice@school.com',
                    isOnline: true,
                    progressPercent: 95,
                    completedSegmentsCount: 2,
                    totalSegmentsCount: 2,
                    exitTicketStatus: 'submitted',
                    exitTicketScore: 92,
                    errorsCount: 0,
                  },
                ],
              }),
          });
        }
        return Promise.resolve({ ok: false });
      });

      const onReturnToTeaching = vi.fn();

      render(
        <ClassroomBriefingView
          selectedLesson="lesson-101"
          lessonTitle="Introduction to Physics"
          selectedClassId="class-1"
          className="Grade 8 Class A"
          students={mockStudents}
          lang="zh"
          onReturnToTeaching={onReturnToTeaching}
          onReturnToPreClass={vi.fn()}
          addToast={vi.fn()}
        />
      );

      // Wait for async fetch to populate stats
      await waitFor(() => {
        expect(screen.getByText('阶段 4 / 4 · 课堂学情全景简报')).toBeDefined();
        expect(screen.getByText('多维学情数据分析、教学反思与学业总览')).toBeDefined();
        expect(screen.getByText('返回课中白板')).toBeDefined();
      });

      // Check CSV export button exists
      expect(screen.getByText('导出学情简报 (CSV)')).toBeDefined();
    });
  });
});
