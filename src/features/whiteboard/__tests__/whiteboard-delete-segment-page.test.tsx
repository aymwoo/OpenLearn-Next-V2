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
});
