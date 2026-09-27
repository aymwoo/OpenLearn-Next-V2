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

export type StackDirection = 'bottom-full' | 'top-full' | 'left-full' | 'right-full';

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
  /**
   * 单边全域切分偏好：
   *  - 'bottom-full': 下方全宽（Top-Bottom 上下切分，下方通栏铺满）
   *  - 'top-full': 上方全宽（Top-Bottom 上下切分，上方通栏铺满）
   *  - 'right-full': 右侧全高（Left-Right 左右切分，右侧整列铺满）
   *  - 'left-full': 左侧全高（Left-Right 左右切分，左侧整列铺满）
   */
  stackDirection?: StackDirection;
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
 *  - quiz ：仅在全屏广播视图中呈现的随堂测试，在 2D 画布上不渲染组件卡片，不占用平铺网格
 */
export const NON_TILEABLE_TYPES: readonly string[] = ['page_meta', 'pen', 'highlighter', 'quiz'];

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
 * 遵循 Linux i3 桌面管理器 autotiling 规范：
 * 动态根据当前被切分格子的实际长宽比决定切分轴：
 *  - 宽度 >= 高度：沿垂直轴对半切分（左右分栏）
 *  - 高度 > 宽度：沿水平轴对半切分（上下分栏）
 * 面积守恒、互不重叠、无空洞，且不会产生极端畸变长条。
 *
 * @param area      待切分区域
 * @param count     需要的格子数
 * @param _depth    兼容旧接口签名，内部按几何长宽比动态自适应
 */
export function splitArea(
  area: TilingRect,
  count: number,
  _depth = 0,
  stackDirection?: StackDirection,
): TilingRect[] {
  if (count <= 0) return [];
  if (count === 1) return [clampRect(area)];

  const tiles: TilingRect[] = [clampRect(area)];

  while (tiles.length < count) {
    let bestIndex = 0;
    let bestScore = -1;

    for (let i = 0; i < tiles.length; i += 1) {
      const t = tiles[i];
      // 当指定了单边通栏保留区时，首轮切分后保护该通栏区，让其它区域分担切分
      if (tiles.length >= 2 && stackDirection) {
        if (stackDirection === 'bottom-full' && t.y > area.y + 1) {
          continue;
        }
        if (stackDirection === 'top-full' && t.y <= area.y + 1) {
          continue;
        }
        if (stackDirection === 'right-full' && t.x > area.x + 1) {
          continue;
        }
        if (stackDirection === 'left-full' && t.x <= area.x + 1) {
          continue;
        }
      }
      const areaSize = t.width * t.height;
      const maxDim = Math.max(t.width, t.height);
      // 评分：优先考虑面积，次优先考虑最长边。>= 确保相同面积时优先切分后侧（Stack）区域
      const score = areaSize * 10000 + maxDim;
      if (score >= bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    const target = tiles.splice(bestIndex, 1)[0];
    let splitVertically = target.width >= target.height;
    if (tiles.length === 0 && stackDirection) {
      if (stackDirection === 'bottom-full' || stackDirection === 'top-full') {
        splitVertically = false; // 水平切分线，实现上下分割
      } else if (stackDirection === 'left-full' || stackDirection === 'right-full') {
        splitVertically = true; // 垂直切分线，实现左右分割
      }
    }

    if (splitVertically) {
      const halfWidth = target.width / 2;
      const first: TilingRect = { x: target.x, y: target.y, width: halfWidth, height: target.height };
      const second: TilingRect = {
        x: target.x + halfWidth,
        y: target.y,
        width: target.width - halfWidth,
        height: target.height,
      };
      tiles.splice(bestIndex, 0, first, second);
    } else {
      const halfHeight = target.height / 2;
      const first: TilingRect = { x: target.x, y: target.y, width: target.width, height: halfHeight };
      const second: TilingRect = {
        x: target.x,
        y: target.y + halfHeight,
        width: target.width,
        height: target.height - halfHeight,
      };
      tiles.splice(bestIndex, 0, first, second);
    }
  }

  // 保证排序稳定自然：自上而下、自左向右（同 y 先看 x）
  return tiles.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 1) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });
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

  const tiles = splitArea(area, elements.length, 0, options.stackDirection);
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

