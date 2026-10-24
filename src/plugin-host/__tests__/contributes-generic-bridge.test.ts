// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FrontendPluginHost, registerManifestContributions } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';
import { PluginState } from '../types';
import type {
  IFrontendAPI,
  ISocketService,
  IUIService,
  IStorageService,
  FrontendPluginManifest,
  FrontendPluginContext,
} from '../types';
import { paletteItemRegistry } from '../../features/teacher/lesson-editor/palette-item-registry';
import {
  getAllSegmentTypes,
  getSegmentType,
  unregisterPluginSegmentTypes,
} from '../../features/teacher/lesson-editor/timelineConfig';

/**
 * manifest contributes 通用声明式桥接回归测试（v0.6.0 遗留债务 ①）。
 *
 * 此前仅 5 个硬编码槽位被桥接，schema 放行的其余槽位全部静默丢弃——
 * 第三方插件照 manifest schema 声明 contributes 必然白写。通用循环后，
 * 任何数组型 contributes 键都必须抵达 store，且 commandType 前缀化。
 */

function createMockServices() {
  return {
    frontendApi: { get: vi.fn(), post: vi.fn(), del: vi.fn() } as unknown as IFrontendAPI,
    socketService: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), disconnect: vi.fn() } as unknown as ISocketService,
    uiService: { showToast: vi.fn(), showModal: vi.fn(), closeModal: vi.fn() } as unknown as IUIService,
    storageService: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn() } as unknown as IStorageService,
  };
}

const mockServices = createMockServices();

async function activateWithManifest(manifest: Record<string, unknown>): Promise<void> {
  const fullManifest = { id: 'test-plugin', name: 'Test Plugin', version: '1.0.0', ...manifest };
  const plugin = {
    manifest: fullManifest as unknown as FrontendPluginManifest,
    activate: vi.fn().mockResolvedValue(undefined),
  };
  const host = new FrontendPluginHost({
    moduleLoader: async () => ({ default: plugin }),
  });
  await host.initialize(
    mockServices.frontendApi,
    mockServices.socketService,
    mockServices.uiService,
    mockServices.storageService,
  );
  await host.installPlugin(fullManifest as unknown as FrontendPluginManifest, JSON.stringify(fullManifest));
  await host.activatePlugin('test-plugin');
}

