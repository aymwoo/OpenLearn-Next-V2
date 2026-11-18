import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ModePackPrepShell } from '../ModePackPrepShell';
import { setModePacksEnabledForTests } from '../flags';

vi.mock('../../../../context/AppDataContext', () => ({
  useOptionalAppData: () => ({
    timelineSegments: [
      { id: 'seg-wb', title: '白板导入', type: 'whiteboard' },
      { id: 'seg-xa', title: '学案自学', type: 'xuean:study' },
    ],
    activeSegmentId: 'seg-xa',
    setActiveSegmentId: vi.fn(),
  }),
}));

vi.mock('../registerWhiteboardModePack', () => ({
  registerWhiteboardModePack: vi.fn(),
  unregisterWhiteboardModePack: vi.fn(),
}));

vi.mock('../registerXueanModePack', () => ({
  registerXueanModePack: vi.fn(),
  unregisterXueanModePack: vi.fn(),
}));

vi.mock('../../../teacher/LessonEditorView', () => ({
  LessonEditorView: () => <div data-testid="lesson-editor-mock">lesson</div>,
}));

vi.mock('../../../teacher/xuean/XueanEditor', () => ({
  XueanEditor: () => <div data-testid="xuean-editor-mock">xuean</div>,
}));

describe('ModePackPrepShell', () => {
  beforeEach(() => {
    setModePacksEnabledForTests(true);
  });

  afterEach(() => {
    setModePacksEnabledForTests(null);
    cleanup();
  });

  it('按学案环节决议 prep 面并渲染 XueanEditor', async () => {
    render(<ModePackPrepShell />);
    const shell = screen.getByTestId('mode-pack-prep-shell');
    expect(shell.getAttribute('data-pack-id')).toBe('@openlearn/mode-xuean');
    expect(shell.getAttribute('data-prep-id')).toBe('prep-xuean');
    expect(await screen.findByTestId('xuean-editor-mock')).toBeTruthy();
    expect(screen.getByTestId('mode-pack-prep-segment-bar')).toBeTruthy();
  });
});
