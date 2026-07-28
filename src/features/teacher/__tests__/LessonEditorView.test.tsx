import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { LessonEditorView, type LessonEditorViewProps } from '../LessonEditorView';

afterEach(() => cleanup());

function makeProps(overrides: Partial<LessonEditorViewProps> = {}): LessonEditorViewProps {
  return {
    lang: 'zh',
    lessons: [],
    selectedLesson: null,
    activeRole: 'teacher',
    setActiveRole: vi.fn(),
    editorSaveStatus: 'none',
    setEditorSaveStatus: vi.fn(),
    editorLastSavedTime: null,
    setEditorLastSavedTime: vi.fn(),
    setIsLessonPreviewVisible: vi.fn(),
    setPreviewLessonTab: vi.fn(),
    setPreviewSelectedCourseware: vi.fn(),
    setTeacherTab: vi.fn(),
    handlePaletteActivate: vi.fn(),
    timelineSegments: [],
    activeSegmentId: null,
    setActiveSegmentId: vi.fn(),
    draggedSegmentIdx: null,
    setDraggedSegmentIdx: vi.fn(),
    saveTimeline: vi.fn().mockResolvedValue(undefined),
    editorPanelsExpanded: true,
    setEditorPanelsExpanded: vi.fn(),
    fetchElements: vi.fn().mockResolvedValue(undefined),
    whiteboardRef: { current: null } as MutableRefObject<any>,
    elements: [],
    paletteEdit: null,
    handlePaletteConfirm: vi.fn().mockResolvedValue(undefined),
    setPaletteEdit: vi.fn(),
    ...overrides,
  };
}

describe('LessonEditorView', () => {
  it('renders the editor header (zh) and the no-lesson placeholder when no lesson is selected', () => {
    render(<LessonEditorView {...makeProps()} />);

    // Header title + fallback are joined into one text node.
    expect(screen.getByText('课程编辑器: 未选择课程')).toBeTruthy();
    // Empty-state body copy
    expect(screen.getByText('No active lesson selected')).toBeTruthy();
    expect(
      screen.getByText('Please select a lesson from the Dashboard to orchestrate.'),
    ).toBeTruthy();
  });

  it('renders the English header and fallback when lang is en', () => {
    render(<LessonEditorView {...makeProps({ lang: 'en' })} />);

    expect(screen.getByText('Lesson Editor: No Lesson Selected')).toBeTruthy();
  });

  it('shows the saving badge when editorSaveStatus is saving and a lesson is selected', () => {
    render(<LessonEditorView {...makeProps({ selectedLesson: 'lesson-1', editorSaveStatus: 'saving' })} />);

    expect(screen.getByText('同步 SQLite...')).toBeTruthy();
  });
});
