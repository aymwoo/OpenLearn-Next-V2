/**
 * 课堂内「编辑课程」入口：统一回到课程管理，不再跳转到已下线的备课页。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { navigateToCourseEditor } from '../LiveClassroomView';
import { appStore } from '../../store/appStore';

vi.mock('../LazyWhiteboard', () => ({ LazyWhiteboard: () => null }));
vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }),
}));

describe('navigateToCourseEditor', () => {
  afterEach(() => {
    appStore.getState().setCourseEditingLessonId(null);
    vi.restoreAllMocks();
  });

  it('写入编辑中的课程并切到课程管理', () => {
    const setTeacherTab = vi.fn();

    navigateToCourseEditor('lesson-9', setTeacherTab);

    expect(setTeacherTab).toHaveBeenCalledWith('courses');
    expect(setTeacherTab).not.toHaveBeenCalledWith('lesson_editor');
    expect(setTeacherTab).not.toHaveBeenCalledWith('xuean_editor');
    expect(appStore.getState().courseEditingLessonId).toBe('lesson-9');
  });

  it('未注入 setTeacherTab 时使用 appStore 的路由 setter', () => {
    const original = appStore.getState().setTeacherTab;
    const setTeacherTab = vi.fn();
    appStore.setState({ setTeacherTab });

    try {
      navigateToCourseEditor('lesson-10');
      expect(setTeacherTab).toHaveBeenCalledWith('courses');
      expect(appStore.getState().courseEditingLessonId).toBe('lesson-10');
    } finally {
      appStore.setState({ setTeacherTab: original });
    }
  });
});
