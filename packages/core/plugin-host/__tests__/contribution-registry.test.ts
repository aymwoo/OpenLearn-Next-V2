/**
 * ContributionRegistry 单元测试（V3.0）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ContributionRegistry } from '../contribution-registry.js';
import type { ContributesSection } from '../contribution-registry.js';

describe('ContributionRegistry', () => {
  let registry: ContributionRegistry;

  beforeEach(() => {
    registry = new ContributionRegistry();
  });

  it('register 存储单个插件的贡献点', () => {
    const contributes: ContributesSection = {
      'classroom.tool': [
        { id: 'tool-a', name: 'Tool A', commandType: 'cmd.a' },
        { id: 'tool-b', name: 'Tool B', commandType: 'cmd.b' },
      ],
    };
    registry.register('ext-test', contributes);

    const items = registry.getBySlot('classroom.tool');
    expect(items).toHaveLength(2);
  });

  it('getBySlot 返回空数组（无注册项时）', () => {
    expect(registry.getBySlot('classroom.tool')).toEqual([]);
  });

  it('getByPlugin 按插件分组返回', () => {
    registry.register('ext-a', {
      'classroom.tool': [{ id: 't1', name: 'T1', commandType: 'a.cmd' }],
    });
    registry.register('ext-b', {
      'teacher.tab': [{ id: 'tab1', label: 'Tab 1' }],
    });

    const a = registry.getByPlugin('ext-a');
    expect(a.get('classroom.tool')).toHaveLength(1);
    expect(a.has('teacher.tab')).toBe(false);

    const b = registry.getByPlugin('ext-b');
    expect(b.get('teacher.tab')).toHaveLength(1);
  });

  it('summary 返回人类可读摘要', () => {
    registry.register('ext-test', {
      'classroom.tool': [
        { id: 't1', name: 'Tool 1', commandType: 'c1' },
        { id: 't2', name: 'Tool 2', commandType: 'c2' },
      ],
      'teacher.tab': [{ id: 'tab1', label: 'My Tab' }],
    });

    const s = registry.summary('ext-test');
    expect(s).toHaveLength(2);

    const tools = s.find((x) => x.slot === 'classroom.tool')!;
    expect(tools.count).toBe(2);
    expect(tools.items[0].label).toBe('Tool 1');

    const tabs = s.find((x) => x.slot === 'teacher.tab')!;
    expect(tabs.count).toBe(1);
  });

  it('registerClassroomTools 自动桥接 classroomTools → contributes', () => {
    registry.registerClassroomTools('ext-legacy', [
      { id: 'old-tool', name: 'Old Tool', commandType: 'old.cmd' },
    ]);

    const items = registry.getBySlot('classroom.tool');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'old-tool' });
  });

  it('register 覆盖同一插件的旧数据（重新安装场景）', () => {
    registry.register('ext-test', {
      'classroom.tool': [{ id: 'v1', name: 'V1', commandType: 'v1.cmd' }],
    });
    registry.register('ext-test', {
      'classroom.tool': [{ id: 'v2', name: 'V2', commandType: 'v2.cmd' }],
    });

    const items = registry.getBySlot('classroom.tool');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('v2');
  });

  it('unregister 移除插件所有贡献', () => {
    registry.register('ext-test', {
      'classroom.tool': [{ id: 't1', name: 'T1', commandType: 'c1' }],
      'teacher.tab': [{ id: 'tab1', label: 'Tab' }],
    });

    registry.unregister('ext-test');

    expect(registry.getBySlot('classroom.tool')).toHaveLength(0);
    expect(registry.getBySlot('teacher.tab')).toHaveLength(0);
  });

  it('allSummaries 跨所有插件聚合', () => {
    registry.register('ext-a', {
      'classroom.tool': [{ id: 'a1', name: 'A1', commandType: 'a.cmd' }],
    });
    registry.register('ext-b', {
      'classroom.tool': [{ id: 'b1', name: 'B1', commandType: 'b.cmd' }],
    });

    const all = registry.allSummaries();
    expect(all).toHaveLength(2);
  });

  it('stats 返回聚合统计', () => {
    registry.register('ext-a', {
      'classroom.tool': [
        { id: 'a1', name: 'A1', commandType: 'a1' },
        { id: 'a2', name: 'A2', commandType: 'a2' },
      ],
    });
    registry.register('ext-b', {
      'classroom.tool': [{ id: 'b1', name: 'B1', commandType: 'b1' }],
      'teacher.tab': [{ id: 'tab1', label: 'Tab' }],
    });

    const s = registry.stats();
    expect(s.totalPlugins).toBe(2);
    expect(s.totalContributions).toBe(4);
    expect(s.bySlot['classroom.tool']).toBe(3);
    expect(s.bySlot['teacher.tab']).toBe(1);
  });

  it('dispose 清空所有贡献', () => {
    registry.register('ext-test', {
      'classroom.tool': [{ id: 't1', name: 'T1', commandType: 'c1' }],
    });
    registry.dispose();

    expect(registry.getBySlot('classroom.tool')).toHaveLength(0);
    expect(registry.allSummaries()).toHaveLength(0);
  });
});
