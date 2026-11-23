import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ModePackPrepShell } from '../ModePackPrepShell';
import { setModePacksEnabledForTests } from '../flags';

const state = vi.hoisted(() => ({
  packs: [] as Array<Record<string, unknown>>,
  prepExtensions: [] as Array<Record<string, unknown>>,
  segments: [
    { id: 'seg-wb', title: '白板导入', type: 'whiteboard' },
    { id: 'seg-xa', title: '学案自学', type: 'xuean:study' },
    { id: 'seg-lab', title: '探究实验', type: 'inquiry' },
  ] as Array<Record<string, unknown>>,
  activeSegmentId: 'seg-xa' as string | null,
  lessonModePackId: null as string | null,
  lessonDeliveryMode: null as string | null,
}));

vi.mock('../../../../context/AppDataContext', () => ({
  useOptionalAppData: () => ({
    timelineSegments: state.segments,
    activeSegmentId: state.activeSegmentId,
    setActiveSegmentId: vi.fn(),
    selectedLesson: 'lesson-1',
    lessons: [
      {
        id: 'lesson-1',
        mode_pack_id: state.lessonModePackId,
        delivery_mode: state.lessonDeliveryMode,
      },
    ],
    lang: 'zh',
  }),
}));

vi.mock('../useModePackCatalog', () => ({
  useModePackCatalog: () => state.packs,
}));

vi.mock('../../../../plugin-host/plugin-host-context', () => ({
  useOptionalPluginHost: () => ({ getExtensions: () => state.prepExtensions }),
}));

vi.mock('../../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: (props: { slot: string }) => <div data-testid="prep-extension-mock" data-slot={props.slot} />,
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

const LAB_PACK = {
  id: 'ext-lab:mode-inquiry',
  label: '探究实验室',
  labelEn: 'Inquiry Lab',
  source: 'plugin',
  pluginId: 'ext-lab',
  segmentTypes: ['inquiry'],
  prepContributionId: 'prep-lab',
  outlineContributionId: 'outline-lab',
};

describe('ModePackPrepShell', () => {
  beforeEach(() => {
    setModePacksEnabledForTests(true);
    state.packs = [];
    state.prepExtensions = [];
    state.activeSegmentId = 'seg-xa';
    state.lessonModePackId = null;
    state.lessonDeliveryMode = null;
  });

  afterEach(() => {
    setModePacksEnabledForTests(null);
    cleanup();
    vi.restoreAllMocks();
  });

  it('按学案环节决议 prep 面并渲染 XueanEditor', async () => {
    render(<ModePackPrepShell />);
    const shell = screen.getByTestId('mode-pack-prep-shell');
    expect(shell.getAttribute('data-pack-id')).toBe('@openlearn/mode-xuean');
    expect(shell.getAttribute('data-prep-id')).toBe('prep-xuean');
    expect(await screen.findByTestId('xuean-editor-mock')).toBeTruthy();
    expect(screen.getByTestId('mode-pack-prep-segment-bar')).toBeTruthy();
  });

  it('无活动环节时按课时模式包进入学案编辑器', async () => {
    state.activeSegmentId = null;
    state.lessonModePackId = '@openlearn/mode-xuean';

    render(<ModePackPrepShell />);
    expect(await screen.findByTestId('xuean-editor-mock')).toBeTruthy();
    expect(screen.getByTestId('mode-pack-prep-shell').getAttribute('data-prep-id')).toBe('prep-xuean');
  });

  it('无环节且无模式包时按 delivery_mode 兜底', async () => {
    state.activeSegmentId = null;
    state.lessonDeliveryMode = 'xuean';

    render(<ModePackPrepShell />);
    expect(await screen.findByTestId('xuean-editor-mock')).toBeTruthy();
  });

  it('第三方包命中 classroom.prep 时渲染扩展备课面', async () => {
    state.packs = [LAB_PACK];
    state.activeSegmentId = 'seg-lab';
    state.prepExtensions = [{ id: 'lab-prep', pluginId: 'ext-lab', slotProps: { prepContributionId: 'prep-lab' } }];

    render(<ModePackPrepShell />);
    const shell = screen.getByTestId('mode-pack-prep-shell');
    expect(shell.getAttribute('data-pack-id')).toBe('ext-lab:mode-inquiry');
    expect(shell.getAttribute('data-prep-id')).toBe('prep-lab');
    const ext = await screen.findByTestId('prep-extension-mock');
    expect(ext.getAttribute('data-slot')).toBe('classroom.prep');
  });

  it('第三方包缺少备课面贡献时回退白板备课面并告警', async () => {
    state.packs = [LAB_PACK];
    state.activeSegmentId = 'seg-lab';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<ModePackPrepShell />);
    expect(await screen.findByTestId('lesson-editor-mock')).toBeTruthy();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(String(warn.mock.calls[0]?.[0] ?? '')).toContain('回退白板');
  });
});