describe('manifest contributes 通用桥接（遗留债务 ① 回归）', () => {
  beforeEach(() => {
    usePluginHostStore.setState({ activePlugins: [], extensionPoints: new Map() });
    paletteItemRegistry.unregisterPlugin('test-plugin');
    unregisterPluginSegmentTypes('test-plugin');
  });

  it('非白名单槽位（class.tab）的 contributes 不再被静默丢弃', async () => {
    await activateWithManifest({
      contributes: {
        'class.tab': [{ id: 'tab1', label: '班级统计', position: 2 }],
      },
    });

    const entries = usePluginHostStore.getState().getExtensions('class.tab');
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('tab1');
    expect(entries[0].label).toBe('班级统计');
    expect(entries[0].pluginId).toBe('test-plugin');
    expect(entries[0].slotProps).toMatchObject({ id: 'tab1', label: '班级统计' });
  });

  it('command_palette.item 的 commandType 按插件命名空间前缀化', async () => {
    await activateWithManifest({
      contributes: {
        'command_palette.item': [{ id: 'cmd1', title: '计算器', commandType: 'calc.run', payload: { precision: 2 } }],
      },
    });

    const entries = usePluginHostStore.getState().getExtensions('command_palette.item');
    expect(entries).toHaveLength(1);
    expect(entries[0].slotProps).toMatchObject({
      commandType: 'test-plugin.calc.run',
      payload: { precision: 2 },
    });
  });

  it('label 解析顺序 title → label → name（ai.skill.provider 用 name）', async () => {
    await activateWithManifest({
      contributes: {
        'ai.skill.provider': [{ id: 'prov1', name: 'calc_tool', description: 'Calculator' }],
        'course.card.badge': [{ id: 'badge1', label: '已认证' }],
      },
    });

    const prov = usePluginHostStore.getState().getExtensions('ai.skill.provider');
    expect(prov[0].label).toBe('calc_tool');
    const badge = usePluginHostStore.getState().getExtensions('course.card.badge');
    expect(badge[0].label).toBe('已认证');
  });

  it('legacy manifest.classroomTools 存在时，contributes["classroom.tool"] 被跳过（防双注册）', async () => {
    await activateWithManifest({
      classroomTools: [{ id: 'legacy-tool', name: 'Legacy Tool' }],
      contributes: {
        'classroom.tool': [{ id: 'contrib-tool', name: 'Contrib Tool' }],
      },
    });

    const entries = usePluginHostStore.getState().getExtensions('classroom.tool');
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('legacy-tool');
  });

  it('无 legacy classroomTools 时，contributes["classroom.tool"] 正常注册', async () => {
    await activateWithManifest({
      contributes: {
        'classroom.tool': [{ id: 'contrib-tool', name: 'Contrib Tool', commandType: 'tool.ping' }],
      },
    });

    const entries = usePluginHostStore.getState().getExtensions('classroom.tool');
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Contrib Tool');
    expect(entries[0].slotProps).toMatchObject({ commandType: 'test-plugin.tool.ping' });
  });

  it('远程激活路径语义：store 归属用流程 id，commandType 命名空间用 manifest.id（C-1 回归钉）', () => {
    // v0.6.1 审计 C-1：生产唯一远程激活路径 activateRemotePlugin 曾不含桥接。
    // 该测试直接钉共享注册函数的双 id 语义 —— 归属 id（unregisterPluginResources
    // 的清理键）与命名空间 id（plugin-namespace 契约要求 manifest.id）分离。
    const dbId = '019f6029-884d-71dd-a4f1-31f815fa9698';
    registerManifestContributions(usePluginHostStore.getState(), dbId, '@scope/remote-plugin', {
      id: '@scope/remote-plugin',
      name: 'Remote',
      version: '1.0.0',
      contributes: {
        'command_palette.item': [{ id: 'cmd1', title: '远程命令', commandType: 'remote.act' }],
      },
    } as any);
    const entries = usePluginHostStore.getState().getExtensions('command_palette.item');
    expect(entries).toHaveLength(1);
    expect(entries[0].pluginId).toBe(dbId);
    expect(entries[0].slotProps).toMatchObject({ commandType: '@scope/remote-plugin.remote.act' });
  });

  it('激活后插件状态为 ACTIVE（桥接不阻断生命周期）', async () => {
    await activateWithManifest({
      contributes: {
        'class.tab': [{ id: 'tab1', label: 'Tab' }],
      },
    });
    const active = usePluginHostStore.getState().activePlugins.find((p) => p.id === 'test-plugin');
    expect(active?.state).toBe(PluginState.ACTIVE);
  });

  it('editor.palette_item 数据贡献桥接到 paletteItemRegistry', async () => {
    await activateWithManifest({
      contributes: {
        'editor.palette_item': [
          {
            id: 'mol-viewer',
            type: 'ext-chem/molecule-viewer',
            labelZh: '3D 分子探究器',
            labelEn: '3D Molecule Viewer',
            descriptionZh: '分子可视化',
            color: 'emerald',
            group: 'media',
          },
        ],
      },
    });

    expect(paletteItemRegistry.has('ext-chem/molecule-viewer')).toBe(true);
    expect(paletteItemRegistry.get('ext-chem/molecule-viewer')?.labelZh).toBe('3D 分子探究器');
    expect(usePluginHostStore.getState().getExtensions('editor.palette_item')).toHaveLength(1);
  });

  it('editor.timeline_segment 含 labelZh+labelEn 时桥接为环节类型', async () => {
    await activateWithManifest({
      contributes: {
        'editor.timeline_segment': [
          {
            id: 'scientific_experiment',
            labelZh: '科学探究实验',
            labelEn: 'Scientific Experiment',
            icon: 'FlaskConical',
          },
        ],
      },
    });

    expect(getSegmentType('scientific_experiment').labelZh).toBe('科学探究实验');
    expect(getAllSegmentTypes().some((t) => t.id === 'scientific_experiment')).toBe(true);
  });

  it('editor.timeline_segment 无双语 label 时不写入环节类型注册表', async () => {
    await activateWithManifest({
      contributes: {
        'editor.timeline_segment': [{ id: 'panel-only', label: '附加面板', commandType: 'panel.open' }],
      },
    });

    expect(getAllSegmentTypes().map((t) => t.id)).not.toContain('panel-only');
    expect(usePluginHostStore.getState().getExtensions('editor.timeline_segment')).toHaveLength(1);
  });
});
