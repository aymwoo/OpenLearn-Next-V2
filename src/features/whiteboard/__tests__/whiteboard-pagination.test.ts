import { describe, it, expect } from 'vitest';
import { DEFAULT_WHITEBOARD_PAGES, WhiteboardPageItem } from '../InteractiveWhiteboard';

describe('Interactive Whiteboard Pagination System', () => {
  it('should provide standard default pages', () => {
    expect(DEFAULT_WHITEBOARD_PAGES).toBeDefined();
    expect(DEFAULT_WHITEBOARD_PAGES.length).toBe(3);
    expect(DEFAULT_WHITEBOARD_PAGES[0].title).toContain('P1');
    expect(DEFAULT_WHITEBOARD_PAGES[1].title).toContain('P2');
    expect(DEFAULT_WHITEBOARD_PAGES[2].title).toContain('P3');
  });

  it('should generate new page items with order and title', () => {
    const pages: WhiteboardPageItem[] = [...DEFAULT_WHITEBOARD_PAGES];
    const newIdx = pages.length;
    const newPage: WhiteboardPageItem = {
      id: `page-test-${newIdx}`,
      title: `P${newIdx + 1} · 备课页面`,
      order: newIdx,
    };
    pages.push(newPage);

    expect(pages.length).toBe(4);
    expect(pages[3].title).toBe('P4 · 备课页面');
    expect(pages[3].order).toBe(3);
  });

  it('should rename a page correctly', () => {
    const pages: WhiteboardPageItem[] = [...DEFAULT_WHITEBOARD_PAGES];
    const targetIdx = 0;
    const newTitle = 'P1 · 课堂复习';
    const updatedPages = pages.map((p, i) => (i === targetIdx ? { ...p, title: newTitle } : p));

    expect(updatedPages[0].title).toBe('P1 · 课堂复习');
    expect(updatedPages[1].title).toBe('P2 · 核心讲解');
  });

  it('should duplicate a page correctly', () => {
    const pages: WhiteboardPageItem[] = [...DEFAULT_WHITEBOARD_PAGES];
    const targetIdx = 1;
    const sourcePage = pages[targetIdx];
    const newIdx = targetIdx + 1;
    const newPage: WhiteboardPageItem = {
      id: `page-dup-${Date.now()}`,
      title: `${sourcePage.title} (副本)`,
      order: newIdx,
    };

    const updatedPages = [
      ...pages.slice(0, newIdx),
      newPage,
      ...pages.slice(newIdx).map((p) => ({ ...p, order: p.order + 1 })),
    ];

    expect(updatedPages.length).toBe(4);
    expect(updatedPages[2].title).toBe('P2 · 核心讲解 (副本)');
    expect(updatedPages[3].title).toBe('P3 · 互动练习');
  });

  it('should move pages left and right', () => {
    const pages: WhiteboardPageItem[] = [...DEFAULT_WHITEBOARD_PAGES];
    // Move index 1 to left (swap index 0 and index 1)
    const nextPages = [...pages];
    const temp = nextPages[0];
    nextPages[0] = nextPages[1];
    nextPages[1] = temp;
    nextPages.forEach((p, i) => { p.order = i; });

    expect(nextPages[0].title).toContain('P2');
    expect(nextPages[1].title).toContain('P1');
  });

  it('should strictly isolate elements between P1, P2, P3 even if activeSegmentId is set', () => {
    const elements = [
      { id: 'el-1', type: 'quiz', data: JSON.stringify({ page: 0, segmentId: 'seg-1', question: 'P1 Quiz' }) },
      { id: 'el-2', type: 'pen', data: JSON.stringify({ page: 1, segmentId: 'seg-1', color: '#ff0000' }) },
      { id: 'el-3', type: 'code-sandbox', data: JSON.stringify({ page: 2, segmentId: 'seg-1', code: 'console.log(3)' }) },
    ];

    const pages = DEFAULT_WHITEBOARD_PAGES;
    const activeSegmentId = 'seg-1';

    const filterForPage = (currentPage: number) => {
      return elements.filter((el) => {
        if (el.type === 'page_meta') return false;
        try {
          const d = JSON.parse(el.data);
          const elPage = d.page ?? 0;
          const currentObj = pages[currentPage];
          const pageMatches = (d.pageId && currentObj?.id) ? d.pageId === currentObj.id : elPage === currentPage;
          if (!pageMatches) return false;
          if (activeSegmentId && d.segmentId && d.segmentId !== activeSegmentId) return false;
          return true;
        } catch {
          return currentPage === 0;
        }
      });
    };

    const p1Elements = filterForPage(0);
    const p2Elements = filterForPage(1);
    const p3Elements = filterForPage(2);

    expect(p1Elements.length).toBe(1);
    expect(p1Elements[0].id).toBe('el-1');

    expect(p2Elements.length).toBe(1);
    expect(p2Elements[0].id).toBe('el-2');

    expect(p3Elements.length).toBe(1);
    expect(p3Elements[0].id).toBe('el-3');
  });
});
