/**
 * 白板视图决策层（纯函数）。
 *
 * 目的：把「当前该显示哪一页 / 哪个全屏 / 哪些交互被锁」从组件的
 * effect 执行顺序里抽出来，变成可枚举、可表驱动测试的优先级规则。
 *
 * 约束：本文件不依赖 React、DOM、socket 或 store，只做纯计算。
 * 组件与 hook 负责把状态喂进来，并按返回值执行副作用。
 */
import type { WhiteboardPageItem } from '../utils/pagination-utils';
import { FULLSCREEN_READONLY_INTERACTIVE_ELEMENT_TYPES } from './element-capabilities';

// ── 页面 ──────────────────────────────────────────────────────────────────

export interface InitialPageInput {
  /** 会话恢复页；异步拉取时可能先到 undefined */
  initialPage?: number | null;
  activeSegmentId?: string | null;
  pages: WhiteboardPageItem[];
}

/**
 * 首帧应落在哪一页。
 *
 * 优先级：显式恢复页 > 当前环节绑定的首页 > 第 0 页。
 * 注意 `Number(null) === 0`：历史行为把 null 当作「第 0 页」而非「未指定」，
 * 这里保持同一口径，避免改变恢复逻辑。
 */
export function resolveInitialPageIndex({ initialPage, activeSegmentId, pages }: InitialPageInput): number {
  const target = Number(initialPage);
  if (Number.isFinite(target) && target >= 0) {
    return target;
  }
  if (activeSegmentId) {
    const segmentIndex = pages.findIndex((page) => page.segmentId === activeSegmentId);
    if (segmentIndex !== -1) {
      return segmentIndex;
    }
  }
  return 0;
}

export interface DeferredInitialPageResult {
  /** 是否应把「恢复页已处理」标记为 true（与历史 effect 的 early-return 口径一致） */
  applied: boolean;
  /** 真正需要跳转的页；null 表示不需要跳转 */
  targetPage: number | null;
}

/**
 * 异步到达的会话恢复页只应用一次。
 *
 * 历史行为：第 0 页不触发二次跳转（首帧已经是 0），越界页也不跳转，
 * 但一旦 pages 就绪且 initialPage 有值就标记为已处理。
 */
export function resolveDeferredInitialPage({
  initialPage,
  pages,
}: Pick<InitialPageInput, 'initialPage' | 'pages'>): DeferredInitialPageResult {
  if (!Array.isArray(pages) || pages.length === 0) {
    return { applied: false, targetPage: null };
  }
  if (initialPage === undefined || initialPage === null) {
    return { applied: false, targetPage: null };
  }
  const target = Number(initialPage);
  const targetPage = Number.isFinite(target) && target > 0 && target < pages.length ? target : null;
  return { applied: true, targetPage };
}

export interface SegmentFollowInput {
  activeSegmentId?: string | null;
  previousSegmentId?: string | null;
  currentPage: number;
  pages: WhiteboardPageItem[];
  /** 本次翻页由组件自身发起（手动切页），不应再被环节联动拉走 */
  programmaticPageSwitch?: boolean;
}

export interface SegmentFollowResult {
  targetPage: number | null;
  nextPreviousSegmentId: string | null;
  consumeProgrammaticSwitch: boolean;
}

/**
 * 教学环节切换时的自动跟随翻页。
 *
 * 优先级与守卫：
 * 1. 程序化翻页标记优先消费，不跟随；
 * 2. 无环节、环节未变化、页面列表为空时不动；
 * 3. 只有「当前页明确绑定到另一个环节」时才跳页，共享页（无 segmentId）不跳；
 * 4. 目标环节没有专属页时不动。
 */
export function resolveSegmentFollow({
  activeSegmentId,
  previousSegmentId,
  currentPage,
  pages,
  programmaticPageSwitch = false,
}: SegmentFollowInput): SegmentFollowResult {
  const active = activeSegmentId ?? null;

  if (programmaticPageSwitch) {
    return { targetPage: null, nextPreviousSegmentId: active, consumeProgrammaticSwitch: true };
  }

  const previous = previousSegmentId ?? null;
  if (!active || previous === active || !Array.isArray(pages) || pages.length === 0) {
    return { targetPage: null, nextPreviousSegmentId: active, consumeProgrammaticSwitch: false };
  }

  const currentPageItem = pages[currentPage];
  if (!currentPageItem?.segmentId || currentPageItem.segmentId === active) {
    return { targetPage: null, nextPreviousSegmentId: active, consumeProgrammaticSwitch: false };
  }

  const targetIndex = pages.findIndex((page) => page.segmentId === active);
  return {
    targetPage: targetIndex === -1 ? null : targetIndex,
    nextPreviousSegmentId: active,
    consumeProgrammaticSwitch: false,
  };
}