export type TilingDirection = 'left' | 'right' | 'up' | 'down';

export interface BoxWithId {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 在平铺组件集合中，根据物理空间几何寻找指定方向上相邻的最近组件。
 * 对齐 Linux i3 的窗口移动决策逻辑（Alt+Shift+方向键 / HJKL）。
 */
export function findNeighborInDirection<T extends BoxWithId>(
  current: BoxWithId,
  candidates: T[],
  direction: TilingDirection,
): T | null {
  const others = candidates.filter((c) => c.id !== current.id);
  if (others.length === 0) return null;

  const currentCenterX = current.x + current.width / 2;
  const currentCenterY = current.y + current.height / 2;

  let bestMatch: T | null = null;
  let minScore = Infinity;

  for (const item of others) {
    const itemCenterX = item.x + item.width / 2;
    const itemCenterY = item.y + item.height / 2;

    const dx = itemCenterX - currentCenterX;
    const dy = itemCenterY - currentCenterY;

    // 严格方向半平面过滤（允许 1px 容差）
    if (direction === 'left' && dx >= -1) continue;
    if (direction === 'right' && dx <= 1) continue;
    if (direction === 'up' && dy >= -1) continue;
    if (direction === 'down' && dy <= 1) continue;

    // 主轴与次轴位移
    const isHorizontal = direction === 'left' || direction === 'right';
    const primaryDist = isHorizontal ? Math.abs(dx) : Math.abs(dy);
    const secondaryDist = isHorizontal ? Math.abs(dy) : Math.abs(dx);

    // 计算次轴（正交方向）的几何重叠投影
    let overlap = 0;
    if (isHorizontal) {
      const top = Math.max(current.y, item.y);
      const bottom = Math.min(current.y + current.height, item.y + item.height);
      overlap = Math.max(0, bottom - top);
    } else {
      const left = Math.max(current.x, item.x);
      const right = Math.min(current.x + current.width, item.x + item.width);
      overlap = Math.max(0, right - left);
    }

    // 重叠越多惩罚越低；没有重叠时按次轴距离施加重惩罚，保证同侧正对的窗口优先被选中
    const penalty = overlap > 0 ? 1 / (overlap + 1) : secondaryDist * 2.5;
    const score = primaryDist + secondaryDist * 1.5 + penalty * 10;

    if (score < minScore) {
      minScore = score;
      bestMatch = item;
    }
  }

  return bestMatch;
}

/**
 * 碰撞检测：检查鼠标点坐标是否落在某个组件的矩形包围盒内。
 * 用于拖拽对调（Drag to Swap）时命中目标组件。
 */
export function findTileUnderPoint<T extends BoxWithId>(
  point: { x: number; y: number },
  candidates: T[],
  excludeId?: string,
): T | null {
  for (const item of candidates) {
    if (item.id === excludeId) continue;
    if (
      point.x >= item.x &&
      point.x <= item.x + item.width &&
      point.y >= item.y &&
      point.y <= item.y + item.height
    ) {
      return item;
    }
  }
  return null;
}

/**
 * 依据 tileOrder（若未指定则依自然几何位置）对候选组件进行稳定排序。
 */
export function sortCandidatesForTiling<T extends BoxWithId>(
  candidates: T[],
  tileOrderMap?: Map<string, number | undefined>,
): T[] {
  return [...candidates].sort((a, b) => {
    const orderA = tileOrderMap?.get(a.id);
    const orderB = tileOrderMap?.get(b.id);
    if (typeof orderA === 'number' && typeof orderB === 'number') {
      return orderA - orderB;
    }
    if (typeof orderA === 'number') return -1;
    if (typeof orderB === 'number') return 1;

    // 默认按自然几何：自上而下、自左向右
    if (Math.abs(a.y - b.y) > 10) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });
}

export interface TilingSplitter {
  id: string;
  orientation: 'horizontal' | 'vertical';
  x: number;
  y: number;
  length: number;
  thickness: number;
  firstIds: string[]; // horizontal 时上方组件 id，vertical 时左方组件 id
  secondIds: string[]; // horizontal 时下方组件 id，vertical 时右方组件 id
  minPos: number;
  maxPos: number;
  currentPos: number;
}

/**
 * 在平铺组件集合中检测所有相邻边界分割条（支持上下水平分割线与左右垂直分割线）。
 */
export function detectTilingSplitters<T extends BoxWithId>(
  candidates: T[],
  gap = DEFAULT_TILING_GAP,
  minSize = 100,
): TilingSplitter[] {
  const splitters: TilingSplitter[] = [];
  const count = candidates.length;
  if (count < 2) return splitters;

  // 1. 检测上下相邻的水平分割线（Horizontal Splitter: 调整上下高度）
  for (let i = 0; i < count; i += 1) {
    const top = candidates[i];
    for (let j = 0; j < count; j += 1) {
      if (i === j) continue;
      const bottom = candidates[j];
      // top 在上，bottom 在下，Y 轴缝隙约为 gap（允许 3px 容差）
      const expectedBottomY = top.y + top.height + gap;
      if (Math.abs(bottom.y - expectedBottomY) <= 3) {
        // 检查在水平 X 轴上的重叠投影
        const overlapStart = Math.max(top.x, bottom.x);
        const overlapEnd = Math.min(top.x + top.width, bottom.x + bottom.width);
        const overlapWidth = overlapEnd - overlapStart;
        if (overlapWidth > 20) {
          const splitterY = top.y + top.height;
          splitters.push({
            id: `h-split-${top.id}-${bottom.id}`,
            orientation: 'horizontal',
            x: overlapStart,
            y: splitterY,
            length: overlapWidth,
            thickness: Math.max(gap, 8),
            firstIds: [top.id],
            secondIds: [bottom.id],
            minPos: top.y + minSize,
            maxPos: bottom.y + bottom.height - minSize - gap,
            currentPos: splitterY,
          });
        }
      }
    }
  }

  // 2. 检测左右相邻的垂直分割线（Vertical Splitter: 调整左右宽度）
  for (let i = 0; i < count; i += 1) {
    const left = candidates[i];
    for (let j = 0; j < count; j += 1) {
      if (i === j) continue;
      const right = candidates[j];
      const expectedRightX = left.x + left.width + gap;
      if (Math.abs(right.x - expectedRightX) <= 3) {
        const overlapStart = Math.max(left.y, right.y);
        const overlapEnd = Math.min(left.y + left.height, right.y + right.height);
        const overlapHeight = overlapEnd - overlapStart;
        if (overlapHeight > 20) {
          const splitterX = left.x + left.width;
          splitters.push({
            id: `v-split-${left.id}-${right.id}`,
            orientation: 'vertical',
            x: splitterX,
            y: overlapStart,
            length: overlapHeight,
            thickness: Math.max(gap, 8),
            firstIds: [left.id],
            secondIds: [right.id],
            minPos: left.x + minSize,
            maxPos: right.x + right.width - minSize - gap,
            currentPos: splitterX,
          });
        }
      }
    }
  }

  return splitters;
}

export interface SplitterResizePatch {
  [id: string]: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
}

/**
 * 拖拽分割条时计算各关联组件的联动几何变化。
 */
export function applySplitterDrag<T extends BoxWithId>(
  splitter: TilingSplitter,
  delta: number,
  candidates: T[],
): SplitterResizePatch {
  const targetPos = Math.max(splitter.minPos, Math.min(splitter.maxPos, splitter.currentPos + delta));
  const effectiveDelta = targetPos - splitter.currentPos;
  if (Math.abs(effectiveDelta) < 0.5) return {};

  const patches: SplitterResizePatch = {};
  const isHorizontal = splitter.orientation === 'horizontal';

  for (const id of splitter.firstIds) {
    const box = candidates.find((c) => c.id === id);
    if (!box) continue;
    if (isHorizontal) {
      patches[id] = { height: Math.max(20, box.height + effectiveDelta) };
    } else {
      patches[id] = { width: Math.max(20, box.width + effectiveDelta) };
    }
  }

  for (const id of splitter.secondIds) {
    const box = candidates.find((c) => c.id === id);
    if (!box) continue;
    if (isHorizontal) {
      patches[id] = {
        y: box.y + effectiveDelta,
        height: Math.max(20, box.height - effectiveDelta),
      };
    } else {
      patches[id] = {
        x: box.x + effectiveDelta,
        width: Math.max(20, box.width - effectiveDelta),
      };
    }
  }

  return patches;
}

export type DropZoneActionType = 'split-top' | 'split-bottom' | 'split-left' | 'split-right' | 'swap';

export interface DropZoneAction {
  type: DropZoneActionType;
  targetId: string;
  label: string;
  previewRect: { x: number; y: number; width: number; height: number };
}

/**
 * 拖拽卡片感应区细分（对齐 i3 / 黄金分割局部容器切分机制）：
 * - 当总组件数 <= 2 且向下切分时，虚线框可横跨整屏（2 窗口左右切到上下）；
 * - 当已有 3 个及以上组件时，虚线框精准落在目标组件 targetBox 所在的局部容器内（左半/右半、左上/左下、右上/右下）。
 */
export function detectDropZoneAction(
  targetBox: BoxWithId,
  point: { x: number; y: number },
  containerArea?: { x?: number; y?: number; width: number; height: number },
  totalCount = 2,
  gap = DEFAULT_TILING_GAP,
): DropZoneAction {
  const relX = (point.x - targetBox.x) / targetBox.width;
  const relY = (point.y - targetBox.y) / targetBox.height;

  const isGlobalTwoTile = totalCount <= 2 && containerArea !== undefined;
  const baseBox = isGlobalTwoTile
    ? {
        x: containerArea.x ?? 0,
        y: containerArea.y ?? 0,
        width: containerArea.width,
        height: containerArea.height,
      }
    : targetBox;

  const halfH = Math.max(40, (baseBox.height - gap) / 2);
  const halfW = Math.max(40, (baseBox.width - gap) / 2);

  // 上下切分边缘区域（上 25% / 下 25%）
  if (relY < 0.25) {
    return {
      type: 'split-top',
      targetId: targetBox.id,
      label: '↑ 上方分割插入',
      previewRect: {
        x: baseBox.x,
        y: baseBox.y,
        width: baseBox.width,
        height: halfH,
      },
    };
  }
  if (relY > 0.75) {
    return {
      type: 'split-bottom',
      targetId: targetBox.id,
      label: '↓ 下方分割插入',
      previewRect: {
        x: baseBox.x,
        y: baseBox.y + halfH + gap,
        width: baseBox.width,
        height: halfH,
      },
    };
  }
  // 左右切分边缘区域（左 25% / 右 25%）
  if (relX < 0.25) {
    return {
      type: 'split-left',
      targetId: targetBox.id,
      label: '← 左侧分割插入',
      previewRect: {
        x: baseBox.x,
        y: baseBox.y,
        width: halfW,
        height: baseBox.height,
      },
    };
  }
  if (relX > 0.75) {
    return {
      type: 'split-right',
      targetId: targetBox.id,
      label: '→ 右侧分割插入',
      previewRect: {
        x: baseBox.x + halfW + gap,
        y: baseBox.y,
        width: halfW,
        height: baseBox.height,
      },
    };
  }

  // 中心 50%：对调
  return {
    type: 'swap',
    targetId: targetBox.id,
    label: '⇄ 松开对调位置',
    previewRect: {
      x: targetBox.x,
      y: targetBox.y,
      width: targetBox.width,
      height: targetBox.height,
    },
  };
}

/**
 * 局部容器定向切分与空位自适应填补（对齐 i3 树状容器分裂与融合机制）
 */
export function applyContainerSplit(
  sourceId: string,
  targetId: string,
  actionType: DropZoneActionType,
  candidates: BoxWithId[],
  containerArea?: { x?: number; y?: number; width: number; height: number },
  gap = DEFAULT_TILING_GAP,
): Record<string, { x: number; y: number; width: number; height: number }> {
  if (sourceId === targetId) return {};

  const sourceBox = candidates.find((b) => b.id === sourceId);
  const targetBox = candidates.find((b) => b.id === targetId);
  if (!sourceBox || !targetBox) return {};

  const patches: Record<string, { x: number; y: number; width: number; height: number }> = {};

  // 1. 若总数仅 2 个，由左右转上下，或者上下转左右
  if (candidates.length <= 2 && containerArea) {
    const areaX = containerArea.x ?? 0;
    const areaY = containerArea.y ?? 0;
    const areaW = containerArea.width;
    const areaH = containerArea.height;
    const halfH = Math.max(40, (areaH - gap) / 2);
    const halfW = Math.max(40, (areaW - gap) / 2);

    if (actionType === 'split-bottom') {
      patches[targetId] = { x: areaX, y: areaY, width: areaW, height: halfH };
      patches[sourceId] = { x: areaX, y: areaY + halfH + gap, width: areaW, height: halfH };
    } else if (actionType === 'split-top') {
      patches[sourceId] = { x: areaX, y: areaY, width: areaW, height: halfH };
      patches[targetId] = { x: areaX, y: areaY + halfH + gap, width: areaW, height: halfH };
    } else if (actionType === 'split-right') {
      patches[targetId] = { x: areaX, y: areaY, width: halfW, height: areaH };
      patches[sourceId] = { x: areaX + halfW + gap, y: areaY, width: halfW, height: areaH };
    } else if (actionType === 'split-left') {
      patches[sourceId] = { x: areaX, y: areaY, width: halfW, height: areaH };
      patches[targetId] = { x: areaX + halfW + gap, y: areaY, width: halfW, height: areaH };
    }
    return patches;
  }

  // 2. 检查 sourceBox 与 targetBox 是否本来就处于同一列或同一行（互为 partner）
  const isColPartners =
    Math.abs(targetBox.x - sourceBox.x) <= 4 &&
    Math.abs(targetBox.width - sourceBox.width) <= 4 &&
    (Math.abs(targetBox.y + targetBox.height + gap - sourceBox.y) <= 4 ||
      Math.abs(sourceBox.y + sourceBox.height + gap - targetBox.y) <= 4);

  const isRowPartners =
    Math.abs(targetBox.y - sourceBox.y) <= 4 &&
    Math.abs(targetBox.height - sourceBox.height) <= 4 &&
    (Math.abs(targetBox.x + targetBox.width + gap - sourceBox.x) <= 4 ||
      Math.abs(sourceBox.x + sourceBox.width + gap - targetBox.x) <= 4);

  if (isColPartners) {
    const minY = Math.min(sourceBox.y, targetBox.y);
    const totalHeight = sourceBox.height + targetBox.height + gap;

    if (actionType === 'split-top') {
      const halfH = Math.max(40, (totalHeight - gap) / 2);
      patches[sourceId] = { x: targetBox.x, y: minY, width: targetBox.width, height: halfH };
      patches[targetId] = { x: targetBox.x, y: minY + halfH + gap, width: targetBox.width, height: halfH };
      return patches;
    }
    if (actionType === 'split-bottom') {
      const halfH = Math.max(40, (totalHeight - gap) / 2);
      patches[targetId] = { x: targetBox.x, y: minY, width: targetBox.width, height: halfH };
      patches[sourceId] = { x: targetBox.x, y: minY + halfH + gap, width: targetBox.width, height: halfH };
      return patches;
    }
    if (actionType === 'split-left') {
      const halfW = Math.max(40, (targetBox.width - gap) / 2);
      patches[sourceId] = { x: targetBox.x, y: minY, width: halfW, height: totalHeight };
      patches[targetId] = { x: targetBox.x + halfW + gap, y: minY, width: halfW, height: totalHeight };
      return patches;
    }
    if (actionType === 'split-right') {
      const halfW = Math.max(40, (targetBox.width - gap) / 2);
      patches[targetId] = { x: targetBox.x, y: minY, width: halfW, height: totalHeight };
      patches[sourceId] = { x: targetBox.x + halfW + gap, y: minY, width: halfW, height: totalHeight };
      return patches;
    }
  }

  if (isRowPartners) {
    const minX = Math.min(sourceBox.x, targetBox.x);
    const totalWidth = sourceBox.width + targetBox.width + gap;

    if (actionType === 'split-left') {
      const halfW = Math.max(40, (totalWidth - gap) / 2);
      patches[sourceId] = { x: minX, y: targetBox.y, width: halfW, height: targetBox.height };
      patches[targetId] = { x: minX + halfW + gap, y: targetBox.y, width: halfW, height: targetBox.height };
      return patches;
    }
    if (actionType === 'split-right') {
      const halfW = Math.max(40, (totalWidth - gap) / 2);
      patches[targetId] = { x: minX, y: targetBox.y, width: halfW, height: targetBox.height };
      patches[sourceId] = { x: minX + halfW + gap, y: targetBox.y, width: halfW, height: targetBox.height };
      return patches;
    }
    if (actionType === 'split-top') {
      const halfH = Math.max(40, (targetBox.height - gap) / 2);
      patches[sourceId] = { x: minX, y: targetBox.y, width: totalWidth, height: halfH };
      patches[targetId] = { x: minX, y: targetBox.y + halfH + gap, width: totalWidth, height: halfH };
      return patches;
    }
    if (actionType === 'split-bottom') {
      const halfH = Math.max(40, (targetBox.height - gap) / 2);
      patches[targetId] = { x: minX, y: targetBox.y, width: totalWidth, height: halfH };
      patches[sourceId] = { x: minX, y: targetBox.y + halfH + gap, width: totalWidth, height: halfH };
      return patches;
    }
  }

  // 3. 多组件跨容器场景：Source 离开原位置，寻找在同一列或同一行的同伴并扩展填补空缺
  const otherBoxes = candidates.filter((b) => b.id !== sourceId && b.id !== targetId);
  const verticalPartner = otherBoxes.find(
    (b) =>
      Math.abs(b.x - sourceBox.x) <= 4 &&
      Math.abs(b.width - sourceBox.width) <= 4 &&
      (Math.abs(b.y + b.height + gap - sourceBox.y) <= 4 || Math.abs(sourceBox.y + sourceBox.height + gap - b.y) <= 4),
  );

  const horizontalPartner = otherBoxes.find(
    (b) =>
      Math.abs(b.y - sourceBox.y) <= 4 &&
      Math.abs(b.height - sourceBox.height) <= 4 &&
      (Math.abs(b.x + b.width + gap - sourceBox.x) <= 4 || Math.abs(sourceBox.x + sourceBox.width + gap - b.x) <= 4),
  );

  if (verticalPartner) {
    const minY = Math.min(verticalPartner.y, sourceBox.y);
    const newHeight = verticalPartner.height + sourceBox.height + gap;
    patches[verticalPartner.id] = {
      x: verticalPartner.x,
      y: minY,
      width: verticalPartner.width,
      height: newHeight,
    };
  } else if (horizontalPartner) {
    const minX = Math.min(horizontalPartner.x, sourceBox.x);
    const newWidth = horizontalPartner.width + sourceBox.width + gap;
    patches[horizontalPartner.id] = {
      x: minX,
      y: horizontalPartner.y,
      width: newWidth,
      height: horizontalPartner.height,
    };
  }

  // 4. 目标组件一分为二（二分切分目标容器）
  const halfH = Math.max(40, (targetBox.height - gap) / 2);
  const halfW = Math.max(40, (targetBox.width - gap) / 2);

  if (actionType === 'split-top') {
    patches[sourceId] = {
      x: targetBox.x,
      y: targetBox.y,
      width: targetBox.width,
      height: halfH,
    };
    patches[targetId] = {
      x: targetBox.x,
      y: targetBox.y + halfH + gap,
      width: targetBox.width,
      height: halfH,
    };
  } else if (actionType === 'split-bottom') {
    patches[targetId] = {
      x: targetBox.x,
      y: targetBox.y,
      width: targetBox.width,
      height: halfH,
    };
    patches[sourceId] = {
      x: targetBox.x,
      y: targetBox.y + halfH + gap,
      width: targetBox.width,
      height: halfH,
    };
  } else if (actionType === 'split-left') {
    patches[sourceId] = {
      x: targetBox.x,
      y: targetBox.y,
      width: halfW,
      height: targetBox.height,
    };
    patches[targetId] = {
      x: targetBox.x + halfW + gap,
      y: targetBox.y,
      width: halfW,
      height: targetBox.height,
    };
  } else if (actionType === 'split-right') {
    patches[targetId] = {
      x: targetBox.x,
      y: targetBox.y,
      width: halfW,
      height: targetBox.height,
    };
    patches[sourceId] = {
      x: targetBox.x + halfW + gap,
      y: targetBox.y,
      width: halfW,
      height: targetBox.height,
    };
  }

  return patches;
}
