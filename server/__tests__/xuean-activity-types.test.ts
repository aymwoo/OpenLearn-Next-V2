/**
 * 学案活动类型目录（内置 + 插件扩展）单元测试。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectXueanActivityTypes } from '../services/xuean-activity-types.js';

function plugin(overrides: Record<string, unknown>) {
  return {
    id: '@acme/virtual-lab',
    name: '虚拟实验室',
    state: 'active',
    manifest: {
      id: '@acme/virtual-lab',
      name: '虚拟实验室',
      version: '1.0.0',
      main: 'index.js',
      ...overrides,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('collectXueanActivityTypes', () => {
  it('无插件时返回全部内置类型', () => {
    const types = collectXueanActivityTypes([]);
    const ids = types.map((item) => item.id);
    expect(ids).toEqual([
      'reading',
      'submission',
      'quiz',
      'survey',
      'discussion',
      'courseware',
      'scratch',
      'form',
      'other',
    ]);
    expect(types.every((item) => item.source === 'builtin')).toBe(true);
  });

  it('追加已激活插件声明的命名空间类型', () => {
    const types = collectXueanActivityTypes([
      plugin({
        contributes: {
          'xuean.activity.type': [{ id: '@acme/virtual-lab:experiment', label: '虚拟实验', icon: 'flask' }],
        },
      }),
    ]);
    const custom = types.find((item) => item.id === '@acme/virtual-lab:experiment');
    expect(custom).toMatchObject({
      label: '虚拟实验',
      icon: 'flask',
      source: 'plugin',
      pluginId: '@acme/virtual-lab',
      pluginName: '虚拟实验室',
    });
  });

  it('忽略未激活插件', () => {
    const types = collectXueanActivityTypes([
      {
        ...plugin({
          contributes: { 'xuean.activity.type': [{ id: '@acme/virtual-lab:experiment', label: '虚拟实验' }] },
        }),
        state: 'installed',
      },
    ]);
    expect(types.some((item) => item.source === 'plugin')).toBe(false);
  });

  it('忽略缺少命名空间前缀的类型并告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const types = collectXueanActivityTypes([
      plugin({
        contributes: { 'xuean.activity.type': [{ id: 'experiment', label: '虚拟实验' }] },
      }),
    ]);
    expect(types.some((item) => item.id === 'experiment')).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('命名空间'));
  });

  it('忽略重复类型 id（保留先出现者）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entry = { id: '@acme/virtual-lab:experiment', label: '虚拟实验' };
    const types = collectXueanActivityTypes([
      plugin({ contributes: { 'xuean.activity.type': [entry] } }),
      plugin({ contributes: { 'xuean.activity.type': [{ ...entry, label: '重复实验' }] } }),
    ]);
    const matches = types.filter((item) => item.id === '@acme/virtual-lab:experiment');
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe('虚拟实验');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('冲突'));
  });
});
