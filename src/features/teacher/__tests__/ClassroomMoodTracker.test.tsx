import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ClassroomMoodTracker } from '../ClassroomMoodTracker';

// Mock recharts ResponsiveContainer to render children with dimensions in JSDOM
vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div className="recharts-responsive-container" style={{ width: 800, height: 300 }}>
        {children}
      </div>
    ),
  };
});

describe('ClassroomMoodTracker (实时课堂情绪与专注度追踪器)', () => {
  const mockLessons = [
    { id: 'les-1', title: 'Newtonian Mechanics', content: '' },
    { id: 'les-2', title: 'Thermodynamics', content: '' },
  ];

  const mockSchedules = [
    {
      id: 'sch-1',
      lesson_id: 'les-1',
      class_id: 'cls-1',
      scheduled_date: '2026-09-22',
      time_slot: '09:00 - 09:45',
      status: 'scheduled',
      lesson_title: 'Newtonian Mechanics',
      class_name: 'Grade 9 Class 1',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders mood tracker header, metric cards, and chart containers', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/classroom/sessions/les-1/mood-tracker')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              metrics: {
                currentEngagement: 85,
                moodStatus: 'OPTIMAL',
                moodLabel: '课堂节奏良好 · 专注度高',
                moodEmoji: '🌟',
                totalInteractions: 30,
                interactionFrequencyPerMin: '4.5',
                pulseDistribution: {
                  clearCount: 22,
                  confusedCount: 5,
                  tooFastCount: 3,
                  total: 30,
                  clearPercent: 73,
                  confusedPercent: 17,
                  tooFastPercent: 10,
                },
              },
              timeline: [
                {
                  time: '10:00',
                  timestamp: Date.now() - 60000,
                  engagement: 82,
                  energy: 70,
                  interactions: 3,
                  clear: 2,
                  confused: 1,
                  tooFast: 0,
                },
                {
                  time: '10:01',
                  timestamp: Date.now(),
                  engagement: 88,
                  energy: 85,
                  interactions: 5,
                  clear: 4,
                  confused: 1,
                  tooFast: 0,
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(
      <ClassroomMoodTracker
        lang="zh"
        lessons={mockLessons as any}
        schedules={mockSchedules as any}
        addToast={vi.fn()}
      />
    );

    // Verify title and badges
    expect(screen.getByText('实时课堂专注度与情绪晴雨表')).toBeDefined();
    expect(screen.getByText('综合专注指数')).toBeDefined();
    expect(screen.getByText('互动触发频度')).toBeDefined();
    expect(screen.getByText('听懂顺畅率')).toBeDefined();
    expect(screen.getByText('疑问/过快预警')).toBeDefined();

    // Verify Recharts section headers
    expect(screen.getByText('课堂专注度与能量动态走势')).toBeDefined();
    expect(screen.getByText('学生脉搏反馈占比')).toBeDefined();

    // Verify AI recommendation section
    expect(screen.getByText('AI 教学节奏诊断建议:')).toBeDefined();
  });

  it('triggers instant pulse check and informs teacher', async () => {
    const addToast = vi.fn();
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/classroom/sessions/les-1/pulse-check') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            metrics: {
              currentEngagement: 80,
              moodStatus: 'OPTIMAL',
              moodLabel: '课堂节奏良好',
              moodEmoji: '🌟',
              totalInteractions: 10,
              interactionFrequencyPerMin: '2.0',
              pulseDistribution: {
                clearCount: 8,
                confusedCount: 1,
                tooFastCount: 1,
                total: 10,
                clearPercent: 80,
                confusedPercent: 10,
                tooFastPercent: 10,
              },
            },
            timeline: [],
          }),
      });
    });

    render(
      <ClassroomMoodTracker
        lang="zh"
        lessons={mockLessons as any}
        schedules={mockSchedules as any}
        addToast={addToast}
      />
    );

    const pulseBtn = screen.getByText('发起30s即时脉搏检');
    fireEvent.click(pulseBtn);

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        '脉搏检测已下发',
        expect.stringContaining('已向全体听课学生弹出'),
        'success'
      );
    });
  });

  it('toggles simulation mode and changes time window', async () => {
    render(
      <ClassroomMoodTracker
        lang="zh"
        lessons={mockLessons as any}
        schedules={mockSchedules as any}
        addToast={vi.fn()}
      />
    );

    const simBtn = screen.getByText('模拟数据流');
    fireEvent.click(simBtn);
    expect(screen.getByText('实时模拟中')).toBeDefined();

    // Switch time window to 30m
    const btn30m = screen.getByText('30m');
    fireEvent.click(btn30m);
    expect(btn30m.className).toContain('bg-white');
  });
});
