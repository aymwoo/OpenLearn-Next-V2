import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ActivityPackTeacherPreview } from '../ActivityPackTeacherPreview';

describe('ActivityPackTeacherPreview', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          pack: {
            preview: true,
            previewKind: 'activity-pack-student',
            unpublishedCount: 1,
            lessonId: 'les-1',
            courseId: null,
            blocks: [],
            activities: [],
            summary: {
              displayPercent: 0,
              verifiedPercent: 0,
              completed: false,
              requiredTotal: 0,
              requiredVerified: 0,
              requiredSubmitted: 0,
            },
          },
        }),
      })),
    );
  });

  it('展示与 C 组迁移预览及课堂学生视角区分开的学案预览条', async () => {
    render(<ActivityPackTeacherPreview lessonId="les-1" lang="zh" />);
    expect(screen.getByTestId('activity-pack-teacher-preview')).toBeTruthy();
    expect(screen.getByText(/教师预览（模拟学生）/)).toBeTruthy();
    expect(screen.getByText(/不是 C 组工作区预览/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/未发布活动/)).toBeTruthy();
    });
  });
});
