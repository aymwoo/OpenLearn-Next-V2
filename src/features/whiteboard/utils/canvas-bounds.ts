/**
 * 画布「逻辑尺寸」计算。
 *
 * 背景（实测复现）：白板画布（konva Stage）此前**严格等于容器尺寸**，
 * 而从画布往上的每一级祖先都是 `min-h-0` + `overflow-hidden` —— 溢出被裁掉，
 * 整条链上**没有任何一级可滚动**。于是：
 *
 *   - 窗口一矮，画布跟着矮（实测 1440×520 视口下画布可视高只剩 124px）；
 *   - 画在画布可视区之外的组件（哪怕只是窗口缩小前放在画布下部的），
 *     既看不见也拖不动，而且**滚动条不存在**，没有任何办法把它们拉回来。
 *
 * 解法：把「画布逻辑尺寸」与「容器可视尺寸」解耦 —— 画布至少要装得下当前页
 * 全部组件；容器装不下时，由**容器**出滚动条，画布本身保持逻辑尺寸不变。
 *
 * 这个模块是纯函数（无 React / 无 DOM），便于单测锁定口径。
 */

/** 图元在画布坐标系里的矩形。 */
export interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 画布逻辑尺寸（像素）。 */
export interface CanvasSize {
  width: number;
  height: number;
}

/** 容器可视尺寸（像素）。 */
export interface ViewportSize {
  width: number;
  height: number;
}

function finite(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 计算一组图元的包围盒右下角。
 *
 * 只关心「最远能到哪」—— 画布必须装下这些图元。左上角不参与：
 * 图元坐标为负（画在原点上方）时不必额外扩画布，容器自己会裁掉。
 */
export function computeContentBounds(boxes: CanvasBox[]): { maxX: number; maxY: number } {
  let maxX = 0;
  let maxY = 0;
  for (const box of boxes) {
    const x = finite(box?.x);
    const y = finite(box?.y);
    const w = Math.max(0, finite(box?.width));
    const h = Math.max(0, finite(box?.height));
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  return { maxX, maxY };
}

/**
 * 画布逻辑尺寸 = max(容器可视尺寸, 内容所需尺寸 + 边距)。
 *
 * - 内容装得下 → 画布 == 容器，行为与修复前完全一致（不会凭空多出滚动条）；
 * - 内容装不下 → 画布撑到内容高度，容器出现滚动条，组件重新可达。
 */
export function resolveCanvasSize(
  viewport: ViewportSize,
  content: { maxX: number; maxY: number },
  padding = 0,
): CanvasSize {
  const pad = Math.max(0, finite(padding));
  const viewW = Math.max(0, finite(viewport?.width));
  const viewH = Math.max(0, finite(viewport?.height));
  const needW = Math.ceil(Math.max(0, finite(content?.maxX)) + pad);
  const needH = Math.ceil(Math.max(0, finite(content?.maxY)) + pad);
  return {
    width: Math.max(viewW, needW),
    height: Math.max(viewH, needH),
  };
}

/**
 * 把 viewport 坐标（鼠标事件的 clientX/clientY）换算成画布坐标。
 *
 * 画布容器在内容装不下时会是**滚动容器**，`getBoundingClientRect()` 给出的是
 * 「可视框」位置，滚动后它会随内容上移。因此必须把容器的滚动偏移加回来 ——
 * 否则画布一滚动，鼠标位置与图元位置就整体错位（拖拽看起来「跳」）。
 *
 * 未滚动时 scrollLeft/scrollTop 恒为 0，因此这个换算与修复前**逐像素等价**。
 */
export function toCanvasPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  scroll: { scrollLeft: number; scrollTop: number },
): { x: number; y: number } {
  return {
    x: clientX - rect.left + (scroll?.scrollLeft || 0),
    y: clientY - rect.top + (scroll?.scrollTop || 0),
  };
}
