import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SurfaceLiveSummaryPanel } from '../SurfaceLiveSummaryPanel';

const SUMMARY = {
  lessonId: 'lesson-1',
  classId: 'class-1',
  rosterCount: 3,
  generatedAt: 1_700_000_000_000,
  surfaces: [
    {
      surfaceId: 'surf-1',
      rendererId: 'presentation',
      kind: 'whiteboard_element',
      ownerId: 'el-1',
      title: '本环节课件',
      segmentId: 'seg-1',
      rosterCount: 3,
      startedCount: 2,
      submittedCount: 2,
      gradedCount: 1,
      avgCompletion: 0.8,
      avgScorePercent: 75,
      avgScore: 7.5,
      maxScore: 10,
      pendingStudents: [{ studentId: 'stu-3', name: '未交同学' }],
    },
    {
      surfaceId: 'surf-2',
      rendererId: 'assignment_submission',
      kind: 'lesson_activity',
      ownerId: 'act-1',
      title: '课后作业',
      segmentId: null,
      rosterCount: 3,
      startedCount: 1,
      submittedCount: 1,
      gradedCount: 0,
      avgCompletion: 0.3,
      avgScorePercent: null,
      avgScore: null,
      maxScore: null,
      pendingStudents: [],
    },
  ],
  totals: {
    surfaceCount: 2,
    submittedCount: 3,
    gradedCount: 1,
    avgCompletion: 0.55,
    avgScorePercent: 75,
  },
};

describe('SurfaceLiveSummaryPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('展开后按当前环节过滤，并可切到本课', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => SUMMARY });
    vi.stubGlobal('fetch', fetchMock);

    render(<SurfaceLiveSummaryPanel lessonId="lesson-1" classId="class-1" activeSegmentId="seg-1" lang="zh" />);

    expect(screen.getByRole('button', { name: /Surface 完成概览/ })).toBeTruthy();
    const toggle = screen.getByRole('button', { name: /Surface 完成概览/ });
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
    fireEvent.click(toggle);

    await screen.findByText('本环节课件');
    expect(screen.queryByText('课后作业')).toBeNull();
    expect(screen.getAllByText('未交同学').length).toBeGreaterThan(0);
    expect(screen.getByRole('group', { name: '统计范围' })).toBeTruthy();
    expect(screen.getByRole('list', { name: '各 Surface 完成情况' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/lessons/lesson-1/learning-surface-summary?classId=class-1');

    fireEvent.click(screen.getByRole('button', { name: '本课' }));
    await waitFor(() => expect(screen.getByText('课后作业')).toBeTruthy());
  });
});
