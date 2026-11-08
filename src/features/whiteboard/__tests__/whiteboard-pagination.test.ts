import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WHITEBOARD_PAGES,
  WhiteboardPageItem,
  WhiteboardElementLike,
  createPageItem,
  renamePageItem,
  duplicatePageItem,
  movePageItem,
  belongsToPage,
  filterCurrentPageElements,
  getSegmentVisiblePages,
} from '../utils/pagination-utils';

describe('Interactive Whiteboard Pagination System', () => {
  it('should provide standard default pages', () => {
    expect(DEFAULT_WHITEBOARD_PAGES).toBeDefined();
    expect(DEFAULT_WHITEBOARD_PAGES.length).toBe(3);
    expect(DEFAULT_WHITEBOARD_PAGES[0].title).toContain('P1');
    expect(DEFAULT_WHITEBOARD_PAGES[1].title).toContain('P2');
    expect(DEFAULT_WHITEBOARD_PAGES[2].title).toContain('P3');
  });

  describe('createPageItem (MUT-M1 回归锁)', () => {
    it('creates new page and returns correct next index for page jump', () => {
      const pages: WhiteboardPageItem[] = [...DEFAULT_WHITEBOARD_PAGES];
      const { newPages, newIndex, newPage } = createPageItem(pages, 'P4 · 自定义备课');

      expect(newPages.length).toBe(4);
      expect(newIndex).toBe(3); // MUT-M1: 必须跳转到新页面索引
      expect(newPage.title).toBe('P4 · 自定义备课');
      expect(newPage.order).toBe(3);
      expect(newPage.id).toMatch(/^page-\d+-3$/);
    });

    it('falls back to default title if custom title is omitted', () => {
      const { newPage, newIndex } = createPageItem(DEFAULT_WHITEBOARD_PAGES);
      expect(newIndex).toBe(3);
      expect(newPage.title).toBe('P4 · 备课页面');
      expect(newPage.segmentId).toBeUndefined();
    });

    it('attaches segmentId to newly created page when specified', () => {
      const { newPage } = createPageItem(DEFAULT_WHITEBOARD_PAGES, 'P4 · 探究活动', Date.now(), 'seg-explore');
      expect(newPage.segmentId).toBe('seg-explore');
      expect(newPage.title).toBe('P4 · 探究活动');
    });
  });

  describe('renamePageItem', () => {
    it('renames target page and trims whitespace', () => {
      const pages = renamePageItem(DEFAULT_WHITEBOARD_PAGES, 0, '  P1 · 课堂复习  ');
      expect(pages[0].title).toBe('P1 · 课堂复习');
      expect(pages[1].title).toBe('P2 · 核心讲解');
    });

    it('ignores empty new title and returns unmodified pages', () => {
      const pages = renamePageItem(DEFAULT_WHITEBOARD_PAGES, 0, '   ');
      expect(pages[0].title).toBe('P1 · 引入导入');
    });
  });

  describe('duplicatePageItem', () => {
    it('duplicates target page, appends 副本 and shifts following orders', () => {
      const pagesWithSegment: WhiteboardPageItem[] = [
        ...DEFAULT_WHITEBOARD_PAGES.slice(0, 1),
        { id: 'page-1', title: 'P2 · 核心讲解', order: 1, segmentId: 'seg-explore' },
        DEFAULT_WHITEBOARD_PAGES[2],
      ];
      const result = duplicatePageItem(pagesWithSegment, 1);
      expect(result).not.toBeNull();
      const { newPages, newIndex, newPage } = result!;

      expect(newPages.length).toBe(4);
      expect(newIndex).toBe(2);
      expect(newPage.title).toBe('P2 · 核心讲解 (副本)');
      expect(newPage.order).toBe(2);
      expect(newPage.segmentId).toBe('seg-explore');
      expect(newPages[3].title).toBe('P3 · 互动练习');
      expect(newPages[3].order).toBe(3);
    });

    it('returns null if target index is invalid', () => {
      const result = duplicatePageItem(DEFAULT_WHITEBOARD_PAGES, 99);
      expect(result).toBeNull();
    });
  });

  describe('movePageItem', () => {
    it('swaps pages left and updates orders', () => {
      const result = movePageItem(DEFAULT_WHITEBOARD_PAGES, 1, 'left');
      expect(result).not.toBeNull();
      const { newPages, targetIndex } = result!;

      expect(targetIndex).toBe(0);
      expect(newPages[0].title).toContain('P2');
      expect(newPages[0].order).toBe(0);
      expect(newPages[1].title).toContain('P1');
      expect(newPages[1].order).toBe(1);
    });

    it('swaps pages right and updates orders', () => {
      const result = movePageItem(DEFAULT_WHITEBOARD_PAGES, 1, 'right');
      expect(result).not.toBeNull();
      const { newPages, targetIndex } = result!;

      expect(targetIndex).toBe(2);
      expect(newPages[1].title).toContain('P3');
      expect(newPages[2].title).toContain('P2');
    });

    it('returns null for out of boundary moves', () => {
      expect(movePageItem(DEFAULT_WHITEBOARD_PAGES, 0, 'left')).toBeNull();
      expect(movePageItem(DEFAULT_WHITEBOARD_PAGES, 2, 'right')).toBeNull();
    });
  });

  describe('belongsToPage & filterCurrentPageElements (MUT-M6 环节隔离回归锁)', () => {
    const testElements: WhiteboardElementLike[] = [
      { id: 'meta-1', type: 'page_meta', data: JSON.stringify({ pages: [] }) },
      { id: 'el-p0-seg1', type: 'quiz', data: JSON.stringify({ page: 0, segmentId: 'seg-1', question: 'Q1' }) },
      { id: 'el-p0-seg2', type: 'quiz', data: JSON.stringify({ page: 0, segmentId: 'seg-2', question: 'Q2' }) },
      { id: 'el-p0-noseg', type: 'pen', data: JSON.stringify({ page: 0, color: '#000000' }) },
      { id: 'el-p1-seg1', type: 'code-sandbox', data: JSON.stringify({ page: 1, segmentId: 'seg-1', code: 'x' }) },
      { id: 'el-pageId-match', type: 'quiz', data: JSON.stringify({ pageId: 'page-0', segmentId: 'seg-1' }) },
      { id: 'el-corrupt', type: 'pen', data: 'INVALID_JSON_DATA' },
    ];

    it('strictly isolates elements across segments when activeSegmentId is set (MUT-M6 防线)', () => {
      // 当前在第 0 页，且 activeSegmentId = 'seg-1'
      const visible = filterCurrentPageElements(testElements, 0, DEFAULT_WHITEBOARD_PAGES, 'seg-1');

      const visibleIds = visible.map((e) => e.id);
      // 必须包含：第 0 页且 seg-1 的元素，以及第 0 页无 segmentId 的通用元素，以及 pageId 匹配的元素
      expect(visibleIds).toContain('el-p0-seg1');
      expect(visibleIds).toContain('el-p0-noseg');
      expect(visibleIds).toContain('el-pageId-match');

      // 关键断言（MUT-M6）：第 0 页但属于 seg-2 的元素必须被严格隔离排除！
      expect(visibleIds).not.toContain('el-p0-seg2');

      // 其他页面的元素不得泄漏
      expect(visibleIds).not.toContain('el-p1-seg1');

      // page_meta 永远不可见
      expect(visibleIds).not.toContain('meta-1');
    });

    it('shows all elements of page when activeSegmentId is null or not provided', () => {
      const visible = filterCurrentPageElements(testElements, 0, DEFAULT_WHITEBOARD_PAGES, null);
      const visibleIds = visible.map((e) => e.id);

      expect(visibleIds).toContain('el-p0-seg1');
      expect(visibleIds).toContain('el-p0-seg2');
      expect(visibleIds).toContain('el-p0-noseg');
      expect(visibleIds).toContain('el-pageId-match');
      expect(visibleIds).not.toContain('el-p1-seg1');
    });

    it('safely handles corrupted JSON by falling back to page 0', () => {
      expect(belongsToPage({ id: 'bad', type: 'pen', data: '{bad' }, 0, DEFAULT_WHITEBOARD_PAGES)).toBe(true);
      expect(belongsToPage({ id: 'bad', type: 'pen', data: '{bad' }, 1, DEFAULT_WHITEBOARD_PAGES)).toBe(false);
    });
  });

  describe('getSegmentVisiblePages (Issue #402 大纲环节隔离)', () => {
    const multiSegmentPages: WhiteboardPageItem[] = [
      { id: 'page-intro', title: 'P1 · 课前导入', order: 0, segmentId: 'seg-intro' },
      { id: 'page-explore-1', title: 'P1 · 互动课件', order: 1, segmentId: 'seg-explore' },
      { id: 'page-explore-2', title: 'P2 · 作品提交', order: 2, segmentId: 'seg-explore' },
      { id: 'page-summary', title: 'P1 · 课后小结', order: 3, segmentId: 'seg-summary' },
      { id: 'page-global', title: '通用页面', order: 4 }, // 无 segmentId
    ];

    it('returns all pages when activeSegmentId is null or undefined', () => {
      expect(getSegmentVisiblePages(multiSegmentPages)).toHaveLength(5);
      expect(getSegmentVisiblePages(multiSegmentPages, null)).toHaveLength(5);
    });

    it('filters pages strictly matching activeSegmentId plus universal pages', () => {
      const explorePages = getSegmentVisiblePages(multiSegmentPages, 'seg-explore');
      const ids = explorePages.map((p) => p.id);
      expect(ids).toEqual(['page-explore-1', 'page-explore-2', 'page-global']);

      const introPages = getSegmentVisiblePages(multiSegmentPages, 'seg-intro');
      expect(introPages.map((p) => p.id)).toEqual(['page-intro', 'page-global']);

      const summaryPages = getSegmentVisiblePages(multiSegmentPages, 'seg-summary');
      expect(summaryPages.map((p) => p.id)).toEqual(['page-summary', 'page-global']);
    });

    it('returns only universal pages if a segment has no dedicated pages', () => {
      const emptySegPages = getSegmentVisiblePages(multiSegmentPages, 'seg-unknown');
      expect(emptySegPages.map((p) => p.id)).toEqual(['page-global']);
    });
  });
});
