import { describe, it, expect } from 'vitest';
import { computeContentBounds, resolveCanvasSize, toCanvasPoint } from '../canvas-bounds';

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
