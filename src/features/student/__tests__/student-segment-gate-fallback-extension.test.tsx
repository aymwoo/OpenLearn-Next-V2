import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { StudentLessonInteractionPanel } from '../StudentLessonInteractionPanel';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';

vi.mock('../../../components/LazyWhiteboard', () => ({
  LazyWhiteboard: () => <div data-testid="lazy-whiteboard" />,
}));

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    studentLessonTab: 'whiteboard' as const,
    setStudentLessonTab: vi.fn(),
    isStudentLessonContentCollapsed: false,
    setIsStudentLessonContentCollapsed: vi.fn(),
    lang: 'zh' as const,
    studentFullscreenPanel: 'none' as const,
    setStudentFullscreenPanel: vi.fn(),
    selectedLesson: 'lesson_test_101',
    elements: [],
    activeRole: 'student' as const,
    activeSegmentId: 'seg_quiz_2',
    setActiveSegmentId: vi.fn(),
    fetchElements: vi.fn(),
    currentVfsParent: null,
    setCurrentVfsParent: vi.fn(),
    vfsNodes: [],
    studentSelectedCourseware: null,
    setStudentSelectedCourseware: vi.fn(),
    activeStudentId: 'student_zhang',
    addToast: vi.fn(),
    ...overrides,
  };
}

describe('student.segment.gate_fallback extension slot', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    usePluginHostStore.setState({
      extensionPoints: new Map(),
      activePlugins: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders student.segment.gate_fallback when blockSegmentContent is true', async () => {
    let capturedProps: any = null;

    const PrerequisiteQuizPlugin = (props: any) => {
      capturedProps = props;
      return (
        <div data-testid="prerequisite-quiz-plugin">
          <p>请先完成前置练习题以解锁此环节</p>
          <button data-testid="start-quiz-btn">开始解锁测试</button>
        </div>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('student.segment.gate_fallback', {
      id: 'prereq-quiz-gate',
      label: '前置测评解锁引导',
      pluginId: 'ext-gate-unlocker',
      component: createLazyComponent(PrerequisiteQuizPlugin),
    });

    const host = new FrontendPluginHost();

    render(
      <PluginHostProvider host={host}>
        <Suspense fallback={null}>
          <StudentLessonInteractionPanel
            {...(makeProps({
              blockSegmentContent: true,
              contentSegmentId: 'seg_intro_1',
            }) as any)}
          />
        </Suspense>
      </PluginHostProvider>,
    );

    // Gate lock heading should be visible
    expect(screen.getByText('本教学环节尚未解锁')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId('prerequisite-quiz-plugin')).toBeTruthy();
    });

    expect(capturedProps).not.toBeNull();
    expect(capturedProps.lessonId).toBe('lesson_test_101');
    expect(capturedProps.activeSegmentId).toBe('seg_quiz_2');
    expect(capturedProps.studentId).toBe('student_zhang');
    expect(capturedProps.contentSegmentId).toBe('seg_intro_1');
    expect(capturedProps.lang).toBe('zh');
  });

  it('does not render student.segment.gate_fallback when blockSegmentContent is false', () => {
    render(
      <Suspense fallback={null}>
        <StudentLessonInteractionPanel
          {...(makeProps({ blockSegmentContent: false }) as any)}
        />
      </Suspense>,
    );

    expect(screen.queryByText('本教学环节尚未解锁')).toBeNull();
    expect(screen.getByTestId('lazy-whiteboard')).toBeTruthy();
  });
});