// ── 全屏 ──────────────────────────────────────────────────────────────────

export interface FullscreenResolutionInput {
  /** 学生端是否跟随教师广播（教师端为 false） */
  followRemoteFullscreen?: boolean;
  remoteBoardElementId?: string | null;
  localBoardElementId?: string | null;
  remoteBrowserElementId?: string | null;
  localBrowserElementId?: string | null;
}

export interface FullscreenSurface {
  elementId: string | null;
  isRemote: boolean;
  /** 远程同步视图不可本地退出 */
  dismissible: boolean;
}

export interface FullscreenResolution {
  active: boolean;
  /** 实际呈现的层：browser 优先于 board */
  surface: 'browser' | 'board' | null;
  board: FullscreenSurface;
  browser: FullscreenSurface;
  /** 原生浏览器全屏只由本机控制端发起，学生端只跟随占满视口 */
  nativeBrowserFullscreenEnabled: boolean;
}

const normalizeElementId = (elementId: string | null | undefined): string | null =>
  typeof elementId === 'string' && elementId.length > 0 ? elementId : null;

/**
 * 全屏视图优先级。
 *
 * - 同级内：远程 > 本地（教师正在展示时，学生本地最大化不能覆盖）；
 * - 跨级：browser > board（与 WhiteboardFullscreenOverlay 的分支顺序一致）。
 */
export function resolveFullscreenView({
  followRemoteFullscreen = false,
  remoteBoardElementId,
  localBoardElementId,
  remoteBrowserElementId,
  localBrowserElementId,
}: FullscreenResolutionInput): FullscreenResolution {
  const followRemote = Boolean(followRemoteFullscreen);

  const remoteBoardId = followRemote ? normalizeElementId(remoteBoardElementId) : null;
  const boardId = remoteBoardId ?? normalizeElementId(localBoardElementId);
  const remoteBrowserId = followRemote ? normalizeElementId(remoteBrowserElementId) : null;
  const browserId = remoteBrowserId ?? normalizeElementId(localBrowserElementId);

  const surface = browserId ? 'browser' : boardId ? 'board' : null;

  return {
    active: surface !== null,
    surface,
    board: {
      elementId: boardId,
      isRemote: remoteBoardId !== null,
      dismissible: remoteBoardId === null,
    },
    browser: {
      elementId: browserId,
      isRemote: remoteBrowserId !== null,
      dismissible: remoteBrowserId === null,
    },
    nativeBrowserFullscreenEnabled: remoteBrowserId === null,
  };
}

// ── 只读（全班专注锁定）────────────────────────────────────────────────────

export interface CanvasReadOnlyPolicy {
  interactive: boolean;
  pointerEvents: 'auto' | 'none';
  toolbarVisible: boolean;
  pageBarVisible: boolean;
  selectionEnabled: boolean;
  contextMenuEnabled: boolean;
  dragEnabled: boolean;
}

/** 画布层：只读时整体关闭编辑能力（组件本体也不可交互）。 */
export function resolveCanvasReadOnlyPolicy(readOnly: boolean): CanvasReadOnlyPolicy {
  const interactive = !readOnly;
  return {
    interactive,
    pointerEvents: interactive ? 'auto' : 'none',
    toolbarVisible: interactive,
    pageBarVisible: interactive,
    selectionEnabled: interactive,
    contextMenuEnabled: interactive,
    dragEnabled: interactive,
  };
}

/**
 * 全屏层：只读时仍保留「学生需要作答」的组件交互，
 * 其余组件盖只读遮罩。口径来自能力表（当前为 quiz / assignment），
 * 不再在这里维护第二份白名单。
 */
export const FULLSCREEN_READONLY_INTERACTIVE_TYPES: ReadonlySet<string> = new Set(
  FULLSCREEN_READONLY_INTERACTIVE_ELEMENT_TYPES,
);

export interface FullscreenReadOnlyPolicy {
  contentInteractive: boolean;
  pointerEvents: 'auto' | 'none';
  showLockCover: boolean;
}

export function resolveFullscreenReadOnlyPolicy({
  readOnly,
  elementType,
}: {
  readOnly: boolean;
  elementType?: string | null;
}): FullscreenReadOnlyPolicy {
  const contentInteractive =
    !readOnly || (typeof elementType === 'string' && FULLSCREEN_READONLY_INTERACTIVE_TYPES.has(elementType));
  return {
    contentInteractive,
    pointerEvents: contentInteractive ? 'auto' : 'none',
    showLockCover: !contentInteractive,
  };
}
