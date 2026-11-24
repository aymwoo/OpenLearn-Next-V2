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
    expect(getPagesForSegment(segs[1], 1, pages, segs).map((x) => x.page.id)).toEqual(['p0']);
  });

  it('无绑定时共享页在每个环节都可见，与编辑器页面大纲一致', () => {
    const pages = [{ id: 'p0' }, { id: 'p1' }];
    expect(getPagesForSegment(segs[0], 0, pages, segs).map((x) => x.page.id)).toEqual(['p0', 'p1']);
    expect(getPagesForSegment(segs[1], 1, pages, segs).map((x) => x.page.id)).toEqual(['p0', 'p1']);
  });

  it('共享页从环节 A 隐藏后，环节 A 只保留其它共享页', () => {
    const pages = [{ id: 'p0', excludedSegmentIds: ['a'] }, { id: 'p1' }];
    expect(getPagesForSegment(segs[0], 0, pages, segs).map((x) => x.page.id)).toEqual(['p1']);
    expect(getPagesForSegment(segs[1], 1, pages, segs).map((x) => x.page.id)).toEqual(['p0', 'p1']);
  });

  it('环节 targetPages 优先决定页面列表（支持每环节 1~N 页）', () => {
    const pages = [{ id: 'p0' }, { id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    const targeted = [
      { id: 'a', targetPages: [1, 2] },
      { id: 'b', targetPages: [3] },
    ];
    expect(getPagesForSegment(targeted[0], 0, pages, targeted).map((x) => x.page.id)).toEqual(['p1', 'p2']);
    expect(getPagesForSegment(targeted[1], 1, pages, targeted).map((x) => x.page.id)).toEqual(['p3']);
  });

  it('targetPages 越界或已隐藏的下标被忽略', () => {
    const pages = [{ id: 'p0', excludedSegmentIds: ['a'] }, { id: 'p1' }];
    const targeted = [{ id: 'a', targetPages: [0, 1, 9] }];
    expect(getPagesForSegment(targeted[0], 0, pages, targeted).map((x) => x.page.id)).toEqual(['p1']);
  });
});
