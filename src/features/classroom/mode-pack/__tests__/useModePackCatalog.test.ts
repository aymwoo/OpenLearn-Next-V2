import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadModePackCatalog,
  resetModePackCatalogForTests,
  resolveLessonDeliveryMode,
  resolveLessonModeBadge,
} from '../useModePackCatalog';

const CATALOG_RESPONSE = {
  data: [
    { id: '@openlearn/mode-whiteboard', label: '互动白板', labelEn: 'Interactive Whiteboard', source: 'builtin' },
    { id: '@openlearn/mode-xuean', label: '学案学习', labelEn: 'Guided Study', source: 'builtin' },
    {
      id: 'ext-lab:mode-inquiry',
      label: '探究实验室',
      labelEn: 'Inquiry Lab',
      source: 'plugin',
      pluginId: 'ext-lab',
      pluginName: '探究实验室插件',
      segmentTypes: ['inquiry', 'inquiry:sim'],
      prepContributionId: 'prep-lab',
      outlineContributionId: 'outline-lab',
      teacherWorkspaceId: 'mode-lab-teacher',
      studentWorkspaceId: 'mode-lab-student',
      adapterIds: ['lab-adapter'],
      channels: ['lab:task'],
    },
  ],
};

describe('useModePackCatalog', () => {
  beforeEach(() => {
    resetModePackCatalogForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('拉取一次目录并共享缓存', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => CATALOG_RESPONSE });
    vi.stubGlobal('fetch', fetchMock);

    const first = await loadModePackCatalog();
    const second = await loadModePackCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toHaveLength(3);
    expect(second).toBe(first);
    const lab = first.find((entry) => entry.id === 'ext-lab:mode-inquiry');
    expect(lab?.source).toBe('plugin');
    expect(lab?.pluginId).toBe('ext-lab');
    expect(lab?.segmentTypes).toEqual(['inquiry', 'inquiry:sim']);
    expect(lab?.prepContributionId).toBe('prep-lab');
    expect(lab?.outlineContributionId).toBe('outline-lab');
    expect(lab?.teacherWorkspaceId).toBe('mode-lab-teacher');
    expect(lab?.adapterIds).toEqual(['lab-adapter']);
    expect(lab?.channels).toEqual(['lab:task']);
  });

  it('目录拉取失败时返回空目录且不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(loadModePackCatalog()).resolves.toEqual([]);
  });

  it('第三方模式包优先展示目录名称并给出包 id 提示', () => {
    const packs = [
      {
        id: 'ext-lab:mode-inquiry',
        label: '探究实验室',
        labelEn: 'Inquiry Lab',
        source: 'plugin' as const,
        segmentTypes: ['inquiry'],
      },
    ];
    const lesson = { mode_pack_id: 'ext-lab:mode-inquiry', delivery_mode: 'whiteboard' };

    expect(resolveLessonModeBadge(lesson, packs, 'zh')).toEqual({
      mode: 'whiteboard',
      label: '探究实验室',
      title: 'ext-lab:mode-inquiry',
    });
    expect(resolveLessonModeBadge(lesson, packs, 'en')).toEqual({
      mode: 'whiteboard',
      label: 'Inquiry Lab',
      title: 'ext-lab:mode-inquiry',
    });
  });

  it('未知模式包回落交付模式并提示不可用', () => {
    const lesson = { mode_pack_id: 'ext-gone:mode-x', delivery_mode: 'xuean' };
    expect(resolveLessonModeBadge(lesson, [], 'zh')).toEqual({
      mode: 'xuean',
      label: '学案',
      title: '模式包不可用：ext-gone:mode-x',
    });
  });

  it('mode_pack_id 优先于 delivery_mode', () => {
    expect(
      resolveLessonDeliveryMode({
        mode_pack_id: '@openlearn/mode-whiteboard',
        delivery_mode: 'xuean',
      }),
    ).toBe('whiteboard');
    expect(resolveLessonDeliveryMode({ delivery_mode: 'xuean' })).toBe('xuean');
    expect(resolveLessonDeliveryMode(null)).toBe('whiteboard');
  });
});
