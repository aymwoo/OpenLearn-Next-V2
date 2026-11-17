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
 * 本文件在**组件层**复核这套语义，并按窄屏 / 桌面端两个宽度分别断言。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

/** 取出双栏容器下的两个栏：[Lesson Content 栏, 交互区栏]。 */
function getPanels(props: Partial<StudentLessonViewProps> = {}): HTMLElement[] {
  const { unmount } = render(
    <Suspense fallback={null}>
      <StudentLessonView {...makeProps(props)} />
    </Suspense>,
  );
  const content = screen.getByTestId('student-lesson-content-panel');
  const interaction = screen.getByTestId('student-lesson-interaction-panel');
  // 立即卸载：避免同一用例内多次渲染时 getByTestId 命中多个节点
  unmount();
  return [content, interaction];
}

function classes(el: Element): string[] {
  return el.className.split(/\s+/);
}

/**
 * 复刻 Tailwind v4 的实际级联（实测），分别判定两个宽度下的可见性。
 *
 * `.hidden { display:none }` 在同 `@layer utilities` 内早于
 * `@media (min-width:48rem) { .md\:block { display:block } }`，
 * 故桌面端 `md:block` 胜出；窄屏只有 `.hidden` 生效。
 */
function visibility(el: Element): { narrow: boolean; desktop: boolean } {
  const cls = classes(el);
  const hasHidden = cls.includes('hidden');
  const hasMdBlock = cls.includes('md:block');
  return {
    narrow: hasHidden,
    desktop: hasMdBlock ? false : hasHidden,
  };
}

describe('Issue IKVSIN：学生端「全屏」按钮的显隐语义', () => {
  it('右栏点「全屏」时，Lesson Content 栏在桌面端必须被隐藏', () => {
    const [contentPanel] = getPanels({ studentFullscreenPanel: 'right' });
    expect(visibility(contentPanel).desktop).toBe(true);
  });

  it('右栏点「全屏」时，Lesson Content 栏在窄屏也必须被隐藏', () => {
    const [contentPanel] = getPanels({ studentFullscreenPanel: 'right' });
    expect(visibility(contentPanel).narrow).toBe(true);
  });

  it('左栏点「全屏」时，交互区在桌面端必须被隐藏', () => {
    const [, interactionPanel] = getPanels({ studentFullscreenPanel: 'left' });
    expect(visibility(interactionPanel).desktop).toBe(true);
  });

  it('「全宽度隐藏」的栏不得携带 md:block（IKVSIN 核心回归点）', () => {
    // 右栏全屏 ⇒ 内容栏「所有宽度都隐藏」
    const [contentWhenRight] = getPanels({ studentFullscreenPanel: 'right' });
    expect(classes(contentWhenRight)).toContain('hidden');
    expect(classes(contentWhenRight)).not.toContain('md:block');

    // 折叠态 ⇒ 内容栏「所有宽度都隐藏」
    const [contentWhenCollapsed] = getPanels({
      studentFullscreenPanel: 'none',
      isStudentLessonContentCollapsed: true,
    });
    expect(classes(contentWhenCollapsed)).toContain('hidden');
    expect(classes(contentWhenCollapsed)).not.toContain('md:block');

    // 左栏全屏 ⇒ 交互区「所有宽度都隐藏」
    const [, interactionWhenLeft] = getPanels({ studentFullscreenPanel: 'left' });
    expect(classes(interactionWhenLeft)).toContain('hidden');
    expect(classes(interactionWhenLeft)).not.toContain('md:block');
  });

  it('默认态（panel=none）且课程内容展开时，左栏桌面端可见、窄屏隐藏', () => {
    const [contentPanel] = getPanels({ studentFullscreenPanel: 'none', isStudentLessonContentCollapsed: false });
    expect(visibility(contentPanel).desktop).toBe(false);
    expect(visibility(contentPanel).narrow).toBe(true);
  });

  it('课程内容折叠态（collapsed=true）时，左栏在桌面端被隐藏', () => {
    const [contentPanel] = getPanels({ studentFullscreenPanel: 'none', isStudentLessonContentCollapsed: true });
    expect(visibility(contentPanel).desktop).toBe(true);
  });

  it('左栏全屏（panel=left）时左栏占满宽度', () => {
    const [contentPanel] = getPanels({ studentFullscreenPanel: 'left' });
    expect(classes(contentPanel)).toContain('w-full');
  });

  it('右栏全屏（panel=right）时交互区占满宽度', () => {
    const [, interactionPanel] = getPanels({ studentFullscreenPanel: 'right' });
    expect(classes(interactionPanel)).toContain('w-full');
  });

  it('任何状态下都不会出现「两个栏同时隐藏」的空白页', () => {
    for (const state of ['none', 'left', 'right'] as const) {
      for (const collapsed of [false, true]) {
        const [contentPanel, interactionPanel] = getPanels({
          studentFullscreenPanel: state,
          isStudentLessonContentCollapsed: collapsed,
        });
        const content = visibility(contentPanel);
        const interaction = visibility(interactionPanel);
        expect(content.desktop && interaction.desktop, `state=${state} collapsed=${collapsed} 桌面端两栏同时隐藏`).toBe(
          false,
        );
        expect(content.narrow && interaction.narrow, `state=${state} collapsed=${collapsed} 窄屏两栏同时隐藏`).toBe(
          false,
        );
      }
    }
  });
});
