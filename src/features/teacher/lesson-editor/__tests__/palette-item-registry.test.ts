import { describe, it, expect, beforeEach } from 'vitest';
import { paletteItemRegistry } from '../palette-item-registry';
import { getPaletteItemConfig, PALETTE_ITEM_MAP } from '../paletteConfig';
import type { PaletteItemConfig } from '../paletteConfig';
import { FrontendPluginHost } from '../../../../plugin-host/plugin-host';

describe('paletteItemRegistry & Plugin Palette Extension', () => {
  beforeEach(() => {
    // Clear any test registered items
    const all = paletteItemRegistry.getAll();
    all.forEach((item) => paletteItemRegistry.unregister(item.type));
  });

  it('allows registering, querying, and unregistering a custom palette item', () => {
    const mockItem: PaletteItemConfig = {
      type: 'ext-chem/molecule-viewer',
      labelZh: '3D 分子探究器',
      labelEn: '3D Molecule Viewer',
      descriptionZh: '支持高保真 3D 分子轨道与化学键可视化交互',
      descriptionEn: 'Interactive 3D molecule model viewer',
      color: 'emerald',
      group: 'extension',
      defaultData: {
        title: '水分子结构模型',
        smiles: 'O',
      },
      editFields: [
        {
          key: 'title',
          labelZh: '模型名称',
          labelEn: 'Title',
          kind: 'input',
        },
      ],
      pluginId: 'ext-chem',
    };

    paletteItemRegistry.register(mockItem);

    expect(paletteItemRegistry.has('ext-chem/molecule-viewer')).toBe(true);
    expect(paletteItemRegistry.get('ext-chem/molecule-viewer')).toEqual(mockItem);
    expect(paletteItemRegistry.getAll()).toHaveLength(1);

    // Query via getPaletteItemConfig helper
    const retrieved = getPaletteItemConfig('ext-chem/molecule-viewer');
    expect(retrieved).toEqual(mockItem);

    // Unregister by type
    paletteItemRegistry.unregister('ext-chem/molecule-viewer');
    expect(paletteItemRegistry.has('ext-chem/molecule-viewer')).toBe(false);
    expect(paletteItemRegistry.get('ext-chem/molecule-viewer')).toBeUndefined();
  });

  it('unregisters all palette items belonging to a specific plugin', () => {
    paletteItemRegistry.register({
      type: 'ext-physics/pendulum',
      labelZh: '单摆模拟',
      labelEn: 'Pendulum',
      descriptionZh: '物理单摆',
      descriptionEn: 'Physics pendulum',
      color: 'blue',
      group: 'extension',
      defaultData: {},
      editFields: [],
      pluginId: 'ext-physics',
    });

    paletteItemRegistry.register({
      type: 'ext-physics/spring',
      labelZh: '弹簧振子',
      labelEn: 'Spring',
      descriptionZh: '简谐运动',
      descriptionEn: 'Harmonic motion',
      color: 'blue',
      group: 'extension',
      defaultData: {},
      editFields: [],
      pluginId: 'ext-physics',
    });

    paletteItemRegistry.register({
      type: 'ext-bio/cell-viewer',
      labelZh: '细胞切片',
      labelEn: 'Cell Viewer',
      descriptionZh: '显微镜切片',
      descriptionEn: 'Cell slice viewer',
      color: 'emerald',
      group: 'extension',
      defaultData: {},
      editFields: [],
      pluginId: 'ext-bio',
    });

    expect(paletteItemRegistry.getAll()).toHaveLength(3);

    // Unregister physics plugin items
    paletteItemRegistry.unregisterPlugin('ext-physics');

    expect(paletteItemRegistry.getAll()).toHaveLength(1);
    expect(paletteItemRegistry.has('ext-physics/pendulum')).toBe(false);
    expect(paletteItemRegistry.has('ext-physics/spring')).toBe(false);
    expect(paletteItemRegistry.has('ext-bio/cell-viewer')).toBe(true);
  });

  it('getPaletteItemConfig falls back to built-in items for non-plugin types', () => {
    const builtinQuiz = getPaletteItemConfig('quiz');
    expect(builtinQuiz).toBeDefined();
    expect(builtinQuiz).toBe(PALETTE_ITEM_MAP['quiz']);

    const nonExistent = getPaletteItemConfig('unknown-type-xyz');
    expect(nonExistent).toBeUndefined();
  });

  it('FrontendPluginHost cleans up registered palette items when unregisterPluginResources is called', () => {
    const host = new FrontendPluginHost();
    const pluginId = 'ext-auto-cleanup-test';

    paletteItemRegistry.register(
      {
        type: 'ext-cleanup/widget',
        labelZh: '临时测试组件',
        labelEn: 'Temp Test Widget',
        descriptionZh: '测试自动卸载',
        descriptionEn: 'Testing auto cleanup',
        color: 'violet',
        group: 'extension',
        defaultData: {},
        editFields: [],
      },
      pluginId,
    );

    expect(paletteItemRegistry.has('ext-cleanup/widget')).toBe(true);

    // Call unregisterPluginResources on host
    host.unregisterPluginResources(pluginId);

    expect(paletteItemRegistry.has('ext-cleanup/widget')).toBe(false);
  });
});
