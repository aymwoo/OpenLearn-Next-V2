import { describe, it, expect } from 'vitest';
import { getPagesForSegment } from '../get-pages-for-segment';

describe('getPagesForSegment', () => {
  const segs = [{ id: 'a' }, { id: 'b' }];

  it('显式 segmentId 绑定优先', () => {
    const pages = [
      { id: 'p0', segmentId: 'b' },
      { id: 'p1', segmentId: 'a' },
    ];
    expect(getPagesForSegment(segs[0], 0, pages, segs).map((x) => x.page.id)).toEqual(['p1']);
  });

  it('无绑定时 1:1 按索引归属', () => {
    const pages = [{ id: 'p0' }, { id: 'p1' }];
    expect(getPagesForSegment(segs[1], 1, pages, segs)[0]?.page.id).toBe('p1');
  });
});
