import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  getCourses: vi.fn(),
  getCourse: vi.fn(),
  createCourse: vi.fn(),
  updateCourse: vi.fn(),
  deleteCourse: vi.fn(),
  createCourseLesson: vi.fn(),
  deleteLesson: vi.fn(),
  fetchLessons: vi.fn(),
  setSelectedLesson: vi.fn(),
  setTeacherTab: vi.fn(),
}));

vi.mock('../../../../services/courseService', () => ({
  getCourses: m.getCourses,
  getCourse: m.getCourse,
  createCourse: m.createCourse,
  updateCourse: m.updateCourse,
  deleteCourse: m.deleteCourse,
  createCourseLesson: m.createCourseLesson,
}));

vi.mock('../../../../services/lessonService', () => ({ deleteLesson: m.deleteLesson }));

vi.mock('../../../../context/AppDataContext', () => ({
  useAppData: () => ({
    fetchLessons: m.fetchLessons,
    setSelectedLesson: m.setSelectedLesson,
    setTeacherTab: m.setTeacherTab,
  }),
}));

import { XueanCourseManagement } from '../XueanCourseManagement';

const course = {
  id: 'c1',
  title: '初一数学学案',
  description: '第一学期',
  owner_user_id: 'u1',
  term: '2026 秋季',
  visibility: 'private',
  thumbnail: null,
  created_at: 1,
  updated_at: 2,
  lesson_count: 2,
  enrollment_count: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getCourses.mockResolvedValue({ ok: true, data: [course] });
  m.getCourse.mockResolvedValue({
    ok: true,
    data: {
      ...course,
      lessons: [
        { id: 'l1', title: '第 1 课时', content: '', created_at: 1 },
        { id: 'l2', title: '第 2 课时', content: '', created_at: 2 },
      ],
      enrollments: [],
    },
  });
  m.createCourse.mockResolvedValue({ ok: true, data: course });
  m.updateCourse.mockResolvedValue({ ok: true, data: course });
  m.deleteCourse.mockResolvedValue({ ok: true, data: { success: true } });
  m.createCourseLesson.mockResolvedValue({ ok: true, data: { lessonId: 'l3' } });
  m.deleteLesson.mockResolvedValue({ ok: true, data: {} });
  m.fetchLessons.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe('XueanCourseManagement', () => {
  it('渲染课程卡片及课时/选课统计', async () => {
    render(<XueanCourseManagement />);
    expect(await screen.findByText('初一数学学案')).toBeTruthy();
    expect(screen.getByText(/2 课时/)).toBeTruthy();
    expect(screen.getByText(/3 人/)).toBeTruthy();
  });

  it('新建课程提交后调用 createCourse', async () => {
    render(<XueanCourseManagement />);
    await screen.findByText('初一数学学案');
    fireEvent.click(screen.getByText('新建学案课程'));
    const title = await screen.findByLabelText(/课程名称/);
    fireEvent.change(title, { target: { value: '新课' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(m.createCourse).toHaveBeenCalledWith(expect.objectContaining({ title: '新课', visibility: 'private' })),
    );
  });

  it('删除课程确认后调用 deleteCourse', async () => {
    render(<XueanCourseManagement />);
    await screen.findByText('初一数学学案');
    fireEvent.click(screen.getByTitle('删除课程'));
    const confirm = await screen.findByText('确认删除');
    fireEvent.click(confirm);
    await waitFor(() => expect(m.deleteCourse).toHaveBeenCalledWith('c1'));
  });

  it('进入课程详情并新增课时', async () => {
    render(<XueanCourseManagement />);
    fireEvent.click(await screen.findByText('查看课时'));
    expect(await screen.findByText('第 1 课时')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('新增课时'), { target: { value: '第 3 课时' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    await waitFor(() => expect(m.createCourseLesson).toHaveBeenCalledWith('c1', '第 3 课时'));
  });

  it('点击「编辑学案」刷新课时列表并跳转到编辑器', async () => {
    render(<XueanCourseManagement />);
    fireEvent.click(await screen.findByText('查看课时'));
    const buttons = await screen.findAllByText('编辑学案');
    fireEvent.click(buttons[0]);
    await waitFor(() => {
      expect(m.fetchLessons).toHaveBeenCalled();
      expect(m.setSelectedLesson).toHaveBeenCalledWith('l1');
      expect(m.setTeacherTab).toHaveBeenCalledWith('xuean_editor');
    });
  });
});
