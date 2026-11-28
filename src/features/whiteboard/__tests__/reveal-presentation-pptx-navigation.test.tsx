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
const viewerTrace = vi.hoisted(() => ({
  callbacks: [] as number[],
  /** 最近一次挂载的 FakeViewer props：供用例模拟 viewer 晚到的 slideCount 回报 */
  lastProps: null as (FakeViewerProps & { onSlideCountChange?: (count: number) => void }) | null,
  /** IKYMW8 时序模拟：新挂载实例无视 initialSlide，从解析起始页 0 开始 */
  noiseMount: false,
}));

/** 与 `pptx-react-viewer` 交互所需的最小 props 形状（只取本用例用到的字段） */
type FakeViewerProps = {
  initialSlide?: number;
  onActiveSlideChange?: (index: number) => void;
  onSlideCountChange?: (count: number) => void;
};

/** `onElementUpdate` 的回写载荷形状：本用例只关心 `slideX` */
type UpdatedElementData = { slideX?: number };

type ElementUpdateHandler = (id: string, data: UpdatedElementData) => Promise<void>;

vi.mock('pptx-react-viewer', () => {
  const FakeViewer = React.forwardRef<unknown, FakeViewerProps>((props, ref) => {
    const { initialSlide, onActiveSlideChange } = props;
    // IKYMW8：noiseMount 模拟真实 viewer 解析期行为 —— initialSlide 未生效，先停在起始页
    const [idx, setIdx] = React.useState(viewerTrace.noiseMount ? 0 : (initialSlide ?? 0));
    const idxRef = React.useRef(idx);
    idxRef.current = idx;
    viewerTrace.lastProps = props as FakeViewerProps & { onSlideCountChange?: (count: number) => void };

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
      // 与真实 viewer 对齐：解析完成先回报 slideCount，再回报当前页。
      props.onSlideCountChange?.(5);
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

/**
 * 回归：Issue IKYMW8 —— 教师进入 PPTX 放映时学生端翻页不同步。
 *
 * 根因：包装组件的元素更新是「整包展开渲染快照」的写法。教师进放映时全屏
 * PowerPointViewer 实例重挂载并异步回报真实页数，`onSlideCountChange` 的
 * 整包写把渲染快照里**过期的** slideX / isFullscreenForced 一起回写到服务端
 * （实测在放映写后 8ms 覆盖），学生端因此永远进不了同步放映、页码被拽回旧页。
 *
 * 修复：包装组件全部改为**增量写**（服务端顶层浅合并落库）。本组用例锁定
 * 每条写路径的载荷都必须是纯增量 —— 不携带任何未变化的字段。
 */
describe('RevealPresentationWrapper 增量写契约（Issue IKYMW8）', () => {
  beforeEach(() => {
    viewerTrace.callbacks.length = 0;
    viewerTrace.lastProps = null;
    viewerTrace.noiseMount = false;
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

  it('翻页写入只携带 slideX，不携带任何过期快照字段', async () => {
    const payloads: Record<string, unknown>[] = [];
    const onElementUpdate = vi.fn(async (_id: string, d: Record<string, unknown>) => {
      payloads.push(d);
    });

    render(
      <RevealPresentationWrapper
        elementId="pres-delta"
        data={{ fileUrl: '/uploads/deck.pptx', fileType: 'pptx', slideCount: 5, slideX: 1, isFullscreenSynced: true }}
        userRole="teacher"
        onElementUpdate={onElementUpdate}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('fake-viewer')).toBeTruthy());

    const nextButton = screen.getAllByRole('button').find((button) => button.querySelector('svg.lucide-chevron-right'));
    fireEvent.click(nextButton!);

    await waitFor(() => expect(payloads.length).toBeGreaterThan(0));
    expect(payloads).toEqual([{ slideX: 2 }]);
  });

  it('进放映后再回报 slideCount，三段写入互不覆盖（放映时序回归）', async () => {
    const payloads: Record<string, unknown>[] = [];
    const onElementUpdate = vi.fn(async (_id: string, d: Record<string, unknown>) => {
      payloads.push(d);
    });

    render(
      <RevealPresentationWrapper
        elementId="pres-delta-fs"
        data={{ fileUrl: '/uploads/deck.pptx', fileType: 'pptx', slideCount: 5, slideX: 1, isFullscreenSynced: true }}
        userRole="teacher"
        onElementUpdate={onElementUpdate}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('fake-viewer')).toBeTruthy());

    // 1. 教师翻到第 3 页
    const nextButton = screen.getAllByRole('button').find((button) => button.querySelector('svg.lucide-chevron-right'));
    fireEvent.click(nextButton!);
    await waitFor(() => expect(payloads).toEqual([{ slideX: 2 }]));

    // 2. 教师进入全屏放映
    const fsButton = screen.getAllByRole('button').find((button) => button.getAttribute('title') === '全屏放映');
    expect(fsButton).toBeTruthy();
    fireEvent.click(fsButton!);
    await waitFor(() => expect(payloads).toEqual([{ slideX: 2 }, { isFullscreenForced: true }]));

    // 3. 全屏 viewer 重挂载后异步回报页数（与服务端持久值不一致，真实课堂里
    //    旧版 /api/upload 对 PPTX 硬编码 1，任何一次重解析都可能产生差异）
    await waitFor(() => expect(viewerTrace.lastProps).toBeTruthy());
    viewerTrace.lastProps!.onSlideCountChange?.(6);

    // 关键断言：晚到的 slideCount 写是纯增量，不再把 slideX / isFullscreenForced 拽回旧值
    await waitFor(() => expect(payloads).toEqual([{ slideX: 2 }, { isFullscreenForced: true }, { slideCount: 6 }]));
  });

  it('进放映时新挂载 viewer 回报解析起始页（0）不产生元素写（IKYMW8 时序回归）', async () => {
    const payloads: Record<string, unknown>[] = [];
    const onElementUpdate = vi.fn(async (_id: string, d: Record<string, unknown>) => {
      payloads.push(d);
    });

    render(
      <RevealPresentationWrapper
        elementId="pres-fs-noise"
        data={{ fileUrl: '/uploads/deck.pptx', fileType: 'pptx', slideCount: 5, slideX: 1, isFullscreenSynced: true }}
        userRole="teacher"
        onElementUpdate={onElementUpdate}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('fake-viewer')).toBeTruthy());

    // 1. 教师翻到第 3 页
    const nextButton = screen.getAllByRole('button').find((button) => button.querySelector('svg.lucide-chevron-right'));
    fireEvent.click(nextButton!);
    await waitFor(() => expect(payloads).toEqual([{ slideX: 2 }]));

    // 2. 新挂载的放映实例解析期先停在起始页（真实 viewer：initialSlide 未生效）
    viewerTrace.noiseMount = true;
    const fsButton = screen.getAllByRole('button').find((button) => button.getAttribute('title') === '全屏放映');
    fireEvent.click(fsButton!);
    await waitFor(() => expect(payloads).toEqual([{ slideX: 2 }, { isFullscreenForced: true }]));

    // 3. 护栏重推目标页后，放映实例被同步到第 3 页
    await waitFor(() => expect(screen.getByTestId('fake-viewer').textContent).toBe('viewer-slide-2'));

    // 关键断言：解析期页码回报被护栏拦截，没有产生任何 slideX=0 的元素写
    expect(payloads).toEqual([{ slideX: 2 }, { isFullscreenForced: true }]);
  });
});
