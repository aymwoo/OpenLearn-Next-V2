// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StudentAssignmentEvalPanel } from '../../components/StudentAssignmentEvalPanel';

describe('StudentAssignmentEvalPanel UI Component (Phase 15)', () => {
  let container: HTMLElement;
  let root: any;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Mock global fetch
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/eval-status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            submission: {
              id: 'sub-123',
              lesson_id: 'test-lesson',
              student_id: 'student-alice',
              file_path: '/files/my-hw.pdf',
              version: 1,
              updated_at: Date.now()
            },
            reviewsWritten: [
              {
                id: 'rev-456',
                submission_id: 'sub-789',
                reviewer_id: 'student-alice',
                score: 90,
                comment: 'Great work Bob!',
                student_name: 'Bob'
              }
            ],
            grade: {
              id: 'grd-999',
              submission_id: 'sub-123',
              teacher_score: 95,
              teacher_comment: 'Well written.',
              teacher_weight: 0.6,
              peer_weight: 0.4,
              calculated_final_score: 93,
              status: 'confirmed'
            }
          })
        });
      }

      if (url.includes('/eval-submissions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              id: 'sub-123',
              lesson_id: 'test-lesson',
              student_id: 'student-alice',
              file_path: '/files/my-hw.pdf',
              version: 1,
              updated_at: Date.now()
            },
            {
              id: 'sub-789',
              lesson_id: 'test-lesson',
              student_id: 'student-bob',
              file_path: '/files/bob-hw.pdf',
              version: 2,
              updated_at: Date.now(),
              student_name: 'Bob'
            }
          ])
        });
      }

      return Promise.reject(new Error('Unknown endpoint'));
    }) as any;
  });

  afterEach(() => {
    if (root) {
      root.unmount();
    }
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it('renders student submission info, grade, and classmate reviews', async () => {
    const mockAddToast = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <StudentAssignmentEvalPanel
          lessonId="test-lesson"
          studentId="student-alice"
          lang="zh"
          addToast={mockAddToast}
        />
      );
    });

    // Wait for async fetch and React state updates
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // 1. Verify "我的作业提交" heading exists
    expect(container.innerHTML).toContain('我的作业提交');

    // 2. Verify submission version and file name are rendered
    expect(container.innerHTML).toContain('my-hw.pdf');
    expect(container.innerHTML).toContain('V1');

    // 3. Verify final synced grade is rendered
    expect(container.innerHTML).toContain('93');
    expect(container.innerHTML).toContain('已确认同步');

    // 4. Verify classmate Bob is listed in the peer review pane
    expect(container.innerHTML).toContain('Bob');
    expect(container.innerHTML).toContain('bob-hw.pdf');

    // 5. Verify Bob has a submit button for peer reviews
    expect(container.innerHTML).toContain('修改评分');
  });

  it('supports submit file form action by calling API commands', async () => {
    const mockAddToast = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <StudentAssignmentEvalPanel
          lessonId="test-lesson"
          studentId="student-alice"
          lang="en"
          addToast={mockAddToast}
        />
      );
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // Mock upload form post
    global.fetch = vi.fn().mockImplementation((url: string, options: any) => {
      if (url === '/api/commands' && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        expect(body.commandType).toBe('assignment.submit');
        expect(body.payload.filePath).toBe('/files/my-homework.pdf');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, result: { version: 2 } })
        });
      }
      if (url.includes('/eval-submissions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes('/eval-status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ submission: null, reviewsWritten: [], grade: null }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    const form = container.querySelector('form');
    expect(form).not.toBeNull();

    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(global.fetch).toHaveBeenCalled();
  });
});
