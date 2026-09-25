import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ClassroomBriefingView } from '../ClassroomBriefingView';
import type { StudentType } from '../../../types/app';

afterEach(cleanup);

describe('ClassroomBriefingView: 课后学情复盘与分层派发集成', () => {
  const mockStudents: StudentType[] = [
    {
      id: 'st-001',
      name: '赵同学',
      student_number: '202601',
      email: 'zhao@example.com',
      created_at: Date.now(),
    },
    {
      id: 'st-002',
      name: '钱同学',
      student_number: '202602',
      email: 'qian@example.com',
      created_at: Date.now(),
    },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('panoramic-report')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              session: { durationMin: 45 },
              metrics: {
                quizAccuracy: 88,
                pollVotesTotal: 25,
                exitTicketsAvgRating: 4.8,
                topPuzzledConcept: '动能定理临界条件',
              },
              students: [
                {
                  studentId: 'st-001',
                  studentName: '赵同学',
                  studentNumber: '202601',
                  attendance: true,
                  quizScore: 92,
                  accuracy: 0.92,
                  pollsAnswered: 5,
                  exitRating: 5,
                },
                {
                  studentId: 'st-002',
                  studentName: '钱同学',
                  studentNumber: '202602',
                  attendance: true,
                  quizScore: 68,
                  accuracy: 0.68,
                  pollsAnswered: 1,
                  exitRating: 2,
                  puzzledConcept: '临界受力分解',
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            pacing: { CLEAR: 20, CONFUSED: 4, TOO_FAST: 1 },
          }),
        });
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染 AI 教学副驾反思与差异化任务分流中枢', async () => {
    const addToast = vi.fn();
    render(
      <ClassroomBriefingView
        selectedLesson="les-test"
        lessonTitle="高中物理动能定理"
        selectedClassId="cls-1"
        className="高一(2)班"
        students={mockStudents}
        lang="zh"
        onReturnToTeaching={vi.fn()}
        onReturnToPreClass={vi.fn()}
        addToast={addToast}
      />,
    );

    // 验证 AI 教学副驾反思建议
    await waitFor(() => {
      expect(
        screen.getByText(/AI 教学副驾反思建议 \(Teaching Co-Pilot\)/i),
      ).toBeTruthy();
    });

    // 验证差异化任务分流中枢已渲染
    expect(
      screen.getByText('差异化课后巩固派发中枢 (Differentiated Follow-up Hub)'),
    ).toBeTruthy();

    // 验证梯队自动归入
    expect(screen.getByText(/A 梯队 · 通关拔高型/)).toBeTruthy();
    expect(screen.getByText(/C 梯队 · 支架补强型/)).toBeTruthy();

    // 验证表格内有个人报告操作列
    expect(screen.getAllByText('个人报告').length).toBeGreaterThan(0);

    // 点击某位学生的“查看”个人报告
    const viewButtons = screen.getAllByRole('button', { name: /查看/i });
    fireEvent.click(viewButtons[0]);

    // 弹窗唤出并显示报告与勋章
    await waitFor(() => {
      expect(screen.getByText(/课堂全景表现个人报告与家校同步成长单/)).toBeTruthy();
      expect(screen.getByText(/家校互联·家长端同步文案/)).toBeTruthy();
    });
  });
});
