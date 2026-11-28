/**
 * 白板内置元素能力表。
 *
 * 为什么要有这张表：同一批「元素类型」的元数据原本散落在五处 ——
 * 自动平铺的默认尺寸、全屏只读的交互白名单、属性侧栏的组件判定、
 * 全屏标题文案、分页逻辑里的 page_meta 特判。任何一处漏改都不会报错，
 * 只会让某个组件的表现悄悄退化。这里把内置类型的元数据收敛到一处，
 * 消费方只读表，不再各自维护副本。
 *
 * 边界：
 * - 只覆盖宿主内置类型；插件类型（`whiteboard.renderer` / `paletteItemRegistry`
 *   注册的自定义图元）仍走原有扩展点，未命中即走下面的安全兜底。
 * - 本文件不依赖 React / DOM / 任何业务模块，可被 core、hooks、components 直接引用。
 */

export type ElementKind = 'widget' | 'graphic' | 'annotation' | 'meta' | 'extension' | 'unknown';

export interface ElementSize {
  width: number;
  height: number;
}

export interface ElementCapability {
  type: string;
  /** 全屏标题 / 面板提示用的短标签 */
  label: string;
  kind: ElementKind;
  /** 元素自身未显式给出宽高时的兜底尺寸 */
  defaultSize: ElementSize;
  /** 是否参与自动平铺（手绘折线与页面元数据不可平铺） */
  tileable: boolean;
  /** 是否为画布可见图元（`page_meta` 不是） */
  visible: boolean;
  /** 全班专注锁定时，全屏内容是否仍需可交互（学生要作答 / 提交） */
  fullscreenReadOnlyInteractive: boolean;
  /** 属性侧栏的尺寸输入形态 */
  sizeInput: 'width-height' | 'radius' | 'none';
  /**
   * 属性侧栏是否按「组件卡片」处理：
   * 不提供宽高输入，且需要用户显式点击标题栏「属性」图标才展开。
   */
  sidebarCard: boolean;
  /**
   * 新建元素时补齐的默认 data 字段（拖放 / 插入共用）。
   *
   * 入参是调用方给的拖放内容，返回该类型最终落库的字段。未登记的类型
   * 走通用合并路径（插件默认值 + 内容），不需要在这里出现。
   */
  createDefaults?: (content: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * 内置类型全集。
 *
 * `defaultSize` 的值与迁移前 `useAutoTilingState.DEFAULT_ELEMENT_SIZE` 及
 * 「未登记即 300×300」的兜底口径保持一致 —— 这张表只是搬家，不改行为。
 */
export const ELEMENT_CAPABILITIES: readonly ElementCapability[] = [
  // ── 教学组件 ────────────────────────────────────────────────────────────
  {
    type: 'quiz',
    label: '📝 随堂测验',
    kind: 'widget',
    defaultSize: { width: 340, height: 380 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: true,
    sizeInput: 'none',
    sidebarCard: true,
    createDefaults: (content) => ({
      question: content.question ?? 'New Quiz',
      options: Array.isArray(content.options) ? content.options : ['A', 'B', 'C', 'D'],
    }),
  },
  {
    type: 'assignment',
    label: '📋 作业',
    kind: 'widget',
    defaultSize: { width: 340, height: 400 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: true,
    sizeInput: 'none',
    sidebarCard: true,
    createDefaults: (content) => ({
      title: content.title ?? 'New Assignment',
      description: content.description ?? '',
    }),
  },
  {
    type: 'rollcall',
    label: '🎲 随机点名',
    kind: 'widget',
    defaultSize: { width: 340, height: 420 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'none',
    sidebarCard: true,
    createDefaults: () => ({ allStudents: [] }),
  },
  {
    type: 'code-sandbox',
    label: '💻 代码沙箱',
    kind: 'widget',
    defaultSize: { width: 400, height: 320 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'none',
    sidebarCard: true,
    createDefaults: (content) => ({ code: content.code ?? "console.log('Hello Sandbox!');" }),
  },
  {
    type: 'math-graph',
    label: '📐 数学图形',
    kind: 'widget',
    defaultSize: { width: 400, height: 350 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'none',
    sidebarCard: true,
    createDefaults: (content) => ({ equation: content.equation ?? 'Math.sin(x)' }),
  },
  {
    type: 'presentation',
    label: '📽 演示文稿',
    kind: 'widget',
    defaultSize: { width: 600, height: 400 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'none',
    sidebarCard: true,
    createDefaults: (content) => ({
      markdown: content.markdown ?? '# Title Slide\n---\n## Slide 2',
      width: 600,
      height: 400,
      slideX: 0,
      slideY: 0,
    }),
  },
  {
    type: 'learning_surface',
    label: '📚 学习面',
    kind: 'widget',
    defaultSize: { width: 640, height: 400 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'none',
    sidebarCard: true,
  },
  {
    type: 'hello-world',
    label: '👋 示例组件',
    kind: 'widget',
    defaultSize: { width: 300, height: 300 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'none',
    sidebarCard: true,
    createDefaults: () => ({}),
  },
  {
    type: 'plugin',
    label: '🧩 插件组件',
    kind: 'widget',
    defaultSize: { width: 500, height: 400 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'none',
    sidebarCard: true,
  },
  {
    // 交互网页课件：尺寸仍允许在属性栏手填（历史行为），故 sidebarCard 为 false。
    type: 'html-applet',
    label: '🌐 交互课件',
    kind: 'widget',
    defaultSize: { width: 400, height: 300 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'width-height',
    sidebarCard: false,
  },
  {
    // 计时器没有宿主内置渲染分支，只能由插件图元渲染；保留旧默认尺寸 280×200。
    type: 'timer',
    label: '⏱ 计时器',
    kind: 'extension',
    defaultSize: { width: 280, height: 200 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'width-height',
    sidebarCard: false,
  },

  // ── 绘图 ────────────────────────────────────────────────────────────────
  {
    type: 'text',
    label: '📝 文本',
    kind: 'graphic',
    defaultSize: { width: 300, height: 300 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'width-height',
    sidebarCard: false,
  },
  {
    type: 'rectangle',
    label: '▭ 矩形',
    kind: 'graphic',
    defaultSize: { width: 300, height: 300 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'width-height',
    sidebarCard: false,
  },
  {
    // `data.shape` 为 `rect` 时按矩形渲染；属性侧栏仍按宽高编辑。
    type: 'shape',
    label: '▭ 图形',
    kind: 'graphic',
    defaultSize: { width: 300, height: 300 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'width-height',
    sidebarCard: false,
  },
  {
    type: 'circle',
    label: '◯ 圆形',
    kind: 'graphic',
    defaultSize: { width: 300, height: 300 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'radius',
    sidebarCard: false,
  },

  // ── 手绘标注 ────────────────────────────────────────────────────────────
  {
    type: 'pen',
    label: '✏️ 画笔',
    kind: 'annotation',
    defaultSize: { width: 300, height: 300 },
    // 坐标存在 points 数组里（绝对舞台坐标），强行平铺会把笔迹拉成方块
    tileable: false,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'none',
    sidebarCard: false,
  },
  {
    type: 'highlighter',
    label: '🖍 荧光笔',
    kind: 'annotation',
    defaultSize: { width: 300, height: 300 },
    tileable: false,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'none',
    sidebarCard: false,
  },

  // ── 元数据 / 扩展 ───────────────────────────────────────────────────────
  {
    type: 'page_meta',
    label: '📄 页面配置',
    kind: 'meta',
    defaultSize: { width: 300, height: 300 },
    // 分页配置不是可见组件，不参与平铺也不应被当作普通图元选中
    tileable: false,
    visible: false,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'none',
    sidebarCard: false,
  },
  {
    // 插件自定义图元的一等公民入口：真实渲染由 `whiteboard.renderer` 扩展点接管
    type: 'whiteboard.renderer',
    label: '🧩 插件图元',
    kind: 'extension',
    defaultSize: { width: 300, height: 300 },
    tileable: true,
    visible: true,
    fullscreenReadOnlyInteractive: false,
    sizeInput: 'width-height',
    sidebarCard: false,
  },
];

const CAPABILITY_BY_TYPE = new Map<string, ElementCapability>(
  ELEMENT_CAPABILITIES.map((capability) => [capability.type, capability]),
);

/** 命中内置类型时返回表项，否则返回 undefined（无兜底，供「需要区分未知」的调用方用）。 */
export function findElementCapability(type: string | null | undefined): ElementCapability | undefined {
  if (typeof type !== 'string' || type.length === 0) return undefined;
  return CAPABILITY_BY_TYPE.get(type);
}

/**
 * 未知类型的兜底能力。
 *
 * 每个字段都必须与迁移前的隐式行为一致：可见、可平铺、属性栏给宽高输入、
 * 不进全屏只读交互白名单。
 */
const UNKNOWN_ELEMENT_CAPABILITY: ElementCapability = {
  type: 'unknown',
  label: '未知组件',
  kind: 'unknown',
  defaultSize: { width: 300, height: 300 },
  tileable: true,
  visible: true,
  fullscreenReadOnlyInteractive: false,
  sizeInput: 'width-height',
  sidebarCard: false,
};

/** 取能力表项；未知类型返回安全兜底，调用方无需再判空。 */
export function getElementCapability(type: string | null | undefined): ElementCapability {
  return findElementCapability(type) ?? UNKNOWN_ELEMENT_CAPABILITY;
}

/**
 * 元素的有效默认尺寸：`data` 里显式给出的宽高优先，否则用能力表兜底。
 *
 * 保留「`data.width` 为 0 时回落默认值」的历史口径。
 */
export function getDefaultElementSize(type: string, data?: { width?: number; height?: number } | null): ElementSize {
  const preset = getElementCapability(type).defaultSize;
  return {
    width: data?.width || preset.width,
    height: data?.height || preset.height,
  };
}

/** 不参与自动平铺的内置类型（等价于迁移前的 `NON_TILEABLE_TYPES`）。 */
export const NON_TILEABLE_ELEMENT_TYPES: readonly string[] = ELEMENT_CAPABILITIES.filter(
  (capability) => !capability.tileable,
).map((capability) => capability.type);

/** 全班专注锁定时仍允许全屏交互的内置类型。 */
export const FULLSCREEN_READONLY_INTERACTIVE_ELEMENT_TYPES: readonly string[] = ELEMENT_CAPABILITIES.filter(
  (capability) => capability.fullscreenReadOnlyInteractive,
).map((capability) => capability.type);

/** 是否为画布可见图元；未知类型按可见处理。 */
export function isVisibleElementType(type: string | null | undefined): boolean {
  return getElementCapability(type).visible;
}

// ── 显示标题 / 文本 ──────────────────────────────────────────────────────

/**
 * 元素文本字段（题目 / 描述等）。
 *
 * 与标题同理：`data` 来自数据库 JSON，对象 / 数组直接作为 React 子节点会抛
 * "Objects are not valid as a React child"。非字符串一律回落到兜底文本。
 */
export function resolveElementText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * 元素显示标题。
 *
 * `data.title` 来自数据库 JSON，运行时不保证是字符串。对象 / 数组直接交给
 * React 会抛 "Objects are not valid as a React child"，让整块画布白屏；
 * 只有非空字符串才可信，其余一律回落到调用方给的默认标题。
 */
export function resolveElementTitle(value: unknown, fallback: string): string {
  const text = resolveElementText(value);
  return text.length > 0 ? text : fallback;
}
