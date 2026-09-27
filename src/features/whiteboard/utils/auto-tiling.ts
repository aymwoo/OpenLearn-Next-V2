/**
 * 白板自动平铺（Auto Tiling）—— 纯布局算法，不依赖 React / Konva / DOM。
 *
 * 目标：把当前页上的「组件」像 Linux tiling 窗口管理器（i3 / sway / BSPWM）
 * 那样自动排布成无重叠、无空洞的镶嵌布局，同时完全保留原有的自由拖拽布局，
 * 两者由工具栏按钮一键切换。
 *
 * 算法说明（BSP 二分树，与 i3 同源）：
 *  - 1 个元素 → 占满整个可用区域
 *  - 2 个元素 → 左右对半
 *  - 3 个元素 → 左半 1 个 + 右半上下 2 个
 *  - n 个元素 → 递归二分，每层交替横切 / 竖切，并按元素个数分配面积
 *    （firstCount = floor(n/2)，保证 n=3 时退化成 i3 的经典形态）
 *
 * 填充策略：元素**保持自身宽高比**居中放入格子，格子之间留固定 gap，
 * 不会把文字 / 测验 / HTML 课件拉变形。
 *
 * 坐标系：白板舞台是响应式的，元素 x/y/width/height 就是相对容器的 CSS 像素
 * （见 InteractiveWhiteboard.tsx 的 containerSize + <Stage>），因此本模块
 * 的所有入参出参都是同一套容器像素，无需任何缩放换算。
 */

export interface TilingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TilingArea {
  width: number;
  height: number;
}

export interface TilingOptions {
  /** 格子之间的间隙（像素）。在每个叶子格子上做 gap/2 的内缩实现。 */
  gap?: number;
  /** 画布四周留白（像素） */
  padding?: number;
  /**
   * 填充策略：
   *  - 'fill'（默认，i3 行为）：元素外框**精确铺满**整个格子，零留白。
   *    白板元素外壳是 flex 纵向容器（标题栏 + flex-grow 内容区），撑满后内部自动重排。
   *  - 'fit'：保持宽高比居中，比例不同时会在格子内留出空白。
   */
  fillMode?: 'fill' | 'fit';
  /** 'fit' 模式下的放大倍率上限，默认不限制。'fill' 模式下忽略。 */
  maxScale?: number;
}

