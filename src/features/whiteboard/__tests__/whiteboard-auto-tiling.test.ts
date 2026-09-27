/**
 * 自动平铺算法（auto-tiling）单元测试
 *
 * 纯逻辑测试，不引入 React / Konva / DOM，可直接 node 侧快速回归。
 * 被测模块：src/features/whiteboard/utils/auto-tiling.ts
 */

import { describe, it, expect } from 'vitest';
import {
  computeTiling,
  splitArea,
  fitIntoTile,
  toTileCandidate,
  toTiledGeometry,
  isTileableType,
  geometryKeys,
  extractGeometry,
  sameGeometry,
  NON_TILEABLE_TYPES,
  type TileCandidate,
  type TilingResult,
} from '../utils/auto-tiling';

function makeCandidates(count: number, size = { width: 300, height: 200 }): TileCandidate[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `el-${i}`,
    x: 999, // 故意放一个无意义的位置，验证输出完全由布局决定
    y: 999,
    width: size.width,
    height: size.height,
  }));
}

const CONTAINER = { width: 1600, height: 900 };

describe('splitArea（BSP 二分树）', () => {
  it('count <= 0 返回空数组', () => {
    expect(splitArea({ x: 0, y: 0, width: 100, height: 100 }, 0)).toEqual([]);
    expect(splitArea({ x: 0, y: 0, width: 100, height: 100 }, -3)).toEqual([]);
  });

  it('count = 1 时原样返回该区域', () => {
    const area = { x: 10, y: 20, width: 300, height: 200 };
    expect(splitArea(area, 1)).toEqual([area]);
  });

  it('count = 2 时左右对半', () => {
    const tiles = splitArea({ x: 0, y: 0, width: 1000, height: 500 }, 2);
    expect(tiles).toHaveLength(2);
    expect(tiles[0].width).toBeCloseTo(500);
    expect(tiles[1].width).toBeCloseTo(500);
    // 两块等高，且首块贴在左边
    expect(tiles[0].height).toBeCloseTo(500);
    expect(tiles[1].height).toBeCloseTo(500);
    expect(tiles[0].x).toBe(0);
    expect(tiles[1].x).toBeCloseTo(500);
  });

  it('count = 3 时退化为 i3 经典形态（左 1 + 右上右下）', () => {
    const tiles = splitArea({ x: 0, y: 0, width: 1000, height: 600 }, 3);
    expect(tiles).toHaveLength(3);
    // 左半整块
    expect(tiles[0].x).toBe(0);
    expect(tiles[0].width).toBeCloseTo(1000 / 3);
    expect(tiles[0].height).toBeCloseTo(600);
    // 右半被上下切开
    expect(tiles[1].y).toBe(0);
    expect(tiles[1].height).toBeCloseTo(300);
    expect(tiles[2].y).toBeCloseTo(300);
  });

  it('任意 count 都恰好产出 count 个格子', () => {
    for (let n = 1; n <= 12; n += 1) {
      expect(splitArea({ x: 0, y: 0, width: 1600, height: 900 }, n)).toHaveLength(n);
    }
  });

  it('任意 count 下格子互不重叠且不越界（面积守恒）', () => {
    const area = { x: 24, y: 24, width: 1000, height: 600 };
    for (let n = 1; n <= 12; n += 1) {
      const tiles = splitArea(area, n);
      const totalArea = tiles.reduce((sum, t) => sum + t.width * t.height, 0);
      expect(totalArea).toBeCloseTo(area.width * area.height, 4);

      for (const t of tiles) {
        expect(t.x).toBeGreaterThanOrEqual(area.x - 1e-6);
        expect(t.y).toBeGreaterThanOrEqual(area.y - 1e-6);
        expect(t.x + t.width).toBeLessThanOrEqual(area.x + area.width + 1e-6);
        expect(t.y + t.height).toBeLessThanOrEqual(area.y + area.height + 1e-6);
        expect(t.width).toBeGreaterThan(0);
        expect(t.height).toBeGreaterThan(0);
      }

      for (let i = 0; i < tiles.length; i += 1) {
        for (let j = i + 1; j < tiles.length; j += 1) {
          const a = tiles[i];
          const b = tiles[j];
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          const overlaps = overlapX > 1e-6 && overlapY > 1e-6;
          expect(overlaps).toBe(false);
        }
      }
    }
  });
});

