import { afterEach, describe, expect, it } from 'vitest';
import { applyModePackSegmentTypes } from '../ModePackSegmentTypeBridge';
import type { ModePackCatalogEntry } from '../useModePackCatalog';
import {
  getAllSegmentTypes,
  registerCustomSegmentType,
  SEGMENT_TYPES,
  unregisterCustomSegmentType,
} from '../../../teacher/lesson-editor/timelineConfig';

function pluginPack(overrides: Partial<ModePackCatalogEntry> = {}): ModePackCatalogEntry {
  return {
    id: 'ext-lab:mode-inquiry',
    label: '探究实验室',
    labelEn: 'Inquiry Lab',
    source: 'plugin',
    pluginId: 'ext-lab',
    segmentTypes: ['inquiry', 'inquiry:sim'],
    ...overrides,
  };
}

function segmentTypeIds(): string[] {
  return getAllSegmentTypes().map((type) => type.id);
}

afterEach(() => {
  for (const type of getAllSegmentTypes()) {
    if (!SEGMENT_TYPES.some((builtin) => builtin.id === type.id)) unregisterCustomSegmentType(type.id);
  }
});

describe('applyModePackSegmentTypes', () => {
  it('把插件包认领的环节类型注册进选择器，并按多类型追加包名', () => {
    const registered = applyModePackSegmentTypes({ packs: [pluginPack()] });

    expect(Array.from(registered.get('ext-lab') ?? [])).toEqual(['inquiry', 'inquiry:sim']);
    const inquiry = getAllSegmentTypes().find((type) => type.id === 'inquiry');
    expect(inquiry?.labelZh).toBe('探究实验室 · inquiry');
    expect(inquiry?.pluginId).toBe('ext-lab');
    expect(segmentTypeIds()).toEqual(expect.arrayContaining(['inquiry', 'inquiry:sim']));
  });

  it('内置包不注册环节类型', () => {
    applyModePackSegmentTypes({
      packs: [{ id: '@openlearn/mode-whiteboard', label: '互动白板', source: 'builtin', segmentTypes: ['lab'] }],
    });
    expect(segmentTypeIds()).not.toContain('lab');
  });

  it('插件已显式注册的同名类型不被覆盖', () => {
    registerCustomSegmentType(
      { id: 'inquiry', labelZh: '插件自己的类型', labelEn: 'Owner type', icon: SEGMENT_TYPES[0].icon },
      'ext-lab',
    );

    const registered = applyModePackSegmentTypes({ packs: [pluginPack()] });

    expect(Array.from(registered.get('ext-lab') ?? [])).toEqual(['inquiry:sim']);
    expect(getAllSegmentTypes().find((type) => type.id === 'inquiry')?.labelZh).toBe('插件自己的类型');
  });

  it('插件停用或包消失时清理本桥注册的类型', () => {
    const first = applyModePackSegmentTypes({ packs: [pluginPack()] });
    expect(segmentTypeIds()).toContain('inquiry');

    applyModePackSegmentTypes({ packs: [], previous: first });
    expect(segmentTypeIds()).not.toContain('inquiry');
    expect(segmentTypeIds()).not.toContain('inquiry:sim');
  });

  it('按激活插件过滤', () => {
    applyModePackSegmentTypes({ packs: [pluginPack()], activePluginIds: new Set(['ext-other']) });
    expect(segmentTypeIds()).not.toContain('inquiry');
  });
});
