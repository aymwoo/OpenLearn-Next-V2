import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWhiteboardPages } from '../hooks/useWhiteboardPages';

describe('useWhiteboardPages segment delete isolation (Issue #557)', () => {
  it('deleting page N in segment A does not remove segment B pages or elements', () => {
    const pages = [
      { id: 'page-n0', title: '第 1 页', order: 0 },
      { id: 'page-n1', title: '第 2 页', order: 1 },
    ];
    const elements = [
      { id: 'meta', type: 'page_meta', data: JSON.stringify({ pages }) },
      { id: 'a-p1', type: 'text', data: JSON.stringify({ page: 1, segmentId: 'seg-a', text: 'A' }) },
      { id: 'b-p1', type: 'text', data: JSON.stringify({ page: 1, segmentId: 'seg-b', text: 'B' }) },
    ];
    const onElementDelete = vi.fn();
    const onElementUpdate = vi.fn();

    const { result } = renderHook(() =>
      useWhiteboardPages({
        elements,
        safeElements: elements,
        activeSegmentId: 'seg-a',
        lessonId: 'lesson-1',
        userRole: 'teacher',
        socketRef: { current: null },
        onElementDelete,
        onElementUpdate,
        setDialog: (dialog) => {
          dialog?.onConfirm();
        },
      }),
    );

    act(() => {
      result.current.handleDeletePage(1);
    });

    expect(onElementDelete).toHaveBeenCalledTimes(1);
    expect(onElementDelete).toHaveBeenCalledWith('a-p1');
    expect(onElementUpdate).toHaveBeenCalledWith(
      'meta',
      expect.objectContaining({
        pages: [
          expect.objectContaining({ id: 'page-n0' }),
          expect.objectContaining({ id: 'page-n1', excludedSegmentIds: ['seg-a'] }),
        ],
      }),
    );
    expect(result.current.pages.map((page) => page.id)).toEqual(['page-n0', 'page-n1']);
    expect(result.current.pages.find((page) => page.id === 'page-n1')?.excludedSegmentIds).toEqual(['seg-a']);
  });

  it('deleting a segment-owned page leaves the other segment page list intact', () => {
    const pages = [
      { id: 'a-0', title: 'A1', order: 0, segmentId: 'seg-a' },
      { id: 'a-1', title: 'A2', order: 1, segmentId: 'seg-a' },
      { id: 'b-0', title: 'B1', order: 2, segmentId: 'seg-b' },
      { id: 'b-1', title: 'B2', order: 3, segmentId: 'seg-b' },
    ];
    const elements = [
      { id: 'meta', type: 'page_meta', data: JSON.stringify({ pages }) },
      { id: 'a-body', type: 'text', data: JSON.stringify({ page: 0, pageId: 'a-0', segmentId: 'seg-a' }) },
      { id: 'b-body', type: 'text', data: JSON.stringify({ page: 0, pageId: 'b-0', segmentId: 'seg-b' }) },
    ];
    const onElementDelete = vi.fn();
    const onElementUpdate = vi.fn();

    const { result } = renderHook(() =>
      useWhiteboardPages({
        elements,
        safeElements: elements,
        activeSegmentId: 'seg-a',
        lessonId: 'lesson-1',
        userRole: 'teacher',
        socketRef: { current: null },
        onElementDelete,
        onElementUpdate,
        setDialog: (dialog) => {
          dialog?.onConfirm();
        },
      }),
    );

    act(() => {
      result.current.handleDeletePage(0);
    });

    expect(onElementDelete).toHaveBeenCalledTimes(1);
    expect(onElementDelete).toHaveBeenCalledWith('a-body');
    const saved = onElementUpdate.mock.calls[0]?.[1] as { pages: Array<{ id: string }> };
    expect(saved.pages.map((page) => page.id)).toEqual(['a-1', 'b-0', 'b-1']);
  });

  it('deleting a segment-owned page remaps legacy elements (no pageId) on later pages', () => {
    // Issue IKW19P 原始复现场景：环节 A 删自有页后，环节 B 的旧笔迹（只落全局下标）
    // 若不重映射，会串页或成为孤儿
    const pages = [
      { id: 'a-0', title: 'A1', order: 0, segmentId: 'seg-a' },
      { id: 'b-0', title: 'B1', order: 1, segmentId: 'seg-b' },
      { id: 'b-1', title: 'B2', order: 2, segmentId: 'seg-b' },
    ];
    const elements = [
      { id: 'meta', type: 'page_meta', data: JSON.stringify({ pages }) },
      { id: 'pen-B1', type: 'pen', data: JSON.stringify({ page: 1, segmentId: 'seg-b' }) },
      { id: 'pen-B2', type: 'pen', data: JSON.stringify({ page: 2, segmentId: 'seg-b' }) },
    ];
    const onElementDelete = vi.fn();
    const onElementUpdate = vi.fn();

    const { result } = renderHook(() =>
      useWhiteboardPages({
        elements,
        safeElements: elements,
        activeSegmentId: 'seg-a',
        lessonId: 'lesson-1',
        userRole: 'teacher',
        socketRef: { current: null },
        onElementDelete,
        onElementUpdate,
        setDialog: (dialog) => {
          dialog?.onConfirm();
        },
      }),
    );

    act(() => {
      result.current.handleDeletePage(0);
    });

    expect(result.current.pages.map((page) => page.id)).toEqual(['b-0', 'b-1']);
    // pen-B1(原 page=1) → 现在属于 B-1(idx0)；pen-B2(原 page=2) → 现在属于 B-2(idx1)，并回填 pageId
    expect(onElementUpdate).toHaveBeenCalledWith('pen-B1', { page: 0, pageId: 'b-0' });
    expect(onElementUpdate).toHaveBeenCalledWith('pen-B2', { page: 1, pageId: 'b-1' });
  });

  it('moving a page swaps the page ownership of legacy elements on the two swapped pages', () => {
    const pages = [
      { id: 'b-0', title: 'B1', order: 0, segmentId: 'seg-b' },
      { id: 'b-1', title: 'B2', order: 1, segmentId: 'seg-b' },
    ];
    const elements = [
      { id: 'meta', type: 'page_meta', data: JSON.stringify({ pages }) },
      { id: 'pen-on-B1', type: 'pen', data: JSON.stringify({ page: 0, segmentId: 'seg-b' }) },
      { id: 'pen-on-B2', type: 'pen', data: JSON.stringify({ page: 1, segmentId: 'seg-b' }) },
    ];
    const onElementUpdate = vi.fn();

    const { result } = renderHook(() =>
      useWhiteboardPages({
        elements,
        safeElements: elements,
        activeSegmentId: 'seg-b',
        lessonId: 'lesson-1',
        userRole: 'teacher',
        socketRef: { current: null },
        onElementUpdate,
        setDialog: (dialog) => {
          dialog?.onConfirm();
        },
      }),
    );

    act(() => {
      result.current.handleMovePage(0, 'right');
    });

    expect(result.current.pages.map((page) => page.id)).toEqual(['b-1', 'b-0']);
    // 元素跟随其页面 id 迁移：pen-on-B1 属于 b-0（现 idx1），pen-on-B2 属于 b-1（现 idx0）
    expect(onElementUpdate).toHaveBeenCalledWith('pen-on-B1', { page: 1, pageId: 'b-0' });
    expect(onElementUpdate).toHaveBeenCalledWith('pen-on-B2', { page: 0, pageId: 'b-1' });
  });

  it('duplicating a page shifts legacy elements after the insertion point and keeps pageId on copies', () => {
    const pages = [
      { id: 'b-0', title: 'B1', order: 0, segmentId: 'seg-b' },
      { id: 'b-1', title: 'B2', order: 1, segmentId: 'seg-b' },
    ];
    const elements = [
      { id: 'meta', type: 'page_meta', data: JSON.stringify({ pages }) },
      { id: 'pen-on-B1', type: 'pen', data: JSON.stringify({ page: 0, segmentId: 'seg-b' }) },
      { id: 'pen-on-B2', type: 'pen', data: JSON.stringify({ page: 1, segmentId: 'seg-b' }) },
    ];
    const onElementAdd = vi.fn();
    const onElementUpdate = vi.fn();

    const { result } = renderHook(() =>
      useWhiteboardPages({
        elements,
        safeElements: elements,
        activeSegmentId: 'seg-b',
        lessonId: 'lesson-1',
        userRole: 'teacher',
        socketRef: { current: null },
        onElementAdd,
        onElementUpdate,
        setDialog: (dialog) => {
          dialog?.onConfirm();
        },
      }),
    );

    act(() => {
      result.current.handleDuplicatePage(0);
    });

    // 复制页插到 idx1：原 B2(idx1) 的笔迹下标后移到 idx2
    expect(onElementUpdate).toHaveBeenCalledWith('pen-on-B2', { page: 2, pageId: 'b-1' });
    // 源页笔迹下标不变，不被误移
    expect(onElementUpdate).not.toHaveBeenCalledWith('pen-on-B1', expect.anything());
    // 复制出的元素带稳定 pageId
    const copyCall = onElementAdd.mock.calls[0]?.[1] as { pageId?: string };
    expect(copyCall.pageId).toEqual(expect.stringContaining('page-'));
  });
});
