import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import type { StudentType, Lesson } from '../../../types/app';
import { StudentLessonView, type StudentLessonViewProps } from '../StudentLessonView';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import type { FrontendPluginHost } from '../../../plugin-host/plugin-host';

const allProps: StudentLessonViewProps = {
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
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('StudentLessonView', () => {
  it('renders the back-to-dashboard control from StudentLessonHeader', () => {
    render(
      <Suspense fallback={null}>
        <StudentLessonView {...allProps} />
      </Suspense>,
    );
    expect(screen.getByText('Back to Dashboard')).toBeTruthy();
  });

  it('renders the whiteboard classroom instead of the old tab bar', () => {
    render(
      <Suspense fallback={null}>
        <StudentLessonView {...allProps} />
      </Suspense>,
    );
    expect(screen.getByTestId('student-whiteboard-classroom')).toBeTruthy();
    expect(screen.getByTestId('student-learning-topic').textContent).toBe('Math');
    expect(screen.queryByText('Interactive Whiteboard')).toBeNull();
  });

  it('收到「跟随课堂当前环节」时把本地指针对齐到全班环节，且不显示锁定横幅', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('segment-access')) {
          return {
            ok: false,
            json: async () => ({
              allowed: false,
              reason: '请跟随课堂当前环节',
              followedClassSegment: true,
              visibleSegmentId: 'seg-2',
              gates: [],
            }),
          };
        }
        return { ok: false, json: async () => ({}) };
      }),
    );
    const setActiveSegmentId = vi.fn();

    render(
      <Suspense fallback={null}>
        <StudentLessonView
          {...allProps}
          activeSegmentId="seg-1"
          setActiveSegmentId={setActiveSegmentId}
          timelineSegments={[
            { id: 'seg-1', title: '导入', type: 'intro' },
            { id: 'seg-2', title: '讲解', type: 'lecture' },
          ]}
        />
      </Suspense>,
    );

    await waitFor(() => expect(setActiveSegmentId).toHaveBeenCalledWith('seg-2'));
    expect(screen.queryByTestId('segment-gate-lock')).toBeNull();
  });

  it('keeps the native whiteboard canvas when a non-primary student workspace is registered', () => {
    const host = {
      getExtensions: (slot: string) =>
        slot === 'classroom.active_segment.student_main'
          ? [
              {
                id: 'xuean',
                pluginId: 'ext-xuean',
                targetType: 'xuean:task',
                slotProps: {},
                component: () => null,
              },
            ]
          : [],
    } as unknown as FrontendPluginHost;
    render(
      <PluginHostProvider host={host}>
        <StudentLessonView
          {...allProps}
          activeSegmentId="seg-wb"
          timelineSegments={[{ id: 'seg-wb', type: 'whiteboard', title: '板书' }]}
        />
      </PluginHostProvider>,
    );
    expect(screen.getByTestId('student-whiteboard-classroom')).toBeTruthy();
    expect(screen.queryByText('Interactive Whiteboard')).toBeNull();
  });
});
