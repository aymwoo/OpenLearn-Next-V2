/**
 * CourseManagement：课程编辑在页内展开，不切换系统导航。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CourseManagement } from '../CourseManagement';

const onViewCourse = vi.hoisted(() => vi.fn());

const lessons = vi.hoisted(() => [
  { id: 'l-wb', title: '白板课', content: '', delivery_mode: 'whiteboard' },
  { id: 'l-xa', title: '学案课', content: '', delivery_mode: 'xuean' },
]);

vi.mock('../../../context/AppDataContext', () => ({
  useAppData: () => ({
    lang: 'zh',
    session: { username: 'teacher', role: 'teacher' },
    lessons,
    lessonsSearchQuery: '',
    setLessonsSearchQuery: vi.fn(),
    lessonsSortOrder: 'recent',
    setLessonsSortOrder: vi.fn(),
    filteredAndSortedLessons: lessons,
    isImportLessonsOpen: false,
    setIsImportLessonsOpen: vi.fn(),
    isCourseWizardOpen: false,
    setIsCourseWizardOpen: vi.fn(),
    onViewCourse,
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
  }),
}));

vi.mock('../../classroom/mode-pack/useModePackCatalog', () => ({
  useModePackCatalog: () => [],
  resolveLessonDeliveryMode: (lesson: { delivery_mode?: string | null }) =>
    lesson?.delivery_mode === 'xuean' ? 'xuean' : 'whiteboard',
  resolveLessonModeBadge: (lesson: { delivery_mode?: string | null }) => ({
    mode: lesson?.delivery_mode === 'xuean' ? 'xuean' : 'whiteboard',
    title: lesson?.delivery_mode === 'xuean' ? '学案' : '白板',
  }),
}));

vi.mock('../../classroom/mode-pack/flags', () => ({
  isModePacksEnabled: () => false,
}));

vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => null,
}));

vi.mock('../LessonEditorView', () => ({
  LessonEditorView: () => <div data-testid="lesson-editor-view" />,
}));

vi.mock('../xuean/XueanEditor', () => ({
  XueanEditor: () => <div data-testid="xuean-editor-view" />,
}));

vi.mock('../../classroom/mode-pack/ModePackPrepShell', () => ({
  ModePackPrepShell: () => <div data-testid="mode-pack-prep-shell" />,
}));

describe('CourseManagement 课程编辑页内展开', () => {
  afterEach(() => {
    cleanup();
    onViewCourse.mockReset();
  });

  it('白板课程在课程管理内打开白板编辑器并可返回', async () => {
    render(<CourseManagement />);

    fireEvent.click(screen.getByText('白板课'));

    expect(await screen.findByTestId('lesson-editor-view')).toBeTruthy();
    expect(onViewCourse).toHaveBeenCalledWith('l-wb');
    expect(screen.getByText(/返回课程管理/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /返回课程管理/ }));
    expect(await screen.findByText('学案课')).toBeTruthy();
  });

  it('学案课程在课程管理内打开学案编辑器', async () => {
    render(<CourseManagement />);

    fireEvent.click(screen.getByText('学案课'));

    expect(await screen.findByTestId('xuean-editor-view')).toBeTruthy();
    expect(onViewCourse).toHaveBeenCalledWith('l-xa');
  });
});
