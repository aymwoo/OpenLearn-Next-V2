import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { XueanStudentModeWorkspace, XueanTeacherModeWorkspace } from '../XueanModeWorkspace';

vi.mock('../../../teacher/xuean/ProgressPanel', () => ({
  ProgressPanel: () => <div data-testid="progress-panel" />,
}));

vi.mock('../../../student/xuean/StudentXueanView', () => ({
  StudentXueanView: (props: { lessonId: string }) => (
    <div data-testid="student-xuean-view" data-lesson-id={props.lessonId} />
  ),
}));

const flow = {
  snapshot: {
    lessonId: 'les-1',
    classId: 'cls-1',
    stage: 'IN_CLASS_TEACHING',
    activeSegmentId: 'seg-x',
    segments: [],
    students: [],
    onlineStudentIds: [],
    attempts: [],
  },
  setActiveSegment: async () => undefined,
  advanceStage: async () => undefined,
  sendMessage: async () => ({ ok: true }),
};

afterEach(() => {
  cleanup();
});

describe('XueanModeWorkspace', () => {
  it('教师工作区挂载 ProgressPanel', () => {
    render(
      <XueanTeacherModeWorkspace
        segment={{ id: 'seg-x', type: 'xuean', title: '自学' }}
        lessonId="les-1"
        classId="cls-1"
        flow={flow as never}
      />,
    );
    const root = screen.getByTestId('mode-xuean-workspace');
    expect(root.getAttribute('data-role')).toBe('teacher');
    expect(screen.getByTestId('progress-panel')).toBeTruthy();
  });

  it('学生工作区挂载 StudentXueanView 并透传 lessonId', () => {
    render(
      <XueanStudentModeWorkspace
        segment={{ id: 'seg-x', type: 'xuean', title: '自学' }}
        lessonId="les-1"
        classId="cls-1"
        flow={flow as never}
      />,
    );
    const root = screen.getByTestId('mode-xuean-workspace');
    expect(root.getAttribute('data-role')).toBe('student');
    expect(screen.getByTestId('student-xuean-view').getAttribute('data-lesson-id')).toBe('les-1');
  });
});
