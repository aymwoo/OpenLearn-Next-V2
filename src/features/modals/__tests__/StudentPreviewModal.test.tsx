import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StudentPreviewModal, type StudentPreviewModalProps } from '../StudentPreviewModal';

afterEach(() => cleanup());

function makeProps(overrides: Partial<StudentPreviewModalProps> = {}): StudentPreviewModalProps {
  return {
    isLessonPreviewVisible: true,
    setIsLessonPreviewVisible: vi.fn(),
    lessons: [],
    selectedLesson: null,
    previewFullscreenPanel: 'none',
    setPreviewFullscreenPanel: vi.fn(),
    previewLessonTab: 'whiteboard',
    setPreviewLessonTab: vi.fn(),
    activeRole: 'teacher',
    elements: [],
    activeSegmentId: null,
    setActiveSegmentId: vi.fn(),
    fetchElements: vi.fn(),
    currentVfsParent: null,
    setCurrentVfsParent: vi.fn(),
    vfsNodes: [],
    previewSelectedCourseware: null,
    setPreviewSelectedCourseware: vi.fn(),
    ...overrides,
  };
}

describe('StudentPreviewModal', () => {
  it('renders the modal header when visible', () => {
    render(<StudentPreviewModal {...makeProps()} />);
    expect(screen.getByText(/学生视角预览 \(Student Perspective Preview\)/)).toBeTruthy();
  });

  it('does not render the modal when not visible', () => {
    render(<StudentPreviewModal {...makeProps({ isLessonPreviewVisible: false })} />);
    expect(screen.queryByText(/学生视角预览 \(Student Perspective Preview\)/)).toBeNull();
  });

  it('renders "独立Tab预览" button and triggers window.open with _blank', () => {
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);

    render(
      <StudentPreviewModal
        {...makeProps({
          selectedLesson: 'lesson-99',
          lessons: [{ id: 'lesson-99', title: '探究课' } as any],
        })}
      />,
    );

    const tabBtn = screen.getByRole('button', { name: /独立Tab预览/ });
    expect(tabBtn).toBeTruthy();

    tabBtn.click();
    expect(openMock).toHaveBeenCalledWith(
      expect.stringContaining('mode=student_live&lessonId=lesson-99#/student_live'),
      '_blank',
    );

    vi.unstubAllGlobals();
  });
});
