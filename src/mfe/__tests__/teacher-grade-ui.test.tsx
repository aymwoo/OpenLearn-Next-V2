// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TeacherAssignmentGradePanel } from '../../components/TeacherAssignmentGradePanel';

describe('TeacherAssignmentGradePanel Component (Phase 16)', () => {
  let container: HTMLElement;
  let root: any;

  const mockSubmissions = [
    {
      id: 'sub-alice',
      lessonId: 'test-lesson',
      studentId: 'student-alice',
      studentName: 'Alice',
      filePath: '/files/alice-hw.pdf',
      version: 1,
      createdAt: Date.now() - 10000,
      updatedAt: Date.now() - 10000,
      peerReviews: [
        {
          id: 'rev-bob-alice',
          submission_id: 'sub-alice',
          reviewer_id: 'student-bob',
          score: 90,
          comment: 'Nice Alice!',
          reviewer_name: 'Bob'
        }
      ],
      peerAverageScore: 90,
      grade: null
    },
    {
      id: 'sub-bob',
      lessonId: 'test-lesson',
      studentId: 'student-bob',
      studentName: 'Bob',
      filePath: '/files/bob-hw.pdf',
      version: 2,
      createdAt: Date.now() - 5000,
      updatedAt: Date.now() - 5000,
      peerReviews: [],
      peerAverageScore: 0,
      grade: {
        id: 'grd-bob',
        submission_id: 'sub-bob',
        teacher_score: 95,
        teacher_comment: 'Good job',
        teacher_weight: 0.7,
        peer_weight: 0.3,
        calculated_final_score: 95,
        status: 'confirmed',
        graded_at: Date.now() - 2000
      }
    }
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Mock global window.confirm
    vi.spyOn(window, 'confirm').mockImplementation(() => true);

    // Mock global fetch
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/lessons/test-lesson/eval-grades')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSubmissions)
        });
      }
      return Promise.reject(new Error(`Unknown endpoint: ${url}`));
    }) as any;
  });

  afterEach(() => {
    if (root) {
      root.unmount();
    }
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it('renders student submissions list, peer reviews, and grading states correctly', async () => {
    const mockAddToast = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TeacherAssignmentGradePanel
          lessonId="test-lesson"
          lang="zh"
          addToast={mockAddToast}
        />
      );
    });

    // Wait for data load
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const html = container.innerHTML;

    // 1. Check title and global weight card existence
    expect(html).toContain('学生作业成绩评定与折算系统');
    expect(html).toContain('全局默认折算权重设置');

    // 2. Check student names and assignment file paths
    expect(html).toContain('Alice');
    expect(html).toContain('alice-hw.pdf');
    expect(html).toContain('Bob');
    expect(html).toContain('bob-hw.pdf');

    // 3. Verify Alice review score and review count
    expect(html).toContain('90'); // Peer review average score
    expect(html).toContain('互评人数');

    // 4. Verify Bob has a confirmed grade badge and fields are disabled
    expect(html).toContain('成绩已同步');
    const bobScoreInput = container.querySelector('#teacher_score_input_sub-bob') as HTMLInputElement;
    expect(bobScoreInput).not.toBeNull();
    expect(bobScoreInput.disabled).toBe(true);
    expect(bobScoreInput.value).toBe('95');
  });

  it('allows editing teacher score and updates preview calculation dynamically', async () => {
    const mockAddToast = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TeacherAssignmentGradePanel
          lessonId="test-lesson"
          lang="en"
          addToast={mockAddToast}
        />
      );
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // Alice initially has default 60% teacher / 40% peer weight (calculated score should preview 60%*80 + 40%*90 = 48 + 36 = 84)
    const formulaContainer = container.querySelector('.animate-formula');
    expect(formulaContainer).not.toBeNull();
    expect(formulaContainer!.innerHTML).toContain('84');

    // Change Alice score to 100 (Preview should update to 60%*100 + 40%*90 = 60 + 36 = 96)
    const aliceScoreInput = container.querySelector('#teacher_score_input_sub-alice') as HTMLInputElement;
    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set;
      nativeInputValueSetter!.call(aliceScoreInput, '100');
      aliceScoreInput.dispatchEvent(new Event('input', { bubbles: true }));
      aliceScoreInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Wait for state recalculation
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // Verify preview value updates to 96
    expect(formulaContainer!.innerHTML).toContain('96');
  });

  it('calls POST /api/commands with status draft when save draft is clicked', async () => {
    const mockAddToast = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TeacherAssignmentGradePanel
          lessonId="test-lesson"
          lang="zh"
          addToast={mockAddToast}
        />
      );
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // Mock commands POST call
    global.fetch = vi.fn().mockImplementation((url: string, options: any) => {
      if (url === '/api/commands' && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        expect(body.commandType).toBe('assignment.grade');
        expect(body.payload.submissionId).toBe('sub-alice');
        expect(body.payload.teacherScore).toBe(80);
        expect(body.payload.status).toBe('draft');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, result: { calculatedFinalScore: 84 } })
        });
      }
      if (url.includes('/eval-grades')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSubmissions) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    const draftBtn = container.querySelector('#teacher_draft_btn_sub-alice') as HTMLButtonElement;
    expect(draftBtn).not.toBeNull();

    await act(async () => {
      draftBtn.click();
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(global.fetch).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(
      '平时成绩草稿已保存',
      expect.any(String),
      'success'
    );
  });

  it('calls POST /api/commands with status confirmed when confirm and sync grade is clicked', async () => {
    const mockAddToast = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TeacherAssignmentGradePanel
          lessonId="test-lesson"
          lang="zh"
          addToast={mockAddToast}
        />
      );
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // Mock commands POST call
    global.fetch = vi.fn().mockImplementation((url: string, options: any) => {
      if (url === '/api/commands' && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        expect(body.commandType).toBe('assignment.grade');
        expect(body.payload.submissionId).toBe('sub-alice');
        expect(body.payload.teacherScore).toBe(80);
        expect(body.payload.status).toBe('confirmed');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, result: { calculatedFinalScore: 84 } })
        });
      }
      if (url.includes('/eval-grades')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSubmissions) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    const confirmBtn = container.querySelector('#teacher_confirm_btn_sub-alice') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();

    await act(async () => {
      confirmBtn.click();
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(window.confirm).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(
      '平时成绩同步成功',
      expect.any(String),
      'success'
    );
  });
});
