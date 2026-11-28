import { describe, expect, it } from 'vitest';
import {
  resolveCanvasReadOnlyPolicy,
  resolveDeferredInitialPage,
  resolveFullscreenReadOnlyPolicy,
  resolveFullscreenView,
  resolveInitialPageIndex,
  resolveSegmentFollow,
  type FullscreenResolutionInput,
} from '../view-model';
import type { WhiteboardPageItem } from '../../utils/pagination-utils';

const pages: WhiteboardPageItem[] = [
  { id: 'p0', title: 'P1', order: 0 },
  { id: 'p1', title: 'P2', order: 1, segmentId: 'seg-a' },
  { id: 'p2', title: 'P3', order: 2, segmentId: 'seg-b' },
  { id: 'p3', title: 'P4', order: 3, segmentId: 'seg-b' },
];

// ── 全屏优先级矩阵 ────────────────────────────────────────────────────────

describe('resolveFullscreenView：全屏优先级矩阵', () => {
  const cases: Array<{
    name: string;
    input: FullscreenResolutionInput;
    expected: {
      surface: 'board' | 'browser' | null;
      boardId: string | null;
      boardRemote: boolean;
      browserId: string | null;
      browserRemote: boolean;
      nativeBrowser: boolean;
    };
  }> = [
    {
      name: '全部为空 → 无全屏',
      input: {},
      expected: {
        surface: null,
        boardId: null,
        boardRemote: false,
        browserId: null,
        browserRemote: false,
        nativeBrowser: true,
      },
    },
    {
      name: '仅本地白板最大化',
      input: { localBoardElementId: 'b1' },
      expected: {
        surface: 'board',
        boardId: 'b1',
        boardRemote: false,
        browserId: null,
        browserRemote: false,
        nativeBrowser: true,
      },
    },
    {
      name: '仅本地白板最大化 + 跟随开关开启（无远程 id）',
      input: { followRemoteFullscreen: true, localBoardElementId: 'b1' },
      expected: {
        surface: 'board',
        boardId: 'b1',
        boardRemote: false,
        browserId: null,
        browserRemote: false,
        nativeBrowser: true,
      },
    },
    {
      name: '远程白板 + 跟随 → 远程压过本地',
      input: { followRemoteFullscreen: true, remoteBoardElementId: 'r1', localBoardElementId: 'b1' },
      expected: {
        surface: 'board',
        boardId: 'r1',
        boardRemote: true,
        browserId: null,
        browserRemote: false,
        nativeBrowser: true,
      },
    },
    {
      name: '远程白板 + 不跟随 → 忽略远程，本地生效',
      input: { followRemoteFullscreen: false, remoteBoardElementId: 'r1', localBoardElementId: 'b1' },
      expected: {
        surface: 'board',
        boardId: 'b1',
        boardRemote: false,
        browserId: null,
        browserRemote: false,
        nativeBrowser: true,
      },
    },
    {
      name: '远程白板 + 不跟随 + 无本地 → 无全屏',
      input: { followRemoteFullscreen: false, remoteBoardElementId: 'r1' },
      expected: {
        surface: null,
        boardId: null,
        boardRemote: false,
        browserId: null,
        browserRemote: false,
        nativeBrowser: true,
      },
    },
    {
      name: '仅本地浏览器全屏',
      input: { localBrowserElementId: 'l1' },
      expected: {
        surface: 'browser',
        boardId: null,
        boardRemote: false,
        browserId: 'l1',
        browserRemote: false,
        nativeBrowser: true,
      },
    },
    {
      name: '远程浏览器 + 跟随 → 不可本地退出、不发起原生全屏',
      input: { followRemoteFullscreen: true, remoteBrowserElementId: 'r1' },
      expected: {
        surface: 'browser',
        boardId: null,
        boardRemote: false,
        browserId: 'r1',
        browserRemote: true,
        nativeBrowser: false,
      },
    },
    {
      name: '远程浏览器 + 本地浏览器 + 跟随 → 远程压过本地',
      input: { followRemoteFullscreen: true, remoteBrowserElementId: 'r1', localBrowserElementId: 'l1' },
      expected: {
        surface: 'browser',
        boardId: null,
        boardRemote: false,
        browserId: 'r1',
        browserRemote: true,
        nativeBrowser: false,
      },
    },
    {
      name: '浏览器全屏压过白板全屏（远程白板 + 本地浏览器）',
      input: { followRemoteFullscreen: true, remoteBoardElementId: 'r1', localBrowserElementId: 'l1' },
      expected: {
        surface: 'browser',
        boardId: 'r1',
        boardRemote: true,
        browserId: 'l1',
        browserRemote: false,
        nativeBrowser: true,
      },
    },
    {
      name: '浏览器全屏压过白板全屏（远程浏览器 + 本地白板）',
      input: { followRemoteFullscreen: true, remoteBrowserElementId: 'r1', localBoardElementId: 'b1' },
      expected: {
        surface: 'browser',
        boardId: 'b1',
        boardRemote: false,
        browserId: 'r1',
        browserRemote: true,
        nativeBrowser: false,
      },
    },
    {
      name: '本地白板 + 本地浏览器 → 浏览器优先',
      input: { localBoardElementId: 'b1', localBrowserElementId: 'l1' },
      expected: {
        surface: 'browser',
        boardId: 'b1',
        boardRemote: false,
        browserId: 'l1',
        browserRemote: false,
        nativeBrowser: true,
      },
    },
    {
      name: '空字符串 id 视为未指定',
      input: {
        followRemoteFullscreen: true,
        remoteBoardElementId: '',
        localBoardElementId: '',
        remoteBrowserElementId: '',
        localBrowserElementId: '',
      },
      expected: {
        surface: null,
        boardId: null,
        boardRemote: false,
        browserId: null,
        browserRemote: false,
        nativeBrowser: true,
      },
    },
  ];

  it.each(cases)('$name', ({ input, expected }) => {
    const view = resolveFullscreenView(input);

    expect(view.surface).toBe(expected.surface);
    expect(view.active).toBe(expected.surface !== null);
    expect(view.board.elementId).toBe(expected.boardId);
    expect(view.board.isRemote).toBe(expected.boardRemote);
    expect(view.board.dismissible).toBe(!expected.boardRemote);
    expect(view.browser.elementId).toBe(expected.browserId);
    expect(view.browser.isRemote).toBe(expected.browserRemote);
    expect(view.browser.dismissible).toBe(!expected.browserRemote);
    expect(view.nativeBrowserFullscreenEnabled).toBe(expected.nativeBrowser);
  });
});

