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

  it('共享页从环节 A 隐藏后，环节 B 的对应页仍在', () => {
    const pages = [{ id: 'p0', excludedSegmentIds: ['a'] }, { id: 'p1' }];
    expect(getPagesForSegment(segs[0], 0, pages, segs)).toEqual([]);
    expect(getPagesForSegment(segs[1], 1, pages, segs).map((x) => x.page.id)).toEqual(['p1']);
  });

  it('多页均分时，隐藏环节 A 的一页不会改写环节 B 的切片', () => {
    const pages = [{ id: 'p0' }, { id: 'p1', excludedSegmentIds: ['a'] }, { id: 'p2' }, { id: 'p3' }];
    expect(getPagesForSegment(segs[0], 0, pages, segs).map((x) => x.page.id)).toEqual(['p0']);
    expect(getPagesForSegment(segs[1], 1, pages, segs).map((x) => x.page.id)).toEqual(['p2', 'p3']);
  });
});
