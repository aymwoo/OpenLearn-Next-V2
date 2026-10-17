import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { StudentLessonContentPanel } from '../StudentLessonContentPanel';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import type { StudentType, Lesson } from '../../../types/app';

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

describe('student.segment.badge extension slot', () => {
  let host: FrontendPluginHost;

  beforeEach(() => {
    vi.restoreAllMocks();
    host = new FrontendPluginHost();
    usePluginHostStore.setState({
      activePlugins: [],
      extensionPoints: new Map(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders student.segment.badge in segment buttons and forwards props', async () => {
    let capturedProps: any = null;

    const MockBadge = (props: any) => {
      capturedProps = props;
      return (
        <span data-testid="student-segment-badge" className="text-[10px] bg-purple-100 text-purple-700 px-1 rounded">
          难度: ⭐⭐⭐
        </span>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('student.segment.badge', {
      id: 'student-difficulty-badge',
      label: '环节难度标识',
      pluginId: 'ext-curriculum-meta',
      component: createLazyComponent(MockBadge),
    });

    const students = [{ id: 'stu_01', name: '李同学', locked_lesson_id: null }] as unknown as StudentType[];
    const lessons = [{ id: 'lesson_101', title: '物理实验', content: '# 实验说明' }] as unknown as Lesson[];
    const segments = [
      { id: 'seg_1', title: '环节 1', duration: '5m', color: 'bg-blue-50 text-blue-700 border-blue-200' },
      { id: 'seg_2', title: '环节 2', duration: '15m', color: 'bg-green-50 text-green-700 border-green-200' },
    ];

    render(
      <PluginHostProvider host={host}>
        <StudentLessonContentPanel
          students={students}
          activeStudentId="stu_01"
          studentFullscreenPanel="none"
          setStudentFullscreenPanel={vi.fn()}
          timelineSegments={segments}
          lang="zh"
          activeSegmentId="seg_1"
          setActiveSegmentId={vi.fn()}
          localProgressPercent={40}
          setLocalProgressPercent={vi.fn()}
          updateStudentProgress={vi.fn()}
          selectedLesson="lesson_101"
          lessons={lessons}
        />
      </PluginHostProvider>,
    );

    await waitFor(() => {
      const badges = screen.getAllByTestId('student-segment-badge');
      expect(badges.length).toBe(2);
    });

    expect(capturedProps).not.toBeNull();
    expect(capturedProps.studentId).toBe('stu_01');
    expect(capturedProps.lessonId).toBe('lesson_101');
    expect(capturedProps.lang).toBe('zh');
    expect(capturedProps.isLocked).toBe(false);
  });

  it('passes isLocked true when active segment is locked by gate', async () => {
    let lockedPropValue: boolean | null = null;

    const MockBadge = (props: any) => {
      if (props.segment.id === 'seg_locked') {
        lockedPropValue = props.isLocked;
      }
      return <span data-testid="gate-badge">锁</span>;
    };

    usePluginHostStore.getState().registerExtensionPoint('student.segment.badge', {
      id: 'student-gate-badge',
      label: '门禁角标',
      pluginId: 'ext-gate',
      component: createLazyComponent(MockBadge),
    });

    const segments = [
      { id: 'seg_locked', title: '门禁环节', duration: '10m', color: 'bg-amber-50 text-amber-700 border-amber-200' },
    ];

    render(
      <PluginHostProvider host={host}>
        <StudentLessonContentPanel
          students={[]}
          activeStudentId="stu_02"
          studentFullscreenPanel="none"
          setStudentFullscreenPanel={vi.fn()}
          timelineSegments={segments}
          lang="zh"
          activeSegmentId="seg_locked"
          setActiveSegmentId={vi.fn()}
          localProgressPercent={0}
          setLocalProgressPercent={vi.fn()}
          updateStudentProgress={vi.fn()}
          selectedLesson="lesson_101"
          lessons={[]}
          segmentAccess={{
            status: 'locked',
            allowed: false,
            gates: [],
            visibleSegmentId: null,
            segmentId: 'seg_locked',
            reason: '前置探究未提交',
          }}
        />
      </PluginHostProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('gate-badge')).toBeTruthy();
    });

    expect(lockedPropValue).toBe(true);
  });
});
