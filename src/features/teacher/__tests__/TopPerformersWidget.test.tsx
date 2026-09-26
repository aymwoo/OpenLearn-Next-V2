import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TopPerformersWidget } from '../TopPerformersWidget';

// Mock recharts ResponsiveContainer to render children in JSDOM
vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div className="recharts-responsive-container" style={{ width: 600, height: 250 }}>
        {children}
      </div>
    ),
  };
});

describe('TopPerformersWidget (随堂测验优秀榜组件)', () => {
  const mockLessons = [
    { id: 'les-1', title: 'Newtonian Mechanics', content: '' },
    { id: 'les-2', title: 'Thermodynamics', content: '' },
  ];

  const mockStudents = [
    { id: 'st-1', name: 'Alice Smith', class_id: 'cls-1' },
    { id: 'st-2', name: 'Bob Johnson', class_id: 'cls-1' },
    { id: 'st-3', name: 'Charlie Brown', class_id: 'cls-1' },
    { id: 'st-4', name: 'David Lee', class_id: 'cls-1' },
    { id: 'st-5', name: 'Eva Green', class_id: 'cls-1' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders widget title, podium cards, and recharts container', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/classroom/sessions/les-1/top-performers')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              lessonId: 'les-1',
              topPerformers: [
                {
                  rank: 1,
                  studentId: 'st-1',
                  studentName: 'Alice Smith',
                  cumulativeScore: 300,
                  totalQuizzesAnswered: 3,
                  correctCount: 3,
                  accuracy: 100,
                  avgTimeSpentMs: 5000,
                  lastSubmittedAt: Date.now(),
                },
                {
                  rank: 2,
                  studentId: 'st-2',
                  studentName: 'Bob Johnson',
                  cumulativeScore: 280,
                  totalQuizzesAnswered: 3,
                  correctCount: 3,
                  accuracy: 95,
                  avgTimeSpentMs: 6500,
                  lastSubmittedAt: Date.now(),
                },
              ],
              summary: {
                totalParticipants: 2,
                totalResponses: 6,
                averageScore: 290,
              },
            }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(
      <TopPerformersWidget
        lang="zh"
        lessonId="les-1"
        lessons={mockLessons}
        students={mockStudents as any}
      />,
    );

    // Verify title and structure
    expect(screen.getByText(/随堂测验优秀榜/)).toBeTruthy();
    expect(screen.getByTestId('top-performers-widget')).toBeTruthy();

    // Verify student name and chart after fetch
    await waitFor(() => {
      expect(screen.getByTestId('top-performers-chart')).toBeTruthy();
      expect(screen.getByText('Alice Smith')).toBeTruthy();
      expect(screen.getByText('Bob Johnson')).toBeTruthy();
    });
  });

  it('switches metric display mode between score, accuracy, and count', async () => {
    render(
      <TopPerformersWidget
        lang="zh"
        lessonId="les-1"
        lessons={mockLessons}
        students={mockStudents as any}
      />,
    );

    const accuracyBtn = screen.getByTitle('按正确率排序');
    expect(accuracyBtn).toBeTruthy();

    fireEvent.click(accuracyBtn);
    expect(accuracyBtn.className).toContain('font-bold');

    const countBtn = screen.getByTitle('按答题题次排序');
    fireEvent.click(countBtn);
    expect(countBtn.className).toContain('font-bold');
  });

  it('does NOT render simulate button in production mode by default', () => {
    render(
      <TopPerformersWidget
        lang="zh"
        lessonId="les-1"
        lessons={mockLessons}
        students={mockStudents as any}
      />,
    );
    expect(screen.queryByTitle('模拟学生实时答题')).toBeNull();
  });

  it('triggers simulation API when clicking simulate button if allowSimulation is true', async () => {
    const mockAddToast = vi.fn();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/simulate-quiz-responses')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, count: 5 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            topPerformers: [],
          }),
      });
    });

    render(
      <TopPerformersWidget
        lang="zh"
        lessonId="les-1"
        lessons={mockLessons}
        students={mockStudents as any}
        addToast={mockAddToast}
        allowSimulation={true}
      />,
    );

    const simBtn = screen.getByTitle('模拟学生实时答题');
    expect(simBtn).toBeTruthy();

    fireEvent.click(simBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/simulate-quiz-responses'),
        expect.anything(),
      );
    });
  });

  it('triggers toast praise for the top performer', async () => {
    const mockAddToast = vi.fn();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/classroom/sessions/les-1/top-performers')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              lessonId: 'les-1',
              topPerformers: [
                {
                  rank: 1,
                  studentId: 'st-1',
                  studentName: 'Alice Smith',
                  cumulativeScore: 300,
                  totalQuizzesAnswered: 3,
                  correctCount: 3,
                  accuracy: 100,
                  avgTimeSpentMs: 5000,
                  lastSubmittedAt: Date.now(),
                },
              ],
              summary: { totalParticipants: 1, totalResponses: 3, averageScore: 300 },
            }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(
      <TopPerformersWidget
        lang="zh"
        lessonId="les-1"
        lessons={mockLessons}
        students={mockStudents as any}
        addToast={mockAddToast}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle('一键表扬榜首')).toBeTruthy();
    });

    const praiseBtn = screen.getByTitle('一键表扬榜首');
    fireEvent.click(praiseBtn);

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining('表扬已送达'),
      expect.stringContaining('荣誉勋章与鼓励'),
      'success',
    );
  });
});
