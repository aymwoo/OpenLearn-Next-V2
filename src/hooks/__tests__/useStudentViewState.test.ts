/**
 * 学生端课节视图的状态机（Issue IKVSIN 相关）。
 *
 * 关注点：`studentFullscreenPanel` 与 `isStudentLessonContentCollapsed` 这两个
 * 「课节布局」状态必须**一起**复位。否则会留下
 * `fullscreen='left' + collapsed=true` 的组合 —— 两个栏同时不可见，
 * 学生回到课节只看到空白页，且「退出全屏」按钮也随之消失。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStudentViewState } from '../useStudentViewState';

/** useStudentViewState 的入参（deps）类型。 */
type HookArgs = Parameters<typeof useStudentViewState>[0];

afterEach(() => {
  vi.restoreAllMocks();
});

function makeArgs(): HookArgs {
  return {
    activeStudentId: 's1',
    activeRole: 'student' as const,
    students: [{ id: 's1', locked_lesson_id: null, lock_mode: null, lock_target: null }],
    liveClassFocusLocked: false,
    setIsFollowingTeacher: vi.fn(),
    lang: 'zh' as const,
    addToast: vi.fn(),
  };
}

describe('useStudentViewState：课节布局状态复位', () => {
  it('离开课节视图时，同时复位折叠态与全屏态', () => {
    const { result } = renderHook((props: HookArgs) => useStudentViewState(props), {
      initialProps: makeArgs(),
    });

    // 进入课节视图，并把左栏设为全屏
    act(() => {
      result.current.setStudentViewStatus('lesson');
    });
    act(() => {
      result.current.setStudentFullscreenPanel('left');
    });
    act(() => {
      result.current.setIsStudentLessonContentCollapsed(false);
    });

    expect(result.current.studentFullscreenPanel).toBe('left');
    expect(result.current.isStudentLessonContentCollapsed).toBe(false);

    // 离开课节视图（回看板）
    act(() => {
      result.current.setStudentViewStatus('dashboard');
    });

    expect(result.current.isStudentLessonContentCollapsed).toBe(true);
    expect(result.current.studentFullscreenPanel).toBe('none');
  });

  it('离开课节视图时复位右栏全屏态', () => {
    const { result } = renderHook((props: HookArgs) => useStudentViewState(props), {
      initialProps: makeArgs(),
    });

    act(() => {
      result.current.setStudentViewStatus('lesson');
    });
    act(() => {
      result.current.setStudentFullscreenPanel('right');
    });
    expect(result.current.studentFullscreenPanel).toBe('right');

    act(() => {
      result.current.setStudentViewStatus('dashboard');
    });
    expect(result.current.studentFullscreenPanel).toBe('none');
  });

  it('在课节视图内切换全屏态不会被复位', () => {
    const { result } = renderHook((props: HookArgs) => useStudentViewState(props), {
      initialProps: makeArgs(),
    });

    act(() => {
      result.current.setStudentViewStatus('lesson');
    });
    act(() => {
      result.current.setStudentFullscreenPanel('right');
    });

    // 仍在课节视图 → 保持不变
    expect(result.current.studentFullscreenPanel).toBe('right');
  });
});
