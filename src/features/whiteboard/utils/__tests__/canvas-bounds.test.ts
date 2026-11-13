import { describe, it, expect } from 'vitest';
import { computeContentBounds, resolveCanvasLayout, resolveCanvasSize, toCanvasPoint } from '../canvas-bounds';

describe('canvas-bounds', () => {
  describe('computeContentBounds', () => {
    it('空图元集合返回 0', () => {
      expect(computeContentBounds([])).toEqual({ maxX: 0, maxY: 0 });
    });

    it('取所有图元的右下角最大值', () => {
      const bounds = computeContentBounds([
        { x: 10, y: 20, width: 100, height: 50 },
        { x: 300, y: 40, width: 200, height: 80 },
        { x: 0, y: 900, width: 40, height: 40 },
      ]);
      expect(bounds).toEqual({ maxX: 500, maxY: 940 });
    });

    it('负坐标不产生负的包围盒（左上角不参与扩展）', () => {
      const bounds = computeContentBounds([{ x: -50, y: -30, width: 100, height: 60 }]);
      expect(bounds).toEqual({ maxX: 50, maxY: 30 });
    });

    it('非法数值按 0 处理，不污染结果', () => {
      const bounds = computeContentBounds([
        { x: Number.NaN, y: Number.NaN, width: Number.NaN, height: Number.NaN },
        { x: 20, y: 30, width: 40, height: 50 },
      ]);
      expect(bounds).toEqual({ maxX: 60, maxY: 80 });
    });

    it('负的宽高按 0 处理', () => {
      const bounds = computeContentBounds([{ x: 100, y: 100, width: -50, height: -50 }]);
      expect(bounds).toEqual({ maxX: 100, maxY: 100 });
    });
  });

  describe('resolveCanvasSize', () => {
    it('内容装得下时画布等于容器（不凭空多出滚动条）', () => {
      const size = resolveCanvasSize({ width: 800, height: 600 }, { maxX: 300, maxY: 200 }, 40);
      expect(size).toEqual({ width: 800, height: 600 });
    });

    it('内容超出容器时画布撑到内容高度（容器负责滚动）', () => {
      const size = resolveCanvasSize({ width: 800, height: 300 }, { maxX: 300, maxY: 1600 }, 40);
      expect(size).toEqual({ width: 800, height: 1640 });
    });

    it('宽度方向同样会撑开', () => {
      const size = resolveCanvasSize({ width: 400, height: 600 }, { maxX: 900, maxY: 100 }, 0);
      expect(size).toEqual({ width: 900, height: 600 });
    });

    it('容器尺寸为 0 时不会算出负尺寸', () => {
      const size = resolveCanvasSize({ width: 0, height: 0 }, { maxX: 0, maxY: 0 }, 0);
      expect(size).toEqual({ width: 0, height: 0 });
    });
  });

  /**
   * 用「当前 client 盒（会随滚动条显隐变化）」反复调用 resolveCanvasSize，
   * 模拟 ResizeObserver 把测量值写回画布尺寸的过程。
   */
  type LayoutFrame = {
    client: { width: number; height: number };
    canvas: { width: number; height: number };
    overflowX: boolean;
    overflowY: boolean;
  };

  function iterateClientCoupledLayout(
    paddingBox: { width: number; height: number },
    content: { maxX: number; maxY: number },
    padding: number,
    scrollbarSize: number,
    maxFrames = 8,
  ): { settled: boolean; frames: LayoutFrame[] } {
    let hasOverflowX = false;
    let hasOverflowY = false;
    const frames: LayoutFrame[] = [];

    for (let i = 0; i < maxFrames; i++) {
      const client: LayoutFrame['client'] = {
        width: Math.max(0, paddingBox.width - (hasOverflowY ? scrollbarSize : 0)),
        height: Math.max(0, paddingBox.height - (hasOverflowX ? scrollbarSize : 0)),
      };
      const canvas = resolveCanvasSize(client, content, padding);
      const nextX: boolean = canvas.width > client.width;
      const nextY: boolean = canvas.height > client.height;
      frames.push({ client, canvas, overflowX: nextX, overflowY: nextY });
      if (nextX === hasOverflowX && nextY === hasOverflowY) {
        return { settled: true, frames };
      }
      hasOverflowX = nextX;
      hasOverflowY = nextY;
    }
    return { settled: false, frames };
  }

  describe('resolveCanvasLayout', () => {
    const scrollbar = 15;
    const box = { width: 800, height: 600 };

    it('内容装得下时与 resolveCanvasSize 一致，且不出现滚动条', () => {
      const content = { maxX: 300, maxY: 200 };
      const layout = resolveCanvasLayout(box, content, 40, scrollbar);
      expect(layout.canvas).toEqual(resolveCanvasSize(box, content, 40));
      expect(layout.overflowX).toBe(false);
      expect(layout.overflowY).toBe(false);
    });

    it('仅纵向溢出时一次性预留垂直滚动条宽度，避免第二帧再把画布宽度收缩', () => {
      const content = { maxX: 300, maxY: 1600 };
      const padding = 80;
      const layout = resolveCanvasLayout(box, content, padding, scrollbar);

      expect(layout.overflowY).toBe(true);
      expect(layout.overflowX).toBe(false);
      expect(layout.canvas).toEqual({
        width: box.width - scrollbar,
        height: 1680,
      });
    });

    it('client 耦合测量会在滚动条出现后改写画布宽度；新算法首帧即给出稳定终态', () => {
      const content = { maxX: 300, maxY: 1600 };
      const padding = 80;
      const iterated = iterateClientCoupledLayout(box, content, padding, scrollbar);

      expect(iterated.settled).toBe(true);
      expect(iterated.frames.length).toBeGreaterThan(1);
      expect(iterated.frames[0].canvas.width).toBe(box.width);
      expect(iterated.frames[iterated.frames.length - 1].canvas.width).toBe(box.width - scrollbar);

      const layout = resolveCanvasLayout(box, content, padding, scrollbar);
      const last = iterated.frames[iterated.frames.length - 1];
      expect(layout.canvas).toEqual(last.canvas);
      expect(layout.overflowX).toBe(last.overflowX);
      expect(layout.overflowY).toBe(last.overflowY);

      // 再次以同一 padding box 计算，结果不得再变。
      expect(resolveCanvasLayout(box, content, padding, scrollbar)).toEqual(layout);
    });

    it('临界溢出、增减内容与交叉轴溢出都能一次收敛到稳定布局', () => {
      const cases = [
        { name: 'fits', content: { maxX: 300, maxY: 200 }, padding: 80 },
        { name: 'tall only', content: { maxX: 300, maxY: 1600 }, padding: 80 },
        { name: 'wide only', content: { maxX: 1200, maxY: 200 }, padding: 80 },
        { name: 'both', content: { maxX: 1200, maxY: 1600 }, padding: 80 },
        { name: 'needH just over padding box', content: { maxX: 100, maxY: 521 }, padding: 80 },
        { name: 'content just fits including padding', content: { maxX: 100, maxY: 520 }, padding: 80 },
        { name: 'full-width content that is slightly taller', content: { maxX: 800, maxY: 601 }, padding: 0 },
        { name: 'needW between gutter and padding box, tall', content: { maxX: 790, maxY: 700 }, padding: 0 },
        { name: 'content near the vertical threshold', content: { maxX: 100, maxY: 519 }, padding: 80 },
      ];

      for (const c of cases) {
        const iterated = iterateClientCoupledLayout(box, c.content, c.padding, scrollbar);
        expect(iterated.settled, c.name).toBe(true);
        const last = iterated.frames[iterated.frames.length - 1];
        const layout = resolveCanvasLayout(box, c.content, c.padding, scrollbar);

        expect(layout.canvas, c.name).toEqual(last.canvas);
        expect(layout.overflowX, c.name).toBe(last.overflowX);
        expect(layout.overflowY, c.name).toBe(last.overflowY);
        expect(resolveCanvasLayout(box, c.content, c.padding, scrollbar), c.name).toEqual(layout);
      }
    });

    it('滚动条厚度为 0（overlay）时与 resolveCanvasSize 逐像素等价', () => {
      const content = { maxX: 300, maxY: 1600 };
      const layout = resolveCanvasLayout(box, content, 80, 0);
      expect(layout.canvas).toEqual(resolveCanvasSize(box, content, 80));
      expect(layout.overflowY).toBe(true);
      expect(layout.overflowX).toBe(false);
    });

    it('窗口变高到能装下内容后，滚动条消失且画布回到容器尺寸', () => {
      const content = { maxX: 300, maxY: 520 };
      const padding = 80;
      const overflowing = resolveCanvasLayout({ width: 800, height: 500 }, content, padding, scrollbar);
      expect(overflowing.overflowY).toBe(true);

      const fits = resolveCanvasLayout({ width: 800, height: 700 }, content, padding, scrollbar);
      expect(fits.overflowY).toBe(false);
      expect(fits.overflowX).toBe(false);
      expect(fits.canvas).toEqual({ width: 800, height: 700 });
    });

    it('非法输入不会得到负尺寸', () => {
      const layout = resolveCanvasLayout({ width: 0, height: 0 }, { maxX: Number.NaN, maxY: -10 }, -4, -8);
      expect(layout.canvas).toEqual({ width: 0, height: 0 });
      expect(layout.overflowX).toBe(false);
      expect(layout.overflowY).toBe(false);
    });
  });

  describe('toCanvasPoint', () => {
    it('未滚动时与旧的换算逐像素等价', () => {
      const p = toCanvasPoint(150, 250, { left: 100, top: 200 }, { scrollLeft: 0, scrollTop: 0 });
      expect(p).toEqual({ x: 50, y: 50 });
    });

    it('容器纵向滚动后必须把 scrollTop 加回来', () => {
      const p = toCanvasPoint(150, 250, { left: 100, top: 150 }, { scrollLeft: 0, scrollTop: 50 });
      expect(p).toEqual({ x: 50, y: 150 });
    });

    it('容器双向滚动时两个偏移都要加回来', () => {
      const p = toCanvasPoint(150, 250, { left: 100, top: 150 }, { scrollLeft: 30, scrollTop: 50 });
      expect(p).toEqual({ x: 80, y: 150 });
    });

    it('缺少 scroll 信息时按 0 处理', () => {
      const p = toCanvasPoint(150, 250, { left: 100, top: 200 }, undefined as never);
      expect(p).toEqual({ x: 50, y: 50 });
    });
  });
});
