import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { LiveClassroomMiddleWorkspace } from '../LiveClassroomMiddleWorkspace';

vi.mock('../../../components/LazyWhiteboard', () => ({
  LazyWhiteboard: () => <div data-testid="lazy-whiteboard" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    selectedLesson: 'lesson-1',
    isLeftSidebarCollapsed: false,
    setIsLeftSidebarCollapsed: vi.fn(),
    middleTab: 'segment_main',
    setMiddleTab: vi.fn(),
    lang: 'zh',
    hasSegmentMainExtension: false,
    currentActiveSegment: { id: 'seg-1', type: 'lecture', title: '导入' },
    studentErrors: [],
    isSocketConnected: true,
    onFinishTeaching: vi.fn(),
    teacherWhiteboardBridge: { canvasProps: {} },
    liveClassSelectedClassId: 'class-1',
    segmentMainFlowController: {},
    onWhiteboardRefresh: vi.fn(),
    whiteboardRef: { current: null },
    restoredCurrentPage: 1,
    onFullscreenSync: vi.fn(),
    elements: [],
    activeSegmentId: 'seg-1',
    onSegmentSync: vi.fn(),
    classroomTools: undefined,
    onExecuteTool: vi.fn(),
    onPagesStateChange: vi.fn(),
    onElementAdd: vi.fn(),
    onElementUpdate: vi.fn(),
    onElementDelete: vi.fn(),
    fetchElements: vi.fn(),
    lessons: [],
    classes: [],
    students: [],
    addToast: vi.fn(),
    compact: true,
    ...overrides,
  } as unknown as ComponentProps<typeof LiveClassroomMiddleWorkspace>;
}

describe('LiveClassroomMiddleWorkspace 环节工作区回退', () => {
  it('当前环节没有匹配的工作区扩展时回退到白板，避免中栏空白', () => {
    const setMiddleTab = vi.fn();
    render(<LiveClassroomMiddleWorkspace {...makeProps({ middleTab: 'segment_main', setMiddleTab })} />);

    expect(screen.getByTestId('lazy-whiteboard')).toBeTruthy();
    expect(setMiddleTab).toHaveBeenCalledWith('whiteboard');
  });

  it('有匹配扩展时保持环节工作区，不强制切回白板', () => {
    const setMiddleTab = vi.fn();
    render(
      <LiveClassroomMiddleWorkspace
        {...makeProps({ middleTab: 'segment_main', setMiddleTab, hasSegmentMainExtension: true })}
      />,
    );

    expect(screen.queryByTestId('lazy-whiteboard')).toBeNull();
    expect(setMiddleTab).not.toHaveBeenCalled();
  });
});