/** 单个元素在平铺后的最终几何 */
export interface TilingResult {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 参与平铺的候选元素（已把类型差异归一化成包围盒） */
export interface TileCandidate {
  id: string;
  /** 归一化后的包围盒 */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * 'circle' 表示该元素的几何由 radius 驱动（白板的圆形工具不读 width/height），
   * 写回时需要改写 radius 而不是 width/height，否则改动会静默失效。
   */
  shape?: 'rect' | 'circle';
}

// 对齐 i3 的观感：窗口彼此紧邻，只留一道细边框
export const DEFAULT_TILING_GAP = 8;
export const DEFAULT_TILING_PADDING = 8;

/**
 * 不参与自动平铺的元素类型。
 *  - page_meta ：白板分页元数据，不是可见组件
 *  - pen / highlighter ：自由手绘折线，坐标存在 points 数组里（绝对舞台坐标），
 *    没有 x/y/width/height 概念，强行平铺会把手写笔迹拉成方块
 */
export const NON_TILEABLE_TYPES: readonly string[] = ['page_meta', 'pen', 'highlighter'];

export function isTileableType(type: string): boolean {
  return !NON_TILEABLE_TYPES.includes(type);
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampRect(rect: TilingRect): TilingRect {
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(0, rect.width),
    height: Math.max(0, rect.height),
  };
}

/**
 * BSP 二分：把 area 递归切成 count 个不重叠的矩形。
 *
 * @param area      待切分区域
 * @param count     需要的格子数
 * @param depth     递归深度，用于交替横切 / 竖切方向（0 层先左右分栏）
 */
export function splitArea(area: TilingRect, count: number, depth = 0): TilingRect[] {
  if (count <= 0) return [];
  if (count === 1) return [clampRect(area)];

  const firstCount = Math.floor(count / 2);
  const secondCount = count - firstCount;
  // 首层左右分栏（i3 的经典观感），之后每层交替，避免所有格子挤成一条横带
  const splitVertically = depth % 2 === 0;

  if (splitVertically) {
    const firstWidth = (area.width * firstCount) / count;
    const first: TilingRect = { x: area.x, y: area.y, width: firstWidth, height: area.height };
    const second: TilingRect = {
      x: area.x + firstWidth,
      y: area.y,
      width: area.width - firstWidth,
      height: area.height,
    };
    return [...splitArea(first, firstCount, depth + 1), ...splitArea(second, secondCount, depth + 1)];
  }

  const firstHeight = (area.height * firstCount) / count;
  const first: TilingRect = { x: area.x, y: area.y, width: area.width, height: firstHeight };
  const second: TilingRect = {
    x: area.x,
    y: area.y + firstHeight,
    width: area.width,
    height: area.height - firstHeight,
  };
  return [...splitArea(first, firstCount, depth + 1), ...splitArea(second, secondCount, depth + 1)];
}

/**
 * 把一个「自然尺寸」的元素放进格子。
 *
 * fillMode = 'fill'：直接返回整个格子（i3 行为，精确铺满、零留白）。
 * fillMode = 'fit'  ：等比缩放并居中，缩放比取宽高约束的较小值，永不溢出格子。
 */
export function placeInTile(
  tile: TilingRect,
  naturalWidth: number,
  naturalHeight: number,
  fillMode: 'fill' | 'fit' = 'fill',
  maxScale = Infinity,
): TilingResult {
  if (fillMode === 'fill' || tile.width <= 0 || tile.height <= 0) {
    return { id: '', x: tile.x, y: tile.y, width: Math.max(0, tile.width), height: Math.max(0, tile.height) };
  }
  return fitIntoTile(tile, naturalWidth, naturalHeight, maxScale);
}

/**
 * 把一个「自然尺寸」的元素等比放进格子并居中。
 * 缩放比例取宽高约束的较小值，因此永远不会溢出格子。
 */
export function fitIntoTile(
  tile: TilingRect,
  naturalWidth: number,
  naturalHeight: number,
  maxScale = Infinity,
): TilingResult {
  const w = naturalWidth > 0 ? naturalWidth : tile.width;
  const h = naturalHeight > 0 ? naturalHeight : tile.height;
  if (w <= 0 || h <= 0 || tile.width <= 0 || tile.height <= 0) {
    return { id: '', x: tile.x, y: tile.y, width: Math.max(0, tile.width), height: Math.max(0, tile.height) };
  }

  const scale = Math.min(tile.width / w, tile.height / h, maxScale);
  const width = w * scale;
  const height = h * scale;
  return {
    id: '',
    x: tile.x + (tile.width - width) / 2,
    y: tile.y + (tile.height - height) / 2,
    width,
    height,
  };
}

/**
 * 核心入口：给一组候选元素算出平铺后的几何。
 *
 * 返回数组与入参数组**一一对应且顺序一致**，且 id 与入参一致；
 * 容器尺寸非法或数组为空时返回空数组，调用方据此跳过写回。
 */
export function computeTiling(
  elements: TileCandidate[],
  container: TilingArea,
  options: TilingOptions = {},
): TilingResult[] {
  const gap = options.gap ?? DEFAULT_TILING_GAP;
  const padding = options.padding ?? DEFAULT_TILING_PADDING;
  const fillMode = options.fillMode ?? 'fill';
  const maxScale = options.maxScale ?? Infinity;

  if (elements.length === 0) return [];
  if (container.width <= 0 || container.height <= 0) return [];

  const area = clampRect({
    x: padding,
    y: padding,
    width: container.width - padding * 2,
    height: container.height - padding * 2,
  });
  if (area.width <= 0 || area.height <= 0) return [];

  const tiles = splitArea(area, elements.length, 0);
  const inset = Math.max(0, gap) / 2;

  return elements.map((element, index) => {
    const tile = tiles[index];
    if (!tile) {
      // 理论上不会发生（splitArea 数量恒等于 count），保底保持原位而不是丢元素
      return { id: element.id, x: element.x, y: element.y, width: element.width, height: element.height };
    }
    const inner = clampRect({
      x: tile.x + inset,
      y: tile.y + inset,
      width: tile.width - inset * 2,
      height: tile.height - inset * 2,
    });
    const fitted = placeInTile(inner, element.width, element.height, fillMode, maxScale);
    return { id: element.id, x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height };
  });
}

/**
 * 把一个原始白板元素转成平铺候选；不可平铺的类型返回 null。
 *
 * @param element      白板元素（{ id, type }）
 * @param data         JSON.parse(element.data) 的结果
 * @param defaultSize  该类型在没有显式 width/height 时的兜底尺寸
 *                     （对应 InteractiveWhiteboard 的 getInitialWidth/Height）
 */
export function toTileCandidate(
  element: { id: string; type: string },
  data: Record<string, any>,
  defaultSize: { width: number; height: number },
): TileCandidate | null {
  if (!isTileableType(element.type)) return null;

  const x = num(data?.x);
  const y = num(data?.y);

  if (element.type === 'circle') {
    // 圆形走 radius，不读 width/height；用 2r 作为包围盒参与布局
    const fallbackRadius = defaultSize.width > 0 ? defaultSize.width / 2 : 24;
    const radius = num(data?.radius) > 0 ? num(data.radius) : fallbackRadius;
    return { id: element.id, x, y, width: radius * 2, height: radius * 2, shape: 'circle' };
  }

  return {
    id: element.id,
    x,
    y,
    width: num(data?.width) > 0 ? num(data.width) : defaultSize.width,
    height: num(data?.height) > 0 ? num(data.height) : defaultSize.height,
  };
}

/** 元素几何字段的键名（圆形走 radius 而非 width/height） */
export function geometryKeys(shape: 'rect' | 'circle' = 'rect'): string[] {
  return shape === 'circle' ? ['x', 'y', 'radius'] : ['x', 'y', 'width', 'height'];
}

/** 取出元素当前的几何补丁（键名随类型而定） */
export function extractGeometry(data: Record<string, any>, shape: 'rect' | 'circle' = 'rect') {
  const out: Record<string, number> = {};
  for (const key of geometryKeys(shape)) {
    const n = Number(data?.[key]);
    out[key] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

/** 两个几何补丁是否在 0.5px 容差内相等 */
export function sameGeometry(a: Record<string, any>, b: Record<string, any>, keys: string[], tolerance = 0.5): boolean {
  const toFinite = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return keys.every((key) => Math.abs(toFinite(a?.[key]) - toFinite(b?.[key])) < tolerance);
}

/**
 * 把平铺结果翻译成要写回元素 data 的几何补丁。
 * 圆形必须改写 radius，否则改动会被白板静默忽略。
 */
export function toTiledGeometry(
  candidate: TileCandidate,
  result: TilingResult,
): { x: number; y: number; width: number; height: number } | { x: number; y: number; radius: number } {
  if (candidate.shape === 'circle') {
    // 圆形取内切：撑满非方形格子会把圆压成椭圆，因此按短边确定半径
    const radius = Math.max(1, Math.min(result.width, result.height) / 2);
    return { x: result.x + result.width / 2, y: result.y + result.height / 2, radius };
  }
  return { x: result.x, y: result.y, width: result.width, height: result.height };
}
