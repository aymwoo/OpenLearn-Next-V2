import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { LessonPalette } from '../lesson-editor/LessonPalette';
import { TimelineRail } from '../lesson-editor/TimelineRail';
import type { WhiteboardDragState, WhiteboardPageItem } from '../../whiteboard/InteractiveWhiteboard';

describe('LessonEditor Drag To Outline & Timeline (Auto-expand & Drop Targeting)', () => {
  const dummyPages: WhiteboardPageItem[] = [
    { id: 'page-0', title: 'P1 · 导入环节', order: 0 },
    { id: 'page-1', title: 'P2 · 探究环节', order: 1 },
    { id: 'page-2', title: 'P3 · 随堂练习', order: 2 },
  ];

  const dummySegments = [
    { id: 'seg-1', title: '导学引入', duration: '5m', color: 'blue', type: 'lecture' },
    { id: 'seg-2', title: '实验探究', duration: '15m', color: 'emerald', type: 'practice' },
    { id: 'seg-3', title: '课堂小结', duration: '10m', color: 'purple', type: 'wrapup' },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('LessonPalette - Outline hover auto-expand & drop targeting', () => {
    it('detects drag hover and notifies onHoverDropTarget for target page', () => {
      const onHoverDropTarget = vi.fn();

      const { container, rerender } = render(
        <LessonPalette
          lang="zh"
          onActivate={vi.fn()}
          pages={dummyPages}
          currentPage={0}
          dragState={null}
          onHoverDropTarget={onHoverDropTarget}
        />,
      );

      // Initially outline is expanded, no drop target
      expect(screen.getByText('页面大纲 (3)')).toBeDefined();

      // Find the page 2 element in DOM and mock its bounding rect
      const page2El = container.querySelector('[data-page-index="1"]');
      expect(page2El).not.toBeNull();
      if (page2El) {
        vi.spyOn(page2El, 'getBoundingClientRect').mockReturnValue({
          left: 10,
          right: 250,
          top: 100,
          bottom: 140,
          width: 240,
          height: 40,
          x: 10,
          y: 100,
          toJSON: () => {},
        });
      }

      // Also mock outline container bounding rect
      const outlineEl = container.querySelector('.bg-surface.rounded-xl');
      if (outlineEl) {
        vi.spyOn(outlineEl, 'getBoundingClientRect').mockReturnValue({
          left: 0,
          right: 260,
          top: 50,
          bottom: 300,
          width: 260,
          height: 250,
          x: 0,
          y: 50,
          toJSON: () => {},
        });
      }

      // Simulate dragging an element from page 0 over page 1
      const dragState: WhiteboardDragState = {
        elementId: 'el-101',
        elementType: 'quiz',
        elementData: { page: 0 },
        clientX: 100,
        clientY: 120,
        initialPage: 0,
      };

      rerender(
        <LessonPalette
          lang="zh"
          onActivate={vi.fn()}
          pages={dummyPages}
          currentPage={0}
          dragState={dragState}
          onHoverDropTarget={onHoverDropTarget}
        />,
      );

      // Should notify drop target for pageIndex 1
      expect(onHoverDropTarget).toHaveBeenCalledWith({ type: 'page', pageIndex: 1 });
      // Should render the drop prompt
      expect(screen.getByText('松开移入')).toBeDefined();
    });

    it('auto-expands collapsed outline after 250ms hover', () => {
      const { container, rerender } = render(
        <LessonPalette lang="zh" onActivate={vi.fn()} pages={dummyPages} currentPage={0} dragState={null} />,
      );

      // Click to collapse outline
      const collapseBtn = screen.getByText('页面大纲 (3)');
      act(() => {
        collapseBtn.click();
      });

      // Outline should now be collapsed (showing brief)
      expect(screen.getByText(/当前:/)).toBeDefined();

      // Mock outline card bounding rect
      const outlineEl = container.querySelector('.bg-surface.rounded-xl');
      if (outlineEl) {
        vi.spyOn(outlineEl, 'getBoundingClientRect').mockReturnValue({
          left: 0,
          right: 260,
          top: 50,
          bottom: 120,
          width: 260,
          height: 70,
          x: 0,
          y: 50,
          toJSON: () => {},
        });
      }

      // Drag over the collapsed outline
      const dragState: WhiteboardDragState = {
        elementId: 'el-101',
        elementType: 'quiz',
        elementData: { page: 0 },
        clientX: 100,
        clientY: 80,
        initialPage: 0,
      };

      rerender(
        <LessonPalette lang="zh" onActivate={vi.fn()} pages={dummyPages} currentPage={0} dragState={dragState} />,
      );

      // Fast-forward 250ms
      act(() => {
        vi.advanceTimersByTime(260);
      });

      // Outline should now automatically be expanded!
      expect(screen.getByText('P2 · 探究环节')).toBeDefined();
    });
  });

  describe('TimelineRail - Segment hover auto-expand & drop targeting', () => {
    it('detects drag hover and notifies onHoverDropTarget for target segment', () => {
      const onHoverDropTarget = vi.fn();

      const { container, rerender } = render(
        <TimelineRail
          lang="zh"
          segments={dummySegments}
          activeSegmentId="seg-1"
          setActiveSegmentId={vi.fn()}
          draggedSegmentIdx={null}
          setDraggedSegmentIdx={vi.fn()}
          selectedLesson="lesson-1"
          saveTimeline={vi.fn()}
          editorPanelsExpanded={true}
          setEditorPanelsExpanded={vi.fn()}
          dragState={null}
          onHoverDropTarget={onHoverDropTarget}
        />,
      );

      // Mock rail container bounding rect
      const railEl = container.firstChild as HTMLElement;
      vi.spyOn(railEl, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        right: 1000,
        top: 0,
        bottom: 50,
        width: 1000,
        height: 50,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Mock segment 2 element bounding rect
      const seg2El = container.querySelector('[data-segment-id="seg-2"]');
      expect(seg2El).not.toBeNull();
      if (seg2El) {
        vi.spyOn(seg2El, 'getBoundingClientRect').mockReturnValue({
          left: 200,
          right: 350,
          top: 5,
          bottom: 45,
          width: 150,
          height: 40,
          x: 200,
          y: 5,
          toJSON: () => {},
        });
      }

      // Drag an element from seg-1 over seg-2
      const dragState: WhiteboardDragState = {
        elementId: 'el-202',
        elementType: 'code-sandbox',
        elementData: { segmentId: 'seg-1' },
        clientX: 250,
        clientY: 25,
        initialPage: 0,
        initialSegmentId: 'seg-1',
      };

      rerender(
        <TimelineRail
          lang="zh"
          segments={dummySegments}
          activeSegmentId="seg-1"
          setActiveSegmentId={vi.fn()}
          draggedSegmentIdx={null}
          setDraggedSegmentIdx={vi.fn()}
          selectedLesson="lesson-1"
          saveTimeline={vi.fn()}
          editorPanelsExpanded={true}
          setEditorPanelsExpanded={vi.fn()}
          dragState={dragState}
          onHoverDropTarget={onHoverDropTarget}
        />,
      );

      // Should notify drop target for segment seg-2
      expect(onHoverDropTarget).toHaveBeenCalledWith({ type: 'segment', segmentId: 'seg-2' });
      // Should render the drop prompt
      expect(screen.getByText('移入此环节')).toBeDefined();
    });

    it('does not auto-expand segment settings details when dragging over timeline to keep timeline fixed and avoid layout disruption', () => {
      const setEditorPanelsExpanded = vi.fn();

      const { container, rerender } = render(
        <TimelineRail
          lang="zh"
          segments={dummySegments}
          activeSegmentId="seg-1"
          setActiveSegmentId={vi.fn()}
          draggedSegmentIdx={null}
          setDraggedSegmentIdx={vi.fn()}
          selectedLesson="lesson-1"
          saveTimeline={vi.fn()}
          editorPanelsExpanded={false}
          setEditorPanelsExpanded={setEditorPanelsExpanded}
          dragState={null}
        />,
      );

      const railEl = container.firstChild as HTMLElement;
      vi.spyOn(railEl, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        right: 1000,
        top: 0,
        bottom: 50,
        width: 1000,
        height: 50,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const dragState: WhiteboardDragState = {
        elementId: 'el-202',
        elementType: 'code-sandbox',
        elementData: { segmentId: 'seg-1' },
        clientX: 250,
        clientY: 25,
        initialPage: 0,
        initialSegmentId: 'seg-1',
      };

      rerender(
        <TimelineRail
          lang="zh"
          segments={dummySegments}
          activeSegmentId="seg-1"
          setActiveSegmentId={vi.fn()}
          draggedSegmentIdx={null}
          setDraggedSegmentIdx={vi.fn()}
          selectedLesson="lesson-1"
          saveTimeline={vi.fn()}
          editorPanelsExpanded={false}
          setEditorPanelsExpanded={setEditorPanelsExpanded}
          dragState={dragState}
        />,
      );

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(setEditorPanelsExpanded).not.toHaveBeenCalled();
    });
  });
});