// ── 首帧页与异步恢复页 ────────────────────────────────────────────────────

describe('resolveInitialPageIndex：首帧页优先级', () => {
  const cases: Array<{
    name: string;
    initialPage: number | null | undefined;
    activeSegmentId: string | null | undefined;
    expected: number;
  }> = [
    { name: '显式恢复页优先于环节首页', initialPage: 1, activeSegmentId: 'seg-b', expected: 1 },
    { name: '显式第 0 页也生效', initialPage: 0, activeSegmentId: 'seg-b', expected: 0 },
    { name: '未指定恢复页时取环节首页', initialPage: undefined, activeSegmentId: 'seg-b', expected: 2 },
    { name: '环节没有专属页时回落到第 0 页', initialPage: undefined, activeSegmentId: 'seg-x', expected: 0 },
    { name: '无环节时回落到第 0 页', initialPage: undefined, activeSegmentId: null, expected: 0 },
    { name: 'null 按历史口径视为第 0 页', initialPage: null, activeSegmentId: 'seg-b', expected: 0 },
  ];

  it.each(cases)('$name', ({ initialPage, activeSegmentId, expected }) => {
    expect(resolveInitialPageIndex({ initialPage, activeSegmentId, pages })).toBe(expected);
  });
});

describe('resolveDeferredInitialPage：异步恢复页只应用一次', () => {
  const cases: Array<{
    name: string;
    initialPage: number | null | undefined;
    pages: WhiteboardPageItem[];
    expected: { applied: boolean; targetPage: number | null };
  }> = [
    {
      name: '页面列表未就绪 → 不消费',
      initialPage: 2,
      pages: [],
      expected: { applied: false, targetPage: null },
    },
    {
      name: '恢复页尚未到达 → 不消费',
      initialPage: undefined,
      pages,
      expected: { applied: false, targetPage: null },
    },
    {
      name: '恢复页为 null → 不消费',
      initialPage: null,
      pages,
      expected: { applied: false, targetPage: null },
    },
    {
      name: '第 0 页不触发二次跳转，但标记已应用',
      initialPage: 0,
      pages,
      expected: { applied: true, targetPage: null },
    },
    {
      name: '合法页触发跳转',
      initialPage: 2,
      pages,
      expected: { applied: true, targetPage: 2 },
    },
    {
      name: '越界页不跳转，但标记已应用',
      initialPage: 4,
      pages,
      expected: { applied: true, targetPage: null },
    },
    {
      name: '负数页不跳转，但标记已应用',
      initialPage: -1,
      pages,
      expected: { applied: true, targetPage: null },
    },
  ];

  it.each(cases)('$name', ({ initialPage, pages: inputPages, expected }) => {
    expect(resolveDeferredInitialPage({ initialPage, pages: inputPages })).toEqual(expected);
  });
});

