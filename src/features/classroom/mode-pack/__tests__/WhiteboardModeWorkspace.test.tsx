import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WhiteboardModeWorkspace } from '../WhiteboardModeWorkspace';
import { WhiteboardHostBridgeProvider } from '../whiteboardHostBridge';
import { setModePacksEnabledForTests } from '../flags';

vi.mock('../../../../components/LazyWhiteboard', () => ({
  LazyWhiteboard: (props: Record<string, unknown>) => (
    <div
      data-testid="lazy-whiteboard"
      data-lesson-id={String(props.lessonId ?? '')}
      data-role={String(props.userRole ?? '')}
      data-broadcast={String(Boolean(props.broadcastFullscreen))}
      data-active-segment={String(props.activeSegmentId ?? '')}
    />
  ),
}));

const flow = {
  snapshot: {
    lessonId: 'les-1',
    classId: 'cls-1',
    stage: 'IN_CLASS_TEACHING',
    activeSegmentId: 'seg-1',
    segments: [],
    students: [],
    onlineStudentIds: [],
    attempts: [],
  },
  setActiveSegment: async () => undefined,
  advanceStage: async () => undefined,
  sendMessage: async () => ({ ok: true }),
};

afterEach(() => {
  cleanup();
  setModePacksEnabledForTests(null);
});

describe('WhiteboardModeWorkspace', () => {
  it('无画布桥时展示 missing 占位，不挂 LazyWhiteboard', () => {
    render(
      <WhiteboardModeWorkspace
        segment={{ id: 'seg-1', type: 'whiteboard', title: '导入' }}
        lessonId="les-1"
        classId="cls-1"
        flow={flow as never}
      />,
    );
    expect(screen.getByTestId('mode-whiteboard-workspace').getAttribute('data-bridge')).toBe('missing');
    expect(screen.queryByTestId('lazy-whiteboard')).toBeNull();
  });

  it('有画布桥时挂载 LazyWhiteboard 并透传全屏/环节契约', () => {
    render(
      <WhiteboardHostBridgeProvider
        value={{
          canvasProps: {
            lessonId: 'les-1',
            elements: [],
            onElementAdd: async () => {},
            userRole: 'teacher',
            broadcastFullscreen: true,
            activeSegmentId: 'seg-1',
          },
        }}
      >
        <WhiteboardModeWorkspace
          segment={{ id: 'seg-1', type: 'whiteboard', title: '导入' }}
          lessonId="les-1"
          classId="cls-1"
          flow={flow as never}
        />
      </WhiteboardHostBridgeProvider>,
    );
    const root = screen.getByTestId('mode-whiteboard-workspace');
    expect(root.getAttribute('data-bridge')).toBe('ready');
    const board = screen.getByTestId('lazy-whiteboard');
    expect(board.getAttribute('data-lesson-id')).toBe('les-1');
    expect(board.getAttribute('data-role')).toBe('teacher');
    expect(board.getAttribute('data-broadcast')).toBe('true');
    expect(board.getAttribute('data-active-segment')).toBe('seg-1');
  });
});
