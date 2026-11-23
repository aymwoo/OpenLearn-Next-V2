/**
 * XueanEditor：页内编辑时提供「返回课程管理」入口。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { XueanEditor } from '../XueanEditor';
import { appStore } from '../../../../store/appStore';

vi.mock('../../../../context/AppDataContext', () => ({
  useOptionalAppData: () => ({
    selectedLesson: 'lesson-1',
    lessons: [{ id: 'lesson-1', title: '学案课程test' }],
    lang: 'zh',
  }),
}));

vi.mock('../XueanBlocksEditor', () => ({ XueanBlocksEditor: () => <div data-testid="home-editor" /> }));
vi.mock('../XueanActivitiesPanel', () => ({ XueanActivitiesPanel: () => <div data-testid="activities" /> }));
vi.mock('../ProgressPanel', () => ({ ProgressPanel: () => <div data-testid="progress" /> }));
vi.mock('../../../student/xuean/StudentXueanView', () => ({
  StudentXueanView: () => <div data-testid="student-preview" />,
}));
vi.mock('../../../../services/lessonActivitiesService.js', () => ({
  exportXueanPackage: vi.fn(),
  importXueanPackage: vi.fn(),
}));

describe('XueanEditor 返回课程管理', () => {
  afterEach(() => {
    cleanup();
    appStore.getState().setCourseEditingLessonId(null);
  });

  it('页内编辑时显示返回入口并清空编辑中的课程', async () => {
    appStore.getState().setCourseEditingLessonId('lesson-1');

    render(<XueanEditor />);
    expect(await screen.findByTestId('home-editor')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /返回课程管理/ }));
    expect(appStore.getState().courseEditingLessonId).toBeNull();
  });

  it('非页内编辑（如旧路由）不显示返回入口', async () => {
    render(<XueanEditor />);
    expect(await screen.findByTestId('home-editor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /返回课程管理/ })).toBeNull();
  });
});