// ── 环节跟随 ──────────────────────────────────────────────────────────────

describe('resolveSegmentFollow：环节跟随矩阵', () => {
  it('首次渲染（prev 与 active 相同）不跳页', () => {
    expect(
      resolveSegmentFollow({ activeSegmentId: 'seg-b', previousSegmentId: 'seg-b', currentPage: 0, pages }),
    ).toEqual({
      targetPage: null,
      nextPreviousSegmentId: 'seg-b',
      consumeProgrammaticSwitch: false,
      createSegmentPage: false,
    });
  });

  it('无环节时不跳页', () => {
    expect(resolveSegmentFollow({ activeSegmentId: null, previousSegmentId: 'seg-a', currentPage: 1, pages })).toEqual({
      targetPage: null,
      nextPreviousSegmentId: null,
      consumeProgrammaticSwitch: false,
      createSegmentPage: false,
    });
  });

  it('程序化翻页优先消费标记，不跟随', () => {
    expect(
      resolveSegmentFollow({
        activeSegmentId: 'seg-b',
        previousSegmentId: 'seg-a',
        currentPage: 1,
        pages,
        programmaticPageSwitch: true,
      }),
    ).toEqual({
      targetPage: null,
      nextPreviousSegmentId: 'seg-b',
      consumeProgrammaticSwitch: true,
      createSegmentPage: false,
    });
  });

  it('当前页是共享页（无 segmentId）时不跳页', () => {
    expect(
      resolveSegmentFollow({ activeSegmentId: 'seg-b', previousSegmentId: 'seg-a', currentPage: 0, pages }),
    ).toEqual({
      targetPage: null,
      nextPreviousSegmentId: 'seg-b',
      consumeProgrammaticSwitch: false,
      createSegmentPage: false,
    });
  });

  it('当前页绑定其它环节时跳到新环节大纲首页（含共享页，与课中 getPagesForSegment 口径一致）', () => {
    expect(
      resolveSegmentFollow({ activeSegmentId: 'seg-b', previousSegmentId: 'seg-a', currentPage: 1, pages }),
    ).toEqual({
      targetPage: 0,
      nextPreviousSegmentId: 'seg-b',
      consumeProgrammaticSwitch: false,
      createSegmentPage: false,
    });
  });

  it('当前页已属于目标环节时不跳页', () => {
    expect(
      resolveSegmentFollow({ activeSegmentId: 'seg-b', previousSegmentId: 'seg-a', currentPage: 3, pages }),
    ).toEqual({
      targetPage: null,
      nextPreviousSegmentId: 'seg-b',
      consumeProgrammaticSwitch: false,
      createSegmentPage: false,
    });
  });

  it('目标环节没有专属页但有可见共享页时，跳到共享页而不是停在其它环节的页上', () => {
    expect(
      resolveSegmentFollow({ activeSegmentId: 'seg-c', previousSegmentId: 'seg-a', currentPage: 1, pages }),
    ).toEqual({
      targetPage: 0,
      nextPreviousSegmentId: 'seg-c',
      consumeProgrammaticSwitch: false,
      createSegmentPage: false,
    });
  });

  it('页面列表为空时不跳页', () => {
    expect(
      resolveSegmentFollow({ activeSegmentId: 'seg-b', previousSegmentId: 'seg-a', currentPage: 0, pages: [] }),
    ).toEqual({
      targetPage: null,
      nextPreviousSegmentId: 'seg-b',
      consumeProgrammaticSwitch: false,
      createSegmentPage: false,
    });
  });

  it('当前页下标越界时修复性跳到大纲首页', () => {
    expect(
      resolveSegmentFollow({ activeSegmentId: 'seg-b', previousSegmentId: 'seg-a', currentPage: 99, pages }),
    ).toEqual({
      targetPage: 0,
      nextPreviousSegmentId: 'seg-b',
      consumeProgrammaticSwitch: false,
      createSegmentPage: false,
    });
  });

  it('共享页已从目标环节隐藏（excludedSegmentIds）时跳走，不再停留成空画布', () => {
    const excludedPages: WhiteboardPageItem[] = [
      { id: 'x0', title: '共享页', order: 0, excludedSegmentIds: ['seg-b'] },
      { id: 'x1', title: 'B 页', order: 1, segmentId: 'seg-b' },
    ];
    expect(
      resolveSegmentFollow({
        activeSegmentId: 'seg-b',
        previousSegmentId: 'seg-a',
        currentPage: 0,
        pages: excludedPages,
      }),
    ).toEqual({
      targetPage: 1,
      nextPreviousSegmentId: 'seg-b',
      consumeProgrammaticSwitch: false,
      createSegmentPage: false,
    });
  });

  it('目标环节一个可见页都没有时给出建页信号（教师端据此创建首个页面）', () => {
    const onlyASegPages: WhiteboardPageItem[] = [{ id: 'a0', title: 'A 页', order: 0, segmentId: 'seg-a' }];
    expect(
      resolveSegmentFollow({
        activeSegmentId: 'seg-b',
        previousSegmentId: 'seg-a',
        currentPage: 0,
        pages: onlyASegPages,
      }),
    ).toEqual({
      targetPage: null,
      nextPreviousSegmentId: 'seg-b',
      consumeProgrammaticSwitch: false,
      createSegmentPage: true,
    });
  });
});

