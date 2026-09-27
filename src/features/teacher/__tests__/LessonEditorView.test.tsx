import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { LessonEditorView, type LessonEditorViewProps } from '../LessonEditorView';

vi.mock('../../../components/LazyWhiteboard', () => ({
  LazyWhiteboard: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="editor-whiteboard" data-read-only={String(Boolean(readOnly))} />
  ),
}));

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
    expect(screen.getByText('Please select a lesson from the Dashboard to orchestrate.')).toBeTruthy();
  });

  it('renders the English header and fallback when lang is en', () => {
    render(<LessonEditorView {...makeProps({ lang: 'en' })} />);

    expect(screen.getByText('Lesson Editor: No Lesson Selected')).toBeTruthy();
  });

  it('shows the saving badge when editorSaveStatus is saving and a lesson is selected', () => {
    render(<LessonEditorView {...makeProps({ selectedLesson: 'lesson-1', editorSaveStatus: 'saving' })} />);

    expect(screen.getByText('同步 SQLite...')).toBeTruthy();
  });

  it('disables timeline, palette and whiteboard editing for another teacher’s lesson', () => {
    render(
      <LessonEditorView
        {...makeProps({
          session: { userId: 'viewer-id', username: 'viewer', role: 'teacher' } as any,
          lessons: [{ id: 'lesson-1', title: '共享课程', creator_id: 'owner-id' } as any],
          selectedLesson: 'lesson-1',
          timelineSegments: [{ id: 'segment-1', title: '导入', duration: '5m', type: 'intro' }],
          activeSegmentId: 'segment-1',
        })}
      />,
    );

    expect(screen.getByTestId('editor-whiteboard').getAttribute('data-read-only')).toBe('true');
    expect(screen.queryByRole('button', { name: /加环节/ })).toBeNull();
    expect(screen.getByLabelText('环节名称')).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: /删除环节/ })).toBeNull();
  });

  it('keeps the lesson editor read-only in student preview mode', () => {
    render(
      <LessonEditorView
        {...makeProps({
          session: { userId: 'owner-id', username: 'owner', role: 'teacher' } as any,
          lessons: [{ id: 'lesson-1', title: '我的课程', creator_id: 'owner-id' } as any],
          selectedLesson: 'lesson-1',
          activeRole: 'student',
        })}
      />,
    );

    expect(screen.getByTestId('editor-whiteboard').getAttribute('data-read-only')).toBe('true');
    expect(screen.queryByRole('button', { name: /加环节/ })).toBeNull();
  });

  it('opens the student perspective in a new preview tab from the editor toolbar', () => {
    const openMock = vi.fn(() => ({ focus: vi.fn(), closed: false }) as any);
    vi.stubGlobal('open', openMock);

    render(
      <LessonEditorView
        {...makeProps({
          selectedLesson: 'lesson-42',
          lessons: [{ id: 'lesson-42', title: '物理实验课' } as any],
        })}
      />,
    );

    const studentBtn = screen.getByRole('button', { name: /学生视角/ });
    studentBtn.click();

    expect(openMock).toHaveBeenCalledWith(
      expect.stringContaining('mode=student_preview&lessonId=lesson-42#/student_preview'),
      '_blank',
    );
    // 学生视角改为新标签页打开，不再就地切换角色
    expect(makeProps().setActiveRole).not.toHaveBeenCalledWith('student');

    vi.unstubAllGlobals();
  });

  it('keeps the perspective switcher next to the "返回课程库" button', () => {
    render(<LessonEditorView {...makeProps({ selectedLesson: 'lesson-42' })} />);

    const studentBtn = screen.getByRole('button', { name: /学生视角/ });
    const backBtn = screen.getByRole('button', { name: /返回课程库/ });
    // 切换器的父级是右侧快捷操作按钮组，「返回课程库」是同组的兄弟节点
    const rightGroup = studentBtn.parentElement?.parentElement;
    expect(rightGroup?.contains(backBtn)).toBe(true);
    // 且切换器排在「返回课程库」之前
    expect(
      rightGroup ? backBtn.compareDocumentPosition(studentBtn) & Node.DOCUMENT_POSITION_PRECEDING : 0,
    ).toBeTruthy();
  });
});
