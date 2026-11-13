import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, renderHook, act } from '@testing-library/react';

/**
 * 回归：进入互动白板后演示文稿组件「反复消失又出现」。
 *
 * 白板在课堂里会因 socket 同步 / 分页状态变化反复重渲染，而演示文稿的
 * `onElementUpdate` 曾被写成内联箭头函数。组件内 `handlePptxActiveSlideChange`
 * 把它放进 `useCallback` 依赖 → 回调身份每次渲染都变 → pptx-react-viewer 的
 * 回调 effect 反复重注册并回报页码 → 写回触发 `fetchElements` → 再重渲染。
 *
 * Issue #381 修掉了 `slideIndex` 那一半，但它的回归用例传的是稳定 mock，
 * 抓不到真实白板里 `onElementUpdate` 身份每次都变的情况。这里用「每次
 * rerender 都换一个新函数」复现课堂里的父级重渲染，锁住回调身份恒定。
 */
const trace = vi.hoisted(() => ({ mounts: 0, callbackEffectRuns: 0 }));

type FakeViewerProps = {
  initialSlide?: number;
  onActiveSlideChange?: (index: number) => void;
  onSlideCountChange?: (count: number) => void;
};

vi.mock('pptx-react-viewer', () => {
  const FakeViewer = React.forwardRef<unknown, FakeViewerProps>((props, ref) => {
    const { initialSlide, onActiveSlideChange } = props;
    const [idx, setIdx] = React.useState(initialSlide ?? 0);
    const idxRef = React.useRef(idx);
    idxRef.current = idx;

    React.useImperativeHandle(
      ref,
      () => ({
        getActiveSlideIndex: () => idxRef.current,
        setActiveSlideIndex: (next: number) => {
          idxRef.current = next;
          setIdx(next);
        },
      }),
      [],
    );

    // 组件挂载次数：父级若把 viewer 卸载重建，这里会大于 1。
    React.useEffect(() => {
      trace.mounts += 1;
    }, []);

    // 与真实 viewer 语义一致：回调身份变化时重新回报当前页。
    React.useEffect(() => {
      trace.callbackEffectRuns += 1;
      onActiveSlideChange?.(idx);
    }, [idx, onActiveSlideChange]);

    return <div data-testid="fake-viewer">viewer-slide-{idx}</div>;
  });
  return { PowerPointViewer: FakeViewer };
});

vi.mock('pptx-react-viewer/i18n', () => ({
  translationsEn: {},
  keyToLabel: (key: string) => key,
}));
vi.mock('pptx-react-viewer/styles', () => ({}));

import { RevealPresentationWrapper } from '../widgets/RevealPresentationWrapper';
import { useWhiteboardPages } from '../hooks/useWhiteboardPages';

const PPTX_DATA = {
  fileUrl: '/uploads/deck.pptx',
  fileType: 'pptx',
  slideCount: 5,
  slideX: 0,
};

describe('演示文稿挂载稳定性（进入互动白板闪动回归）', () => {
  beforeEach(() => {
    trace.mounts = 0;
    trace.callbackEffectRuns = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(32)),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('父级反复重渲染（每次新建 onElementUpdate / data）时 viewer 回调身份保持恒定', async () => {
    const { rerender } = render(
      <RevealPresentationWrapper
        elementId="pres-mount"
        data={PPTX_DATA}
        userRole="teacher"
        onElementUpdate={async () => {}}
      />,
    );

    // 等 PPTX 字节到达、viewer 真正挂载
    await vi.waitFor(() => expect(trace.mounts).toBe(1));
    const runsAfterMount = trace.callbackEffectRuns;

    for (let i = 0; i < 5; i += 1) {
      rerender(
        <RevealPresentationWrapper
          elementId="pres-mount"
          data={{ ...PPTX_DATA }}
          userRole="teacher"
          onElementUpdate={async () => {}}
        />,
      );
    }

    expect(trace.mounts, 'viewer 不应被反复卸载重挂载').toBe(1);
    expect(trace.callbackEffectRuns, 'onActiveSlideChange 身份不应随父级重渲染变化').toBe(runsAfterMount);
  });

  it('pages 内容不变（仅引用变化）时不上报重复的分页状态', () => {
    const onPagesStateChange = vi.fn();
    const options = {
      elements: [],
      safeElements: [],
      initialPage: 0,
      activeSegmentId: null,
      lessonId: 'lesson-1',
      userRole: 'teacher' as const,
      socketRef: { current: null },
      onPagesStateChange,
      setDialog: () => {},
    };

    const { result } = renderHook(() => useWhiteboardPages(options));
    const initialCalls = onPagesStateChange.mock.calls.length;
    expect(initialCalls).toBe(1);

    act(() => {
      // socket 的 page-meta-update 广播每次都带新数组；内容相同不该掀起一轮重渲染。
      result.current.setPages([...result.current.pages]);
    });

    expect(onPagesStateChange).toHaveBeenCalledTimes(initialCalls);
  });
});