describe('fitIntoTile（保持比例居中）', () => {
  it('不改变宽高比', () => {
    const tile = { x: 0, y: 0, width: 800, height: 600 };
    const fitted = fitIntoTile(tile, 300, 200);
    expect(fitted.width / fitted.height).toBeCloseTo(300 / 200, 6);
  });

  it('受宽度约束时贴边并垂直居中', () => {
    // 极扁的格子：宽度成为瓶颈
    const fitted = fitIntoTile({ x: 0, y: 0, width: 100, height: 1000 }, 300, 100);
    expect(fitted.width).toBeCloseTo(100);
    expect(fitted.height).toBeCloseTo(100 / 3);
    expect(fitted.x).toBeCloseTo(0);
    expect(fitted.y).toBeCloseTo((1000 - 100 / 3) / 2);
  });

  it('绝不溢出格子', () => {
    const tile = { x: 13, y: 29, width: 317, height: 211 };
    const fitted = fitIntoTile(tile, 1920, 1080);
    expect(fitted.x).toBeGreaterThanOrEqual(tile.x);
    expect(fitted.y).toBeGreaterThanOrEqual(tile.y);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(tile.x + tile.width + 1e-6);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(tile.y + tile.height + 1e-6);
  });

  it('maxScale = 1 时不放大元素', () => {
    const fitted = fitIntoTile({ x: 0, y: 0, width: 2000, height: 2000 }, 100, 80, 1);
    expect(fitted.width).toBeCloseTo(100);
    expect(fitted.height).toBeCloseTo(80);
    // 缩放后仍在格子内居中
    expect(fitted.x).toBeCloseTo((2000 - 100) / 2);
    expect(fitted.y).toBeCloseTo((2000 - 80) / 2);
  });

  it('自然尺寸缺失时回退为铺满格子', () => {
    const fitted = fitIntoTile({ x: 0, y: 0, width: 400, height: 200 }, 0, 0);
    expect(fitted.width).toBeCloseTo(400);
    expect(fitted.height).toBeCloseTo(200);
  });
});

describe('geometryKeys / extractGeometry / sameGeometry（平铺快照支撑）', () => {
  it('普通元素用 width/height，圆形用 radius', () => {
    expect(geometryKeys('rect')).toEqual(['x', 'y', 'width', 'height']);
    expect(geometryKeys('circle')).toEqual(['x', 'y', 'radius']);
    expect(geometryKeys()).toEqual(['x', 'y', 'width', 'height']);
  });

  it('extractGeometry 取出对应键并把缺失值归零', () => {
    expect(extractGeometry({ x: 10, y: 20, width: 300, height: 200 })).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    });
    expect(extractGeometry({ x: 5 })).toEqual({ x: 5, y: 0, width: 0, height: 0 });
    expect(extractGeometry({ radius: 30, x: 1, y: 2 }, 'circle')).toEqual({ x: 1, y: 2, radius: 30 });
    // 脏值不产生 NaN
    expect(extractGeometry({ x: 'abc' }).x).toBe(0);
  });

  it('sameGeometry 在 0.5px 容差内判等、容差外判不等', () => {
    const keys = geometryKeys();
    expect(sameGeometry({ x: 10, y: 10, width: 100, height: 100 }, { x: 10.4, y: 10.4, width: 100, height: 100 }, keys)).toBe(true);
    expect(sameGeometry({ x: 10, y: 10, width: 100, height: 100 }, { x: 11, y: 10, width: 100, height: 100 }, keys)).toBe(false);
  });

  it('sameGeometry 只比较传入的键，忽略快照等无关字段', () => {
    const keys = geometryKeys();
    const withSnapshot = { x: 0, y: 0, width: 50, height: 50, __preTile: { x: 9, y: 9, width: 9, height: 9 } };
    expect(sameGeometry(withSnapshot, { x: 0, y: 0, width: 50, height: 50 }, keys)).toBe(true);
  });
});

