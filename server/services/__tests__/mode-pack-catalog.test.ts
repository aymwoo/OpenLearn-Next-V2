import { describe, expect, it, vi } from 'vitest';
import {
  collectModePacks,
  findModePack,
  modePackDeliveryMode,
  resolveLessonModeBinding,
  type ModePackPluginRecord,
} from '../mode-pack-catalog.js';
import {
  BUILTIN_WHITEBOARD_MODE_PACK,
  BUILTIN_WHITEBOARD_MODE_PACK_ID,
  BUILTIN_XUEAN_MODE_PACK_ID,
} from '../../../packages/core/plugin-host/mode-pack.js';

function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'ext-demo',
    name: 'Demo Plugin',
    version: '1.0.0',
    main: 'index.js',
    contributes: {
      'mode.pack': [
        {
          id: 'ext-demo:mode-lab',
          label: '实验模式',
          segmentTypes: ['lab'],
        },
      ],
    },
    ...overrides,
  });
}

function plugin(overrides: Partial<ModePackPluginRecord> = {}): ModePackPluginRecord {
  return { id: 'p1', state: 'active', status: 'active', manifest: manifest(), ...overrides };
}

describe('collectModePacks', () => {
  it('始终包含两个内置包', () => {
    const packs = collectModePacks([]);
    expect(packs.map((pack) => pack.id)).toEqual(
      expect.arrayContaining([BUILTIN_WHITEBOARD_MODE_PACK_ID, BUILTIN_XUEAN_MODE_PACK_ID]),
    );
    expect(packs.every((pack) => pack.source === 'builtin')).toBe(true);
  });

  it('收录已激活插件的合法模式包', () => {
    const packs = collectModePacks([plugin()]);
    const demo = packs.find((pack) => pack.id === 'ext-demo:mode-lab');
    expect(demo).toBeDefined();
    expect(demo?.source).toBe('plugin');
    expect(demo?.pluginId).toBe('ext-demo');
    expect(demo?.pluginName).toBe('Demo Plugin');
  });

  it('跳过未激活插件', () => {
    const packs = collectModePacks([plugin({ state: 'inactive', status: 'disabled' })]);
    expect(findModePack('ext-demo:mode-lab', packs)).toBeNull();
  });

  it('跳过 manifest 校验失败的插件', () => {
    const packs = collectModePacks([plugin({ manifest: manifest({ main: '' }) })]);
    expect(findModePack('ext-demo:mode-lab', packs)).toBeNull();
  });

  it('重复 id 保留先出现者并告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const packs = collectModePacks([
      plugin(),
      plugin({
        id: 'p2',
        manifest: manifest({
          id: 'ext-demo-2',
          contributes: {
            'mode.pack': [{ id: 'ext-demo:mode-lab', label: '重复', segmentTypes: ['lab'] }],
          },
        }),
      }),
    ]);
    expect(packs.filter((pack) => pack.id === 'ext-demo:mode-lab')).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('resolveLessonModeBinding', () => {
  const packs = collectModePacks([plugin()]);

  it('显式可用模式包直接绑定', () => {
    const binding = resolveLessonModeBinding({ modePackId: 'ext-demo:mode-lab', packs });
    expect(binding).toEqual({ modePackId: 'ext-demo:mode-lab', deliveryMode: 'whiteboard', fallback: false });
  });

  it('显式不可用模式包回落白板并带原因', () => {
    const binding = resolveLessonModeBinding({ modePackId: 'ext-missing:mode', packs });
    expect(binding.modePackId).toBeNull();
    expect(binding.deliveryMode).toBe('whiteboard');
    expect(binding.fallback).toBe(true);
    expect(binding.reason).toContain('ext-missing:mode');
  });

  it('未传 id 时按 deliveryMode 推导内置包', () => {
    expect(resolveLessonModeBinding({ deliveryMode: 'xuean', packs }).modePackId).toBe(BUILTIN_XUEAN_MODE_PACK_ID);
    expect(resolveLessonModeBinding({ deliveryMode: 'whiteboard', packs }).modePackId).toBe(
      BUILTIN_WHITEBOARD_MODE_PACK_ID,
    );
    expect(resolveLessonModeBinding({ packs }).modePackId).toBe(BUILTIN_WHITEBOARD_MODE_PACK_ID);
  });
});

describe('modePackDeliveryMode', () => {
  it('内置包映射为既有交付模式', () => {
    expect(modePackDeliveryMode(BUILTIN_WHITEBOARD_MODE_PACK)).toBe('whiteboard');
  });

  it('插件包按 xuean 前缀推断学案', () => {
    expect(modePackDeliveryMode({ id: 'ext:study', label: 'Study', segmentTypes: ['xuean:study'] })).toBe('xuean');
    expect(modePackDeliveryMode({ id: 'ext:lab', label: 'Lab', segmentTypes: ['lab'] })).toBe('whiteboard');
  });
});
