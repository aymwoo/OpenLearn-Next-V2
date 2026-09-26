import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { ClassroomEntryPortal } from '../ClassroomEntryPortal';

afterEach(cleanup);

const LESSONS = [
  { id: 'les-1', title: 'Python 进阶与图形化编程', timeline: [{ id: 's1', title: '导入', duration: 300 }] },
  { id: 'les-2', title: '人工智能与机器学习启蒙' },
];

const CLASSES = [
  { id: 'cls-1', name: '高一 (3) 班' },
  { id: 'cls-2', name: '初二 (1) 班' },
];

const STUDENTS = [
  { id: 'stu-1', name: '张子豪', student_number: '01' },
  { id: 'stu-2', name: '李晓彤', student_number: '02' },
  { id: 'stu-3', name: '王一诺', student_number: '03' },
  { id: 'stu-4', name: '赵梓涵', student_number: '04' },
];

const MODES = [
  {
    id: 'lecture',
    name: '讲授式',
    nameEn: 'Lecture',
    description: '教师主导讲解',
    descriptionEn: 'Teacher-led',
    icon: 'Presentation',
    color: 'indigo',
    isBuiltin: true,
    sortOrder: 10,
  },
  {
    id: 'inquiry',
    name: '探究式',
    nameEn: 'Inquiry',
    description: '问题驱动',
    descriptionEn: 'Question-driven',
    icon: 'FlaskConical',
    color: 'emerald',
    isBuiltin: true,
    sortOrder: 20,
  },
  {
    id: 'collaborative',
    name: '协作式',
    nameEn: 'Collaborative',
    description: '小组协作',
    descriptionEn: 'Group work',
    icon: 'Users',
    color: 'amber',
    isBuiltin: true,
    sortOrder: 30,
  },
];

/** 门户 API 与物理座位图 API 的成功响应。 */
const okFetcher = (students = STUDENTS) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/seats')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          lab_id: 'lab-1',
          seats: students.map((student, index) => ({
            student_id: student.id,
            row_idx: 0,
            col_idx: index,
          })),
        }),
      };
    }
    if (url.endsWith('/api/labs')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 'lab-1', room_number: 'A-101', rows: 1, cols: 4 }],
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, modes: MODES }),
    };
  }) as unknown as typeof fetch;

/** 教学模式接口失败响应（用于验证降级不阻塞开课） */
const failingFetcher = () =>
  vi.fn(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: '内部错误' }),
  })) as unknown as typeof fetch;

function renderPortal(overrides: Partial<React.ComponentProps<typeof ClassroomEntryPortal>> = {}) {
  const onEnterClassroom = vi.fn().mockResolvedValue(undefined);
  const setSelectedLesson = vi.fn();
  const setLiveClassSelectedClassId = vi.fn();
  const utils = render(
    <ClassroomEntryPortal
      lessons={LESSONS}
      classes={CLASSES}
      students={STUDENTS}
      selectedLesson={null}
      setSelectedLesson={setSelectedLesson}
      liveClassSelectedClassId={null}
      setLiveClassSelectedClassId={setLiveClassSelectedClassId}
      timelineSegments={[{ id: 's1', title: '导入与热身', duration: 300 }]}
      onlineStudentIds={['stu-1', 'stu-2']}
      lang="zh"
      addToast={vi.fn()}
      onEnterClassroom={onEnterClassroom}
      fetcher={okFetcher()}
      {...overrides}
    />,
  );
  return { ...utils, onEnterClassroom, setSelectedLesson, setLiveClassSelectedClassId };
}

