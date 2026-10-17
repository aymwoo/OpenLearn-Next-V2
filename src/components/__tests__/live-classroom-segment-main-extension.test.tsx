import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { LiveClassroomView } from '../LiveClassroomView';
import { AppDataProvider } from '../../context/AppDataContext';
import { appStore } from '../../store/appStore';
import { PluginHostProvider } from '../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';

vi.mock('../LazyWhiteboard', () => ({
  LazyWhiteboard: () => <div data-testid="lazy-whiteboard">Whiteboard</div>,
}));

vi.mock('../TeacherAssignmentGradePanel', () => ({
  TeacherAssignmentGradePanel: () => <div data-testid="grade-panel">GradePanel</div>,
}));

vi.mock('../../features/classroom/PreClassReadyView', () => ({
  PreClassReadyView: () => <div data-testid="pre-class-ready-view" />,
}));

vi.mock('../../features/classroom/ClassroomInteractiveCockpit', () => ({
  ClassroomInteractiveCockpit: () => null,
}));

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

describe('LiveClassroomView - classroom.active_segment.main extension slot', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    usePluginHostStore.setState({
      extensionPoints: new Map(),
      activePlugins: [],
    });
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/classroom/sessions/')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            hasActiveSession: true,
            stage: 'IN_CLASS_TEACHING',
            session: {
              class_id: 'class-g1',
              current_segment_id: 'seg-2',
              started_at: Date.now() - 60000,
            },
          }),
        } as any);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      } as any);
    });

    appStore.setState({
      selectedLesson: 'lesson-101',
      liveClassSelectedClassId: 'class-g1',
      plugins: [{ id: 'prov-physics-lab', name: '物理虚拟实验室', status: 'active' } as any],
    });
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  const baseProps: Record<string, any> = {
    classStudentsMap: {
      'class-g1': [{ id: 's101', name: '张小明', class_id: 'class-g1' }],
    },
    fetchClassStudents: vi.fn().mockResolvedValue(undefined),
    selectedLesson: 'lesson-101',
    setSelectedLesson: vi.fn(),
    lessons: [{ id: 'lesson-101', title: '物理探究实验课' }],
    classes: [{ id: 'class-g1', name: '高一1班' }],
    students: [{ id: 's101', name: '张小明', class_id: 'class-g1' }],
    plugins: [{ id: 'prov-physics-lab', name: '物理虚拟实验室', status: 'active' }],
    lang: 'zh',
    timelineSegments: [
      { id: 'seg-1', title: '导入环节', duration: '5m' },
      { id: 'seg-2', title: '虚拟实验探究', duration: '15m' },
    ],
    activeSegmentId: 'seg-2',
    setActiveSegmentId: vi.fn(),
    liveClassSelectedClassId: 'class-g1',
    setLiveClassSelectedClassId: vi.fn(),
    liveClassIsActive: true,
    setLiveClassIsActive: vi.fn(),
    initialPortalOpen: false,
    liveClassTimeRemaining: 900,
    setLiveClassTimeRemaining: vi.fn(),
    liveClassFeed: [],
    setLiveClassFeed: vi.fn(),
    liveClassAcknowledgedMap: new Map(),
    setLiveClassAcknowledgedMap: vi.fn(),
    elements: [],
    fetchElements: vi.fn().mockResolvedValue(undefined),
    fetchStudents: vi.fn().mockResolvedValue(undefined),
    addToast: vi.fn(),
    onlineStudentIds: ['s101'],
    activeStudentLessons: { s101: 'lesson-101' },
    liveClassStudentProgress: [],
    setTeacherTab: vi.fn(),
    isLeftSidebarCollapsed: false,
    setIsLeftSidebarCollapsed: vi.fn(),
    isRightSidebarCollapsed: false,
    setIsRightSidebarCollapsed: vi.fn(),
  };

  it('does not render segment_main tab button when no extension is registered', async () => {
    const host = new FrontendPluginHost();
    render(
      <PluginHostProvider host={host}>
        <AppDataProvider value={baseProps as any}>
          <LiveClassroomView initialPortalOpen={false} />
        </AppDataProvider>
      </PluginHostProvider>,
    );

    // 等待授课主视图挂载
    await waitFor(() => {
      expect(screen.getByTestId('lazy-whiteboard')).toBeTruthy();
    });

    expect(screen.queryByTestId('teacher-active-segment-main-tab-btn')).toBeNull();
    expect(screen.queryByTestId('classroom-active-segment-main-hint')).toBeNull();
  });

  it('renders tab button, hint banner, and segment main workspace when extension is registered', async () => {
    let capturedProps: any = null;

    const MockVirtualLabWorkspace: React.FC<any> = (props) => {
      capturedProps = props;
      return (
        <div data-testid="mock-virtual-lab-workspace">
          <h3>虚拟实验台：{props.segment?.title}</h3>
          <p>Lesson: {props.lessonId}</p>
        </div>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('classroom.active_segment.main', {
      id: 'physics-lab-main',
      label: '物理虚拟实验主工作区',
      pluginId: 'prov-physics-lab',
      component: createLazyComponent(MockVirtualLabWorkspace),
    });

    const host = new FrontendPluginHost();

    render(
      <PluginHostProvider host={host}>
        <AppDataProvider value={baseProps as any}>
          <LiveClassroomView initialPortalOpen={false} />
        </AppDataProvider>
      </PluginHostProvider>,
    );

    // 1. Tab button should appear
    await waitFor(() => {
      expect(screen.getByTestId('teacher-active-segment-main-tab-btn')).toBeTruthy();
    });

    // 2. Hint banner on top of whiteboard should appear
    expect(screen.getByTestId('classroom-active-segment-main-hint')).toBeTruthy();

    // 3. Click tab button to switch to segment_main workspace
    const tabBtn = screen.getByTestId('teacher-active-segment-main-tab-btn');
    fireEvent.click(tabBtn);

    // 4. Extension component rendered
    await waitFor(() => {
      expect(screen.getByTestId('mock-virtual-lab-workspace')).toBeTruthy();
    });

    expect(screen.getByText('虚拟实验台：虚拟实验探究')).toBeTruthy();
    expect(capturedProps).not.toBeNull();
    expect(capturedProps.segment?.id).toBe('seg-2');
    expect(capturedProps.lessonId).toBe('lesson-101');
    expect(capturedProps.classId).toBe('class-g1');
    expect(capturedProps.lang).toBe('zh');
  });
});
