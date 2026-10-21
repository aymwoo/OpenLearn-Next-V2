import type { StateCreator } from 'zustand/vanilla';
import type { Lesson, WhiteboardElement, VFSNode } from '../../types/app';
import type { AppState } from '../appStore.js';
import { getLessons } from '../../services/lessonService.js';
import { listFromEnvelope } from '../../utils/listEnvelope.js';

export interface LessonSlice {
  lessons: Lesson[];
  selectedLesson: string | null;
  elements: WhiteboardElement[];
  vfsNodes: VFSNode[];

  setLessons: (lessons: Lesson[] | ((prev: Lesson[]) => Lesson[])) => void;
  setSelectedLesson: (selectedLesson: string | null) => void;
  setElements: (elements: WhiteboardElement[]) => void;
  setVfsNodes: (nodes: VFSNode[]) => void;
  loadLessons: () => Promise<void>;
}

export const createLessonSlice: StateCreator<AppState, [], [], LessonSlice> = (set, get) => ({
  lessons: [],
  selectedLesson: null,
  elements: [],
  vfsNodes: [],

  setLessons: (lessons) =>
    set((state) => ({
      lessons: typeof lessons === 'function' ? (lessons as (prev: Lesson[]) => Lesson[])(state.lessons) : lessons,
    })),
  setSelectedLesson: (selectedLesson) => set({ selectedLesson }),
  setElements: (elements) => set({ elements }),
  setVfsNodes: (vfsNodes) => set({ vfsNodes }),

  loadLessons: async () => {
    try {
      const { ok, data } = await getLessons();
      if (ok) {
        const lessons = listFromEnvelope<Lesson>(data);
        set((state) => ({
          lessons,
          selectedLesson:
            state.selectedLesson ??
            (canAutoSelectFirstLesson(get()) && lessons.length > 0 ? lessons[0].id : state.selectedLesson),
        }));
      }
    } catch (e) {
      console.warn('Failed to fetch lessons', e);
    }
  },
});

/**
 * 是否允许「默认选中第一节课」。
 *
 * ## 为什么学生端不行
 *
 * `GET /api/lessons` 对任何已登录角色开放（课程列表是平台级资源），而
 * `GET /api/lessons/:id/whiteboard` 只对**该课节所在班级的成员**开放
 * （`requireScopedAuth('class-member')`）。若学生端也默认选中 `lessons[0]`，
 * 白板轮询就会去拉**别人课节**的白板 → 每次进学生端外壳稳定吃一个 403。
 *
 * 学生端的当前课节本来就由**自己的**课表 / 课程进度 / 进行中课堂会话决定
 * （见 `StudentCourseProgressList` / `StudentSchedulePanel` / `StudentDashboardPanel`），
 * 不需要也不应该替他们猜一节。
 */
function canAutoSelectFirstLesson(state: Pick<AppState, 'session'>): boolean {
  return state.session?.role === 'teacher';
}
