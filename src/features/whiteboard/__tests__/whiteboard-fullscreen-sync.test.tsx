import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

/**
 * 教师端「最大化组件」→ 学生端视图同步 的回归测试。
 *
 * 约定：
 *   - 教师端（LiveClassroomView，broadcastFullscreen）最大化 / 退出最大化时
 *     广播 `whiteboard-update { type: 'fullscreen-change', payload: { elementId } }`；
 *   - 教师端离开白板（切 Tab / 换课节 / 卸载）时广播 elementId: null，
 *     避免学生被永久卡在无法自行退出的全屏里；
 *   - 学生端（followRemoteFullscreen）跟随该视图，且不可在本地关闭。
 */

vi.mock('react-konva', () => {
  const stub = (name: string) =>
    function KonvaStub({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) {
      return (
        <div data-konva={name} {...rest}>
          {children}
        </div>
      );
    };
  return {
    Stage: stub('Stage'),
    Layer: stub('Layer'),
    Group: stub('Group'),
    Rect: stub('Rect'),
    Circle: stub('Circle'),
    Line: stub('Line'),
    Text: stub('Text'),
  };
});

vi.mock('react-konva-utils', () => ({
  Html: ({ children }: React.PropsWithChildren) => <div data-konva="Html">{children}</div>,
}));

vi.mock('reveal.js', () => ({ default: class RevealStub {} }));
vi.mock('reveal.js/reveal.css', () => ({}));
vi.mock('reveal.js/theme/white.css', () => ({}));
vi.mock('reveal.js/plugin/markdown', () => ({ default: {} }));
vi.mock('pptx-preview', () => ({ init: vi.fn() }));

vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => <div data-testid="mock-extension-point" />,
}));

