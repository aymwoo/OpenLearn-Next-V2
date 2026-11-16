import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { CourseManagement } from '../CourseManagement';

const fetchCourses = vi.fn();
const promoteLessonToLongCycle = vi.fn();

vi.mock('../../../context/AppDataContext', () => ({
  useAppData: () => mockAppData,
}));

vi.mock('../../lesson-activity-pack/p1-api', () => ({
  fetchCourses: (...args: unknown[]) => fetchCourses(...args),
  promoteLessonToLongCycle: (...args: unknown[]) => promoteLessonToLongCycle(...args),
}));

vi.mock('../../lesson-activity-pack', async () => {
  const actual = await vi.importActual<typeof import('../../lesson-activity-pack')>('../../lesson-activity-pack');
  return {
    ...actual,
    LongCycleCourseDetail: ({ courseId }: { courseId: string }) => (
      <div data-testid="long-cycle-course-detail">detail:{courseId}</div>
    ),
    ImportActivityPackToolbarButton: () => null,
  };
});

const mockAppData = {
  lang: 'zh' as const,
  session: { userId: 'usr_t', username: 'teacher', role: 'teacher' },
  lessons: [
    { id: 'les_regular', title: '常规课', content: '简介', creator_id: 'usr_t', creator_name: '张老师' },
    {
      id: 'les_ch1',
      title: '第一章',
      content: '已挂接',
      creator_id: 'usr_t',
      creator_name: '张老师',
      course_id: 'crs_1',
    },
  ],
  lessonsSearchQuery: '',
  setLessonsSearchQuery: vi.fn(),
  lessonsSortOrder: 'newest',
  setLessonsSortOrder: vi.fn(),
  filteredAndSortedLessons: [
    { id: 'les_regular', title: '常规课', content: '简介', creator_id: 'usr_t', creator_name: '张老师' },
    {
      id: 'les_ch1',
      title: '第一章',
      content: '已挂接',
      creator_id: 'usr_t',
      creator_name: '张老师',
      course_id: 'crs_1',
    },
  ],
  classes: [{ id: 'cls_1', name: '高一（1）班' }],
  isImportLessonsOpen: false,
  setIsImportLessonsOpen: vi.fn(),
  isCourseWizardOpen: false,
  setIsCourseWizardOpen: vi.fn(),
  onViewCourse: vi.fn(),
  onDeleteCourse: vi.fn(),
  onCopyCourse: vi.fn(),
  filterEnrollment: false,
  setFilterEnrollment: vi.fn(),
  filterHasContent: false,
  setFilterHasContent: vi.fn(),
  filterThisMonth: false,
  setFilterThisMonth: vi.fn(),
  copyingLessonId: null,
  fetchLessons: vi.fn(),
  downloadCourseTemplate: vi.fn(),
  exportCoursePackage: vi.fn(),
};

describe('CourseManagement 长周期课程卡片', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCourses.mockResolvedValue({
      courses: [
        {
          id: 'crs_1',
          title: '学期信息技术',
          description: '',
          ownerUserId: 'usr_t',
          term: null,
          visibility: 'enrolled',
          thumbnail: null,
          createdAt: 1,
          updatedAt: 1,
          isLongCycle: true,
          autoArchiveAfterMs: null,
          lessonCount: 1,
          lessonIds: ['les_ch1'],
        },
      ],
    });
  });

  afterEach(() => cleanup());

  it('不再展示底部独立课程层，长周期以带徽标的卡片出现，已挂接章节不再重复列出', async () => {
    render(<CourseManagement />);
    await waitFor(() => expect(screen.getByTestId('long-cycle-course-card')).toBeTruthy());
    expect(screen.queryByTestId('course-layer-board')).toBeNull();
    expect(screen.getByText('学期信息技术')).toBeTruthy();
    expect(screen.getAllByText('长周期').length).toBeGreaterThan(0);
    expect(screen.getByText('常规课')).toBeTruthy();
    expect(screen.getByTestId('regular-course-badge')).toBeTruthy();
    expect(screen.queryByText('第一章')).toBeNull();
    expect(screen.getByTestId('promote-long-cycle-btn')).toBeTruthy();
    expect(screen.getByTestId('course-list-count').textContent?.replace(/\s+/g, '')).toContain('显示2/2门课程');
  });

  it('可用全部、常规、长周期筛选课程，且挂接章节不计入总数', async () => {
    render(<CourseManagement />);
    await waitFor(() => expect(screen.getByTestId('long-cycle-course-card')).toBeTruthy());

    const typeFilter = screen.getByTestId('course-type-filter');
    const regularBtn = [...typeFilter.querySelectorAll('button')].find((btn) => btn.textContent === '常规');
    const longCycleBtn = [...typeFilter.querySelectorAll('button')].find((btn) => btn.textContent === '长周期');
    const allBtn = [...typeFilter.querySelectorAll('button')].find((btn) => btn.textContent === '全部');
    expect(regularBtn && longCycleBtn && allBtn).toBeTruthy();

    fireEvent.click(longCycleBtn!);
    expect(screen.getByText('学期信息技术')).toBeTruthy();
    expect(screen.queryByText('常规课')).toBeNull();
    expect(screen.getByTestId('course-list-count').textContent?.replace(/\s+/g, '')).toContain('显示1/1门课程');

    fireEvent.click(regularBtn!);
    expect(screen.getByText('常规课')).toBeTruthy();
    expect(screen.queryByText('学期信息技术')).toBeNull();
    expect(screen.getByTestId('course-list-count').textContent?.replace(/\s+/g, '')).toContain('显示1/1门课程');

    fireEvent.click(allBtn!);
    expect(screen.getByText('学期信息技术')).toBeTruthy();
    expect(screen.getByText('常规课')).toBeTruthy();
    expect(screen.getByTestId('course-list-count').textContent?.replace(/\s+/g, '')).toContain('显示2/2门课程');
  });

  it('打开长周期卡片进入详情，常规课可改成长周期', async () => {
    promoteLessonToLongCycle.mockResolvedValue({
      course: { id: 'crs_new', title: '常规课', isLongCycle: true, lessonIds: ['les_regular'] },
    });
    render(<CourseManagement />);
    await waitFor(() => expect(screen.getByTestId('long-cycle-course-card')).toBeTruthy());
    fireEvent.click(screen.getByText('管理章节与开课次'));
    expect(screen.getByTestId('long-cycle-course-detail').textContent).toContain('crs_1');

    fireEvent.click(screen.getByTestId('promote-long-cycle-btn'));
    expect(screen.getByText('改成长周期课程')).toBeTruthy();
    fireEvent.click(screen.getByText('确认转换'));
    await waitFor(() => expect(promoteLessonToLongCycle).toHaveBeenCalledWith('les_regular', { title: '常规课' }));
  });
});
