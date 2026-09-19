import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Suspense } from 'react';
import { StudentLessonInteractionPanel } from '../StudentLessonInteractionPanel';

// 捕获传给白板的 props，用于断言只读跟随模式是否下传
const whiteboardProps: Record<string, unknown>[] = [];
vi.mock('../../../components/LazyWhiteboard', () => ({
  LazyWhiteboard: (props: Record<string, unknown>) => {
    whiteboardProps.push(props);
    return <div data-testid="lazy-whiteboard" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  whiteboardProps.length = 0;
});

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    studentLessonTab: 'whiteboard' as const,
    setStudentLessonTab: vi.fn(),
    isStudentLessonContentCollapsed: false,
    setIsStudentLessonContentCollapsed: vi.fn(),
    lang: 'zh' as const,
    studentFullscreenPanel: 'none' as const,
    setStudentFullscreenPanel: vi.fn(),
    selectedLesson: 'l1',
    elements: [],
    activeRole: 'student' as const,
    activeSegmentId: null,
    setActiveSegmentId: vi.fn(),
    fetchElements: vi.fn(),
    currentVfsParent: null,
    setCurrentVfsParent: vi.fn(),
    vfsNodes: [],
    studentSelectedCourseware: null,
    setStudentSelectedCourseware: vi.fn(),
    activeStudentId: 's1',
    addToast: vi.fn(),
    ...overrides,
  };
}

describe('StudentLessonInteractionPanel', () => {
  it('renders the interactive whiteboard tab label', () => {
    render(
      <Suspense fallback={null}>
        <StudentLessonInteractionPanel {...makeProps()} />
      </Suspense>,
    );
    expect(screen.getByText(/Interactive Whiteboard/)).toBeTruthy();
  });

  it('blocks tab switching and toasts while the class focus is locked', () => {
    const setStudentLessonTab = vi.fn();
    const addToast = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(
      <Suspense fallback={null}>
        <StudentLessonInteractionPanel
          {...(makeProps({ isStudentLocked: true, setStudentLessonTab, addToast }) as any)}
        />
      </Suspense>,
    );

    screen.getByText('Interactive Courseware Viewer').click();
    screen.getByText('作业提交与互评').click();

    expect(setStudentLessonTab).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledTimes(2);
    expect(addToast.mock.calls[0][0]).toContain('全班专注锁定');
  });

  it('allows tab switching when unlocked', () => {
    const setStudentLessonTab = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(
      <Suspense fallback={null}>
        <StudentLessonInteractionPanel {...(makeProps({ setStudentLessonTab }) as any)} />
      </Suspense>,
    );

    screen.getByText('Interactive Courseware Viewer').click();
    expect(setStudentLessonTab).toHaveBeenCalledWith('courseware');
  });

  it('passes readOnly to the whiteboard and refuses whiteboard writes while locked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(
      <Suspense fallback={null}>
        <StudentLessonInteractionPanel {...(makeProps({ isStudentLocked: true }) as any)} />
      </Suspense>,
    );

    expect(whiteboardProps.at(-1)?.readOnly).toBe(true);

    const onElementDelete = whiteboardProps.at(-1)?.onElementDelete as (id: string) => Promise<void>;
    const onClearBoard = whiteboardProps.at(-1)?.onClearBoard as () => Promise<void>;
    await onElementDelete('el-1');
    await onClearBoard();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes readOnly=false to the whiteboard when unlocked', () => {
    render(
      <Suspense fallback={null}>
        <StudentLessonInteractionPanel {...makeProps()} />
      </Suspense>,
    );
    expect(whiteboardProps.at(-1)?.readOnly).toBe(false);
  });
});
