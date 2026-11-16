import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { LongCycleCourseDetail } from '../LongCycleCourseDetail';

const fetchCourse = vi.fn();
const startCourseLessonSession = vi.fn();
const attachCourseLessons = vi.fn();
const updateCourse = vi.fn();

vi.mock('../p1-api', () => ({
  fetchCourse: (...args: unknown[]) => fetchCourse(...args),
  startCourseLessonSession: (...args: unknown[]) => startCourseLessonSession(...args),
  attachCourseLessons: (...args: unknown[]) => attachCourseLessons(...args),
  updateCourse: (...args: unknown[]) => updateCourse(...args),
}));

vi.mock('../CourseDiscussionBoard', () => ({
  CourseDiscussionBoard: () => <div data-testid="discussion-board" />,
}));

describe('LongCycleCourseDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCourse.mockResolvedValue({
      course: {
        id: 'crs_1',
        title: '学期信息技术',
        isLongCycle: true,
        autoArchiveAfterMs: null,
      },
      lessons: [{ id: 'les_ch1', title: '第一章', courseOrder: 0, courseId: 'crs_1' }],
      enrollments: [],
    });
  });

  afterEach(() => cleanup());

  it('未选择班级时不能暗默用列表第一项开课次，选定任意班级即可开课并绑定', async () => {
    render(
      <LongCycleCourseDetail
        lang="zh"
        courseId="crs_1"
        lessons={[{ id: 'les_ch1', title: '第一章' }]}
        classes={[
          { id: 'cls_1', name: '高一（1）班' },
          { id: 'cls_2', name: '高一（2）班' },
        ]}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('学期信息技术')).toBeTruthy());
    const select = screen.getByTestId('long-cycle-session-class') as HTMLSelectElement;
    expect(select.value).toBe('');
    fireEvent.click(screen.getByText('一键开课次'));
    expect(startCourseLessonSession).not.toHaveBeenCalled();
    expect(screen.getByText('请先选择要开课的班级')).toBeTruthy();

    fireEvent.change(select, { target: { value: 'cls_2' } });
    startCourseLessonSession.mockResolvedValue({ session: { id: 'sess_1' }, created: true });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    fireEvent.click(screen.getByText('一键开课次'));
    await waitFor(() => expect(startCourseLessonSession).toHaveBeenCalledWith('crs_1', 'les_ch1', 'cls_2'));
  });
});