const { fakeSocket } = vi.hoisted(() => ({
  fakeSocket: { id: 'sock-1', emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../../services/socket-service', () => ({
  getSocketInstance: () => fakeSocket,
}));

import { InteractiveWhiteboard } from '../InteractiveWhiteboard';
import { whiteboardViewStore } from '../../../store/whiteboardViewStore';

const QUIZ_ELEMENT = {
  id: 'el-quiz-1',
  type: 'quiz',
  data: JSON.stringify({ question: '1 + 1 = ?', options: ['1', '2'] }),
};

// 板上带「全屏」按钮的元素（assignment 分支）；quiz 在板上不渲染任何内容，
// 只存在全屏渲染器，因此分别用于验证「广播」与「同步视图内容」。
const ASSIGNMENT_ELEMENT = {
  id: 'el-assign-1',
  type: 'assignment',
  data: JSON.stringify({ title: 'HW1', description: 'D1', x: 20, y: 20, width: 400, height: 300 }),
};

const ELEMENTS = [ASSIGNMENT_ELEMENT, QUIZ_ELEMENT];

beforeAll(() => {
  // jsdom 没有 ResizeObserver；且 offsetWidth/offsetHeight 恒为 0，
  // 会导致画布尺寸为 0、元素与全屏遮罩都不渲染。
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1024 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 768 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  whiteboardViewStore.getState().setRemoteFullscreenElementId(null);
});

function renderBoard(props: Record<string, unknown> = {}) {
  const utils = render(
    <InteractiveWhiteboard
      lessonId="l1"
      elements={ELEMENTS}
      onElementAdd={vi.fn(async () => {})}
      onRefresh={vi.fn()}
      {...props}
    />,
  );
  // 让画布拿到非零尺寸（白板通过 window resize 兜底测量）
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  return utils;
}

/** 收集本次渲染期间发出的 teacher-broadcast-fullscreen 事件的 elementId */
const fullscreenEmissions = () =>
  fakeSocket.emit.mock.calls
    .filter(([evt]) => evt === 'teacher-broadcast-fullscreen')
    .map(([, data]) => (data as { elementId: string | null }).elementId);

/** 收集广播的完整载荷 */
const fullscreenPayloads = () =>
  fakeSocket.emit.mock.calls.filter(([evt]) => evt === 'teacher-broadcast-fullscreen').map(([, data]) => data);

describe('教师端最大化 → 学生端同步', () => {
  describe('教师端广播（broadcastFullscreen）', () => {
    it('emits fullscreen-change with the element id when the teacher maximizes', () => {
      renderBoard({ userRole: 'teacher', broadcastFullscreen: true });

      fireEvent.click(screen.getByTitle('全屏'));

      expect(fullscreenEmissions()).toEqual(['el-assign-1']);
    });

    it('carries the lessonId and broadcast class id so class-room delivery works', () => {
      renderBoard({ userRole: 'teacher', broadcastFullscreen: true, fullscreenBroadcastClassId: 'c1' });

      fireEvent.click(screen.getByTitle('全屏'));

      expect(fullscreenPayloads()).toEqual([{ classId: 'c1', lessonId: 'l1', elementId: 'el-assign-1' }]);
    });

    it('emits fullscreen-change null when the teacher closes the fullscreen overlay', () => {
      renderBoard({ userRole: 'teacher', broadcastFullscreen: true });

      fireEvent.click(screen.getByTitle('全屏'));
      fakeSocket.emit.mockClear();

      fireEvent.click(screen.getByText('退出全屏'));

      expect(fullscreenEmissions()).toEqual([null]);
    });

    it('emits fullscreen-change null when the teacher presses ESC to leave fullscreen', () => {
      renderBoard({ userRole: 'teacher', broadcastFullscreen: true });

      fireEvent.click(screen.getByTitle('全屏'));
      fakeSocket.emit.mockClear();

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });

      expect(fullscreenEmissions()).toEqual([null]);
    });

    it('emits fullscreen-change null when the teacher leaves the whiteboard (unmount)', () => {
      const { unmount } = renderBoard({ userRole: 'teacher', broadcastFullscreen: true });
      fakeSocket.emit.mockClear();

      unmount();

      expect(fullscreenEmissions()).toEqual([null]);
    });

    it('does not broadcast when broadcastFullscreen is not enabled (e.g. lesson editor)', () => {
      renderBoard({ userRole: 'teacher' });

      fireEvent.click(screen.getByTitle('全屏'));

      expect(fullscreenEmissions()).toEqual([]);
    });
  });

  describe('学生端跟随（followRemoteFullscreen）', () => {
    it('renders the teacher-fullscreen overlay when the remote element arrives', () => {
      renderBoard({ userRole: 'student', followRemoteFullscreen: true });
      expect(screen.queryByText('1 + 1 = ?')).toBeNull();

      act(() => {
        whiteboardViewStore.getState().setRemoteFullscreenElementId('el-quiz-1');
      });

      expect(screen.getByText('1 + 1 = ?')).toBeTruthy();
    });

    it('does not let the student dismiss the synced overlay', () => {
      renderBoard({ userRole: 'student', followRemoteFullscreen: true });
      act(() => {
        whiteboardViewStore.getState().setRemoteFullscreenElementId('el-quiz-1');
      });

      // 没有退出按钮 / 关闭按钮，只显示「教师同步视图」标识
      expect(screen.queryByText('退出全屏')).toBeNull();
      expect(screen.queryByTitle('关闭 (ESC)')).toBeNull();
      expect(screen.getByText('教师同步视图')).toBeTruthy();
    });

    it('ignores ESC while the synced overlay is shown', () => {
      renderBoard({ userRole: 'student', followRemoteFullscreen: true });
      act(() => {
        whiteboardViewStore.getState().setRemoteFullscreenElementId('el-quiz-1');
      });

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });

      // 仍然停留在教师同步的视图中
      expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBe('el-quiz-1');
      expect(screen.getByText('1 + 1 = ?')).toBeTruthy();
    });

    it('ignores the remote state when followRemoteFullscreen is not enabled', () => {
      renderBoard({ userRole: 'student' });
      act(() => {
        whiteboardViewStore.getState().setRemoteFullscreenElementId('el-quiz-1');
      });

      expect(screen.queryByText('1 + 1 = ?')).toBeNull();
    });

    it('keeps the local maximize dismissible for a non-teacher-synced fullscreen', () => {
      renderBoard({ userRole: 'teacher' });

      fireEvent.click(screen.getByTitle('全屏'));

      expect(screen.getByText('退出全屏')).toBeTruthy();
    });
  });
});
