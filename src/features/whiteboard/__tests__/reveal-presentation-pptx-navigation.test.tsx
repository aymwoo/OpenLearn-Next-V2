import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

/**
 * 回归：Issue #381 —— PPTX 演示文稿点击「下一页」在相邻两页之间无限闪动。
 *
 * 真凶是包装组件 `handlePptxActiveSlideChange` 依赖 `slideIndex`，而
 * `pptx-react-viewer@4.33.1` 的回调 effect 依赖 `onActiveSlideChange`：
 * 翻页 -> 回调身份变化 -> viewer 回报旧页码 -> 包装组件被拽回上一页 ->
 * 再把 viewer 推回下一页……形成死循环。
 *
 * 这里用与查看器语义一致的 mock 锁住契约：
 *   1. `initialSlide` 只在首次加载生效；
 *   2. `activeSlideIndex` 或 `onActiveSlideChange` 身份变化时回报当前页。
 */
const viewerTrace = vi.hoisted(() => ({ callbacks: [] as number[] }));

/** 与 `pptx-react-viewer` 交互所需的最小 props 形状（只取本用例用到的字段） */
type FakeViewerProps = {
  initialSlide?: number;
  onActiveSlideChange?: (index: number) => void;
};

/** `onElementUpdate` 的回写载荷形状：本用例只关心 `slideX` */
type UpdatedElementData = { slideX?: number };

type ElementUpdateHandler = (id: string, data: UpdatedElementData) => Promise<void>;

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

    React.useEffect(() => {
      viewerTrace.callbacks.push(idx);
      // 回归时 effect 会无限循环；这里主动截断，避免把 CI 卡死成超时。
      if (viewerTrace.callbacks.length > 50) {
        throw new Error('onActiveSlideChange 出现循环调用');
      }
      onActiveSlideChange?.(idx);
    }, [idx, onActiveSlideChange]);

    return (
      <div>
        <span data-testid="fake-viewer">viewer-slide-{idx}</span>
        {/* 模拟 viewer 内部换页（缩略图 / 键盘），用于验证回写方向仍然有效 */}
        <button data-testid="fake-viewer-goto-3" onClick={() => setIdx(3)}>
          goto 3
        </button>
      </div>
    );
  });
  return { PowerPointViewer: FakeViewer };
});

vi.mock('pptx-react-viewer/i18n', () => ({
  translationsEn: {},
  keyToLabel: (key: string) => key,
}));
vi.mock('pptx-react-viewer/styles', () => ({}));

import { RevealPresentationWrapper } from '../widgets/RevealPresentationWrapper';

function renderPptx(onElementUpdate: ElementUpdateHandler) {
  return render(
    <RevealPresentationWrapper
      elementId="pres-pptx-nav"
      data={{ fileUrl: '/uploads/deck.pptx', fileType: 'pptx', slideCount: 5, slideX: 0 }}
      userRole="teacher"
      onElementUpdate={onElementUpdate}
    />,
  );
}

describe('RevealPresentationWrapper PPTX 翻页（Issue #381）', () => {
  beforeEach(() => {
    viewerTrace.callbacks.length = 0;
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
    vi.restoreAllMocks();
  });

  it('点击下一页后稳定停留在下一页，不会来回闪动', async () => {
    const slideXUpdates: number[] = [];
    const onElementUpdate = vi.fn(async (_id: string, d: UpdatedElementData) => {
      slideXUpdates.push(d.slideX as number);
    });

    renderPptx(onElementUpdate);
    await waitFor(() => expect(screen.getByTestId('fake-viewer')).toBeTruthy());
    expect(screen.getByTestId('fake-viewer').textContent).toBe('viewer-slide-0');

    const nextButton = screen.getAllByRole('button').find((button) => button.querySelector('svg.lucide-chevron-right'));
    expect(nextButton).toBeTruthy();

    fireEvent.click(nextButton!);

    await waitFor(() => expect(screen.getByTestId('fake-viewer').textContent).toBe('viewer-slide-1'));

    // 只应写一次目标页；回归时会出现 1,0,1,0… 的来回回写。
    expect(slideXUpdates).toEqual([1]);
    // 回调序列只允许从 0 前进到 1，之后不应再被旧页码拉回。
    expect(viewerTrace.callbacks).toEqual([0, 1]);
  });

  it('viewer 内部真实换页（缩略图/键盘）仍会回写父级', async () => {
    const slideXUpdates: number[] = [];
    const onElementUpdate = vi.fn(async (_id: string, d: UpdatedElementData) => {
      slideXUpdates.push(d.slideX as number);
    });

    renderPptx(onElementUpdate);
    await waitFor(() => expect(screen.getByTestId('fake-viewer')).toBeTruthy());

    fireEvent.click(screen.getByTestId('fake-viewer-goto-3'));

    await waitFor(() => expect(screen.getByTestId('fake-viewer').textContent).toBe('viewer-slide-3'));
    expect(slideXUpdates).toEqual([3]);
  });
});