describe('computeTiling', () => {
  it('空数组 / 非法容器尺寸返回空数组', () => {
    expect(computeTiling([], CONTAINER)).toEqual([]);
    expect(computeTiling(makeCandidates(3), { width: 0, height: 900 })).toEqual([]);
    expect(computeTiling(makeCandidates(3), { width: 1600, height: -10 })).toEqual([]);
  });

  it('输出与输入一一对应且顺序、id 保持不变', () => {
    const candidates = makeCandidates(5);
    const results = computeTiling(candidates, CONTAINER);
    expect(results).toHaveLength(5);
    results.forEach((r, i) => expect(r.id).toBe(candidates[i].id));
  });

  it('padding 之内留有安全边距', () => {
    const results = computeTiling(makeCandidates(1), CONTAINER, { padding: 40 });
    expect(results[0].x).toBeGreaterThanOrEqual(40);
    expect(results[0].y).toBeGreaterThanOrEqual(40);
  });

  it('gap 生效：相邻元素之间不重叠', () => {
    const results = computeTiling(makeCandidates(4), CONTAINER, { gap: 20, padding: 0 });
    for (let i = 0; i < results.length; i += 1) {
      for (let j = i + 1; j < results.length; j += 1) {
        const a = results[i];
        const b = results[j];
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(overlapX > 1e-6 && overlapY > 1e-6).toBe(false);
      }
    }
  });

  it('默认 fill 模式：单个元素精确铺满整个可用区域（i3 行为）', () => {
    const results = computeTiling(makeCandidates(1, { width: 400, height: 300 }), CONTAINER, {
      padding: 0,
      gap: 0,
    });
    expect(results[0].x).toBeCloseTo(0);
    expect(results[0].y).toBeCloseTo(0);
    expect(results[0].width).toBeCloseTo(CONTAINER.width);
    expect(results[0].height).toBeCloseTo(CONTAINER.height);
  });

  it('默认 fill 模式：格子被精确铺满，元素之间只留 gap 不留比例空白', () => {
    // 用一个极端比例的元素验证：若仍走「保持比例」逻辑，宽度必然远小于格子
    const results = computeTiling(makeCandidates(1, { width: 1600, height: 100 }), CONTAINER, {
      padding: 0,
      gap: 0,
    });
    expect(results[0].width).toBeCloseTo(CONTAINER.width);
    expect(results[0].height).toBeCloseTo(CONTAINER.height);
  });

  it('默认 fill 模式：多元素时每格都被自己的元素精确填满（无信箱式留白）', () => {
    const results = computeTiling(makeCandidates(4, { width: 100, height: 100 }), CONTAINER, {
      padding: 0,
      gap: 0,
    });
    results.forEach((r) => {
      expect(r.width).toBeCloseTo(CONTAINER.width / 2);
      expect(r.height).toBeCloseTo(CONTAINER.height / 2);
    });
  });

  it("fillMode: 'fit' 时恢复保持比例居中", () => {
    const results = computeTiling(makeCandidates(1, { width: 400, height: 300 }), CONTAINER, {
      padding: 0,
      gap: 0,
      fillMode: 'fit',
    });
    // 400:300 与 1600:900 不同比，等比放大后由高度触顶，宽度留白并水平居中
    expect(results[0].height).toBeCloseTo(CONTAINER.height);
    expect(results[0].width).toBeCloseTo(1200);
    expect(results[0].x).toBeCloseTo((CONTAINER.width - 1200) / 2);
  });

  it("fillMode: 'fit' 时宽高比得以保持", () => {
    const results = computeTiling(makeCandidates(4, { width: 640, height: 480 }), CONTAINER, {
      fillMode: 'fit',
    });
    results.forEach((r) => {
      expect(r.width / r.height).toBeCloseTo(640 / 480, 6);
    });
  });

  it('所有结果都落在容器可视范围内', () => {
    for (let n = 1; n <= 8; n += 1) {
      const results = computeTiling(makeCandidates(n), CONTAINER);
      for (const r of results) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(CONTAINER.width + 1e-6);
        expect(r.y + r.height).toBeLessThanOrEqual(CONTAINER.height + 1e-6);
      }
    }
  });

  it('幂等：同样的输入连续平铺两次，结果一致（不会越跑越偏）', () => {
    const first = computeTiling(makeCandidates(6), CONTAINER);
    const second = computeTiling(
      first.map((r) => ({ id: r.id, x: r.x, y: r.y, width: r.width, height: r.height })),
      CONTAINER,
    );
    first.forEach((r, i) => {
      expect(second[i].x).toBeCloseTo(r.x, 6);
      expect(second[i].y).toBeCloseTo(r.y, 6);
      expect(second[i].width).toBeCloseTo(r.width, 6);
      expect(second[i].height).toBeCloseTo(r.height, 6);
    });
  });

  it('宽高比在 fit 模式下依然保持（内容不会被拉变形）', () => {
    const candidates = makeCandidates(4, { width: 640, height: 480 });
    const results = computeTiling(candidates, CONTAINER, { fillMode: 'fit' });
    results.forEach((r) => {
      expect(r.width / r.height).toBeCloseTo(640 / 480, 6);
    });
  });

  it('默认 fill 模式下宽高比会随格子变化（i3 拉伸语义），元素重新计算后仍幂等', () => {
    const first = computeTiling(makeCandidates(3, { width: 640, height: 480 }), CONTAINER);
    const second = computeTiling(
      first.map((r) => ({ id: r.id, x: r.x, y: r.y, width: r.width, height: r.height })),
      CONTAINER,
    );
    first.forEach((r, i) => {
      expect(second[i].x).toBeCloseTo(r.x, 6);
      expect(second[i].y).toBeCloseTo(r.y, 6);
      expect(second[i].width).toBeCloseTo(r.width, 6);
      expect(second[i].height).toBeCloseTo(r.height, 6);
    });
  });
});