describe('ClassroomEntryPortal（互动课堂起始门户）', () => {
  describe('三栏结构渲染', () => {
    it('渲染 STEP1 课程、STEP2 班级、启动区与右栏蓝图', async () => {
      renderPortal();

      expect(await screen.findByText('选择授课课程')).toBeTruthy();
      expect(screen.getByText('挑选授课班级')).toBeTruthy();
      expect(screen.getByText('本节课教学蓝图')).toBeTruthy();
      expect(screen.getByText('课前三项自检体检卡')).toBeTruthy();
      expect(screen.getByRole('button', { name: /进入数字赋能课堂/ })).toBeTruthy();
    });

    it('列出全部课程与班级', async () => {
      renderPortal();
      await screen.findByText('选择授课课程');

      expect(screen.getByText('Python 进阶与图形化编程')).toBeTruthy();
      expect(screen.getByText('人工智能与机器学习启蒙')).toBeTruthy();
      expect(screen.getByText('高一 (3) 班')).toBeTruthy();
      expect(screen.getByText('初二 (1) 班')).toBeTruthy();
    });

    it('can find courses and classes beyond the first six entries', async () => {
      const lessons = [
        ...LESSONS,
        ...Array.from({ length: 6 }, (_, index) => ({ id: `les-extra-${index}`, title: `扩展课程 ${index + 1}` })),
      ];
      const classes = [
        ...CLASSES,
        ...Array.from({ length: 6 }, (_, index) => ({ id: `cls-extra-${index}`, name: `扩展班级 ${index + 1}` })),
      ];
      renderPortal({ lessons, classes });

      expect(await screen.findByText('扩展课程 6')).toBeTruthy();
      expect(screen.getByText('扩展班级 6')).toBeTruthy();
    });

    it('空课节列表时给出引导文案而不是空白', async () => {
      renderPortal({ lessons: [] });
      expect(await screen.findByText(/暂无可用课程/)).toBeTruthy();
    });
  });

  describe('课程与班级选择', () => {
    it('点击课程触发选择并标记选中态', async () => {
      const { setSelectedLesson } = renderPortal();
      await screen.findByText('选择授课课程');

      const card = screen.getByText('Python 进阶与图形化编程').closest('button')!;
      fireEvent.click(card);

      expect(setSelectedLesson).toHaveBeenCalledWith('les-1');
    });

    it('选中课程后卡片呈现已选标记', async () => {
      renderPortal({ selectedLesson: 'les-1' });
      await screen.findByText('选择授课课程');

      // 课程名同时出现在顶部横幅的状态胶囊中，故按 button 过滤出卡片本身
      const card = screen
        .getAllByText('Python 进阶与图形化编程')
        .map((el) => el.closest('button'))
        .find(Boolean) as HTMLElement;
      expect(card.getAttribute('aria-pressed')).toBe('true');
      expect(within(card).getByText('已选')).toBeTruthy();
    });

    it('选择班级后展示席位矩阵', async () => {
      const { setLiveClassSelectedClassId } = renderPortal();
      await screen.findByText('挑选授课班级');

      fireEvent.click(screen.getByText('高一 (3) 班'));

      expect(setLiveClassSelectedClassId).toHaveBeenCalledWith('cls-1');
    });

    it('已选班级时渲染席位矩阵与在线状态', async () => {
      renderPortal({ liveClassSelectedClassId: 'cls-1' });
      await screen.findByText('机房座位图');

      expect(screen.getByTitle(/张子豪.*在线/)).toBeTruthy();
      expect(screen.getByTitle(/王一诺.*离线/)).toBeTruthy();
    });

    it('empty roster displays an unassigned physical seating map', async () => {
      renderPortal({ liveClassSelectedClassId: 'cls-1', students: [], fetcher: okFetcher([]) });
      await screen.findByText('机房座位图');

      expect(screen.getByText('空位 (4)')).toBeTruthy();
    });

    it('does not report an empty class roster as preflight-ready', async () => {
      renderPortal({ students: [] });

      expect(await screen.findByText('暂无学生名单')).toBeTruthy();
      expect(screen.getByText('需注意')).toBeTruthy();
    });
  });

  describe('教学模式', () => {
    it('从接口加载并渲染前三项模式', async () => {
      renderPortal();

      expect(await screen.findByText('讲授式')).toBeTruthy();
      expect(screen.getByText('探究式')).toBeTruthy();
      expect(screen.getByText('协作式')).toBeTruthy();
      expect(screen.getByRole('radiogroup', { name: '教学模式' })).toBeTruthy();
    });

    it('默认选中第一项模式，点击可切换', async () => {
      renderPortal();

      const lecture = await screen.findByRole('radio', { name: /讲授式/ });
      const inquiry = screen.getByRole('radio', { name: /探究式/ });
      expect(lecture.getAttribute('aria-checked')).toBe('true');

      fireEvent.click(inquiry);
      await waitFor(() => expect(inquiry.getAttribute('aria-checked')).toBe('true'));
      expect(lecture.getAttribute('aria-checked')).toBe('false');
    });

    it('接口失败时降级为空模式，页面其余部分仍可用', async () => {
      renderPortal({ fetcher: failingFetcher() });

      expect(await screen.findByText('暂无可用模式')).toBeTruthy();
      // 关键：教学模式失效不应连累课程选择与启动按钮
      expect(screen.getByText('Python 进阶与图形化编程')).toBeTruthy();
      expect(screen.getByRole('button', { name: /进入数字赋能课堂/ })).toBeTruthy();
    });
  });

  describe('启动课堂', () => {
    it('未选课程或班级时按钮禁用', async () => {
      renderPortal();
      await screen.findByText('选择授课课程');

      expect(screen.getByRole('button', { name: /进入数字赋能课堂/ })).toHaveProperty('disabled', true);
    });

    it('条件齐备时按钮可用', async () => {
      renderPortal({ selectedLesson: 'les-1', liveClassSelectedClassId: 'cls-1' });
      await screen.findByText('选择授课课程');

      expect(screen.getByRole('button', { name: /进入数字赋能课堂/ })).toHaveProperty('disabled', false);
    });

    it('disables launch when stored course or class selections are stale', async () => {
      renderPortal({ selectedLesson: 'lesson-deleted', liveClassSelectedClassId: 'class-deleted' });
      await screen.findByText('选择授课课程');

      expect(screen.getByRole('button', { name: /进入数字赋能课堂/ })).toHaveProperty('disabled', true);
    });

    it('点击后回调携带课程、班级与所选教学模式', async () => {
      const { onEnterClassroom } = renderPortal({
        selectedLesson: 'les-1',
        liveClassSelectedClassId: 'cls-1',
      });

      const launch = await screen.findByRole('button', { name: /进入数字赋能课堂/ });
      fireEvent.click(launch);

      await waitFor(() =>
        expect(onEnterClassroom).toHaveBeenCalledWith({
          lessonId: 'les-1',
          classId: 'cls-1',
          teachingModeId: 'lecture',
        }),
      );
    });

    it('切换教学模式后回调携带新模式 id', async () => {
      const { onEnterClassroom } = renderPortal({
        selectedLesson: 'les-1',
        liveClassSelectedClassId: 'cls-1',
      });

      fireEvent.click(await screen.findByRole('radio', { name: /协作式/ }));
      fireEvent.click(screen.getByRole('button', { name: /进入数字赋能课堂/ }));

      await waitFor(() =>
        expect(onEnterClassroom).toHaveBeenCalledWith(
          expect.objectContaining({ teachingModeId: 'collaborative' }),
        ),
      );
    });

    it('初始化失败时提示且不抛出未捕获异常', async () => {
      const addToast = vi.fn();
      const onEnterClassroom = vi.fn().mockRejectedValue(new Error('初始化课堂会话失败'));
      renderPortal({
        selectedLesson: 'les-1',
        liveClassSelectedClassId: 'cls-1',
        addToast,
        onEnterClassroom,
      });

      fireEvent.click(await screen.findByRole('button', { name: /进入数字赋能课堂/ }));

      await waitFor(() => expect(addToast).toHaveBeenCalled());
      expect(addToast.mock.calls[0][2]).toBe('error');
    });
  });

  describe('右栏', () => {
    it('按环节时长渲染节奏管道占比', async () => {
      renderPortal({
        timelineSegments: [
          { id: 'a', title: '就绪', duration: 300 },
          { id: 'b', title: '讲授', duration: 1200 },
        ],
      });

      expect(await screen.findByText('课堂节拍节奏设计（25 分钟）')).toBeTruthy();
      expect(screen.getByText('就绪')).toBeTruthy();
      expect(screen.getByText('讲授')).toBeTruthy();
    });

    it('无环节大纲时给出默认授课提示', async () => {
      renderPortal({ timelineSegments: [] });
      expect(await screen.findByText(/暂未配置环节大纲/)).toBeTruthy();
    });

    it('未连接席位被列入课前关注提示', async () => {
      renderPortal();
      expect(await screen.findByText(/王一诺/)).toBeTruthy();
      // 两名学生未连接，各自一条关注提示
      expect(screen.getAllByText(/学生端尚未连接/).length).toBeGreaterThanOrEqual(1);
    });

    it('全员在线时提示无需关注', async () => {
      renderPortal({ onlineStudentIds: STUDENTS.map((s) => s.id) });
      expect(await screen.findByText(/全员席位已连接/)).toBeTruthy();
    });
  });
});
