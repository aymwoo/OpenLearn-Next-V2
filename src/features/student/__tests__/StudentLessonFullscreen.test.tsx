/**
 * Issue IKVSIN：学生端点击「全屏」按钮无反应。
 *
 * 根因（Tailwind v4 类覆盖顺序，实测确认）：
 *
 * 学生端双栏（Lesson Content / 交互区）用 `studentFullscreenPanel` 控制全屏，
 * 但旧实现里「默认态」与「右栏全屏态」产出的是**同一个 class 集合**：
 *
 *   'w-1/3 md:block hidden'                  ← panel='none'（默认）
 *   'w-1/3 md:block hidden ... hidden'       ← panel='right'（右栏全屏，多追加了一个 hidden）
 *
 * Tailwind v4 生成的 CSS（同 `@layer utilities` 内，后者胜出）：
 *   L262  .hidden      { display: none; }
 *   L270  @media (min-width: 48rem) {
 *   L271    .md\:block { display: block; }   ← 位置更靠后
 *
 * 同层同优先级 ⇒ **桌面端 `md:block` 覆盖 `hidden`**，元素保持 `display: block`。
 * 追加的 `hidden` 覆盖不掉 `md:block`，于是「右栏全屏」要求左栏让位时左栏
 * 依然可见（`w-1/3`）—— 视觉上就是「点了全屏没反应」。
 *
 * 修复口径：**每个状态产出唯一且完整的显隐表达**：
 *   · 全宽度隐藏   → `hidden`（不得再带 `md:block`）
 *   · 仅桌面端显示 → `hidden md:block`（与 `StudentAssignmentQuestionPanel` 同款写法）
 *   · 全宽度显示   → 不带任何 display 类
 *
 * 双栏 class 契约仍由 `studentFullscreenLayout.test.ts` 锁定。
 * 学生进课后不再默认并排两栏：主学习面必须始终挂上，不能再带
 * 「hidden + md:block」那组会在桌面端互相覆盖的类。大纲只在侧栏打开时出现。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Suspense } from 'react';
import type { StudentType, Lesson } from '../../../types/app';
import { StudentLessonView } from '../StudentLessonView';
import type { StudentLessonViewProps } from '../StudentLessonView';

vi.mock('../../../components/LazyWhiteboard', () => ({
  LazyWhiteboard: () => <div data-testid="lazy-whiteboard" />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeProps(overrides: Partial<StudentLessonViewProps> = {}): StudentLessonViewProps {
  return {
    students: [{ id: 's1', name: 'Alice', locked_lesson_id: null }] as unknown as StudentType[],
    activeStudentId: 's1',
    setStudentViewStatus: vi.fn(),
    setSelectedLesson: vi.fn(),
    lessons: [{ id: 'l1', title: 'Math', content: '# Hi' }] as unknown as Lesson[],
    selectedLesson: 'l1',
    studentFullscreenPanel: 'none',
    setStudentFullscreenPanel: vi.fn(),
    timelineSegments: [],
    lang: 'zh',
    activeSegmentId: null,
    setActiveSegmentId: vi.fn(),
    localProgressPercent: 0,
    setLocalProgressPercent: vi.fn(),
    updateStudentProgress: vi.fn(),
    isStudentLessonContentCollapsed: false,
    setIsStudentLessonContentCollapsed: vi.fn(),
    studentLessonTab: 'whiteboard',
    setStudentLessonTab: vi.fn(),
    elements: [],
    activeRole: 'student',
    fetchElements: vi.fn(),
    currentVfsParent: null,
    setCurrentVfsParent: vi.fn(),
    vfsNodes: [],
    studentSelectedCourseware: null,
    setStudentSelectedCourseware: vi.fn(),
    addToast: vi.fn(),
    ...overrides,
  };
}

describe('学生白板页主学习面不被全屏类覆盖', () => {
  it('默认主画布不带 hidden 与 md:block 的冲突组合', () => {
    render(
      <Suspense fallback={null}>
        <StudentLessonView {...makeProps()} />
      </Suspense>,
    );
    const panel = screen.getByTestId('student-lesson-interaction-panel');
    const cls = panel.className.split(/\s+/);
    expect(panel.getAttribute('data-chrome')).toBe('surface');
    expect(cls.includes('hidden') && cls.includes('md:block')).toBe(false);
    expect(screen.getByTestId('lazy-whiteboard')).toBeTruthy();
    expect(screen.queryByTestId('student-lesson-content-panel')).toBeNull();
  });

  it('大纲侧栏打开时内容区不用 md:block，关掉后画布还在', () => {
    render(
      <Suspense fallback={null}>
        <StudentLessonView {...makeProps()} />
      </Suspense>,
    );
    fireEvent.click(screen.getByTestId('student-tool-outline'));
    const content = screen.getByTestId('student-lesson-content-panel');
    expect(content.className.split(/\s+/)).not.toContain('md:block');
    expect(screen.getByTestId('student-learning-topic').isConnected).toBe(true);

    fireEvent.click(screen.getByTestId('student-tool-drawer-close'));
    expect(screen.queryByTestId('student-lesson-content-panel')).toBeNull();
    expect(screen.getByTestId('lazy-whiteboard').isConnected).toBe(true);
    expect(screen.getByTestId('student-learning-topic').isConnected).toBe(true);
  });
});