describe('toTileCandidate / toTiledGeometry', () => {
  it('page_meta / pen / highlighter 不可平铺', () => {
    for (const type of NON_TILEABLE_TYPES) {
      expect(isTileableType(type)).toBe(false);
      expect(toTileCandidate({ id: 'x', type }, {}, { width: 10, height: 10 })).toBeNull();
    }
  });

  it('普通元素读取顶层 x/y/width/height', () => {
    const c = toTileCandidate(
      { id: 'a', type: 'text' },
      { x: 10, y: 20, width: 300, height: 120 },
      { width: 200, height: 100 },
    );
    expect(c).toEqual({ id: 'a', x: 10, y: 20, width: 300, height: 120 });
  });

  it('缺省 width/height 时回退到类型默认尺寸', () => {
    const c = toTileCandidate({ id: 'a', type: 'quiz' }, { x: 0, y: 0 }, { width: 300, height: 280 });
    expect(c?.width).toBe(300);
    expect(c?.height).toBe(280);
  });

  it('缺失 x/y 归一化为 0，不产生 NaN', () => {
    const c = toTileCandidate({ id: 'a', type: 'rect' }, {}, { width: 100, height: 80 });
    expect(c?.x).toBe(0);
    expect(c?.y).toBe(0);
    expect(Number.isNaN(c?.x ?? NaN)).toBe(false);
  });

  it('圆形：包围盒取 2×radius，并标记 shape=circle', () => {
    const c = toTileCandidate({ id: 'c', type: 'circle' }, { x: 5, y: 6, radius: 30 }, { width: 40, height: 40 });
    expect(c?.shape).toBe('circle');
    expect(c?.width).toBe(60);
    expect(c?.height).toBe(60);
  });

  it('圆形：fill 模式下取格子内切圆（不撑成椭圆）', () => {
    const candidate = toTileCandidate({ id: 'c', type: 'circle' }, { radius: 30 }, { width: 40, height: 40 })!;
    // 一个 800x400 的非方形格子
    const [result] = computeTiling([candidate], { width: 800, height: 400 }, { padding: 0, gap: 0 });
    const geo = toTiledGeometry(candidate, result) as { x: number; y: number; radius: number };
    expect(geo.radius).toBeCloseTo(200); // 短边 400 的一半
    expect(geo.x).toBeCloseTo(400); // 圆心仍在格子中心
    expect(geo.y).toBeCloseTo(200);
  });

  it('圆形写回时改写 radius 而非 width/height（否则改动会静默失效）', () => {
    const c = toTileCandidate({ id: 'c', type: 'circle' }, { radius: 30 }, { width: 40, height: 40 })!;
    const result: TilingResult = { id: 'c', x: 100, y: 200, width: 80, height: 60 };
    const geo = toTiledGeometry(c, result) as { x: number; y: number; radius: number };
    expect(geo.radius).toBe(30);
    // 圆心落在结果矩形中心
    expect(geo.x).toBeCloseTo(140);
    expect(geo.y).toBeCloseTo(230);
    expect('width' in geo).toBe(false);
  });

  it('普通元素写回 x/y/width/height', () => {
    const c = toTileCandidate({ id: 'r', type: 'rect' }, {}, { width: 10, height: 10 })!;
    const geo = toTiledGeometry(c, { id: 'r', x: 1, y: 2, width: 300, height: 200 });
    expect(geo).toEqual({ x: 1, y: 2, width: 300, height: 200 });
  });
});