// ── 只读策略 ──────────────────────────────────────────────────────────────

describe('resolveCanvasReadOnlyPolicy：画布只读策略', () => {
  it('可编辑时开放全部编辑入口', () => {
    expect(resolveCanvasReadOnlyPolicy(false)).toEqual({
      interactive: true,
      pointerEvents: 'auto',
      toolbarVisible: true,
      pageBarVisible: true,
      selectionEnabled: true,
      contextMenuEnabled: true,
      dragEnabled: true,
    });
  });

  it('只读时关闭全部编辑入口', () => {
    expect(resolveCanvasReadOnlyPolicy(true)).toEqual({
      interactive: false,
      pointerEvents: 'none',
      toolbarVisible: false,
      pageBarVisible: false,
      selectionEnabled: false,
      contextMenuEnabled: false,
      dragEnabled: false,
    });
  });
});

describe('resolveFullscreenReadOnlyPolicy：全屏只读交互矩阵', () => {
  const cases: Array<{ name: string; elementType?: string; readOnly: boolean; interactive: boolean }> = [
    { name: 'quiz 在只读下仍可作答', elementType: 'quiz', readOnly: true, interactive: true },
    { name: 'assignment 在只读下仍可提交', elementType: 'assignment', readOnly: true, interactive: true },
    { name: 'rollcall 在只读下被锁定', elementType: 'rollcall', readOnly: true, interactive: false },
    { name: 'presentation 在只读下被锁定', elementType: 'presentation', readOnly: true, interactive: false },
    { name: 'html-applet 在只读下被锁定', elementType: 'html-applet', readOnly: true, interactive: false },
    { name: '未知类型默认锁定（deny by default）', elementType: 'unknown-widget', readOnly: true, interactive: false },
    { name: '缺失类型默认锁定', elementType: undefined, readOnly: true, interactive: false },
    { name: '非只读时 quiz 可交互', elementType: 'quiz', readOnly: false, interactive: true },
    { name: '非只读时 rollcall 可交互', elementType: 'rollcall', readOnly: false, interactive: true },
  ];

  it.each(cases)('$name', ({ elementType, readOnly, interactive }) => {
    const policy = resolveFullscreenReadOnlyPolicy({ readOnly, elementType });

    expect(policy.contentInteractive).toBe(interactive);
    expect(policy.pointerEvents).toBe(interactive ? 'auto' : 'none');
    expect(policy.showLockCover).toBe(!interactive);
  });
});
