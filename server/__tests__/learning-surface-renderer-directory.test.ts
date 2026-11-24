import { describe, it, expect } from 'vitest';
import { listLearningSurfaceRenderers } from '../services/learning-surface-service.js';
import { manifestSchema } from '../../packages/core/esm-loader/manifest-schema.js';

/**
 * 阶段 4：插件渲染器目录与 manifest 校验。
 *
 * 覆盖：
 *   - 已激活插件的 `learning.surface` 声明会进入目录，并带上 view；
 *   - 非法的 view（穿越 / 协议 / 绝对路径）不会下发到宿主（只丢 view，不丢渲染器）；
 *   - 安装期 manifestSchema 拒绝缺 view/entry、坏 sourceKind、未知字段。
 */

function pluginRecord(id: string, contribution: Record<string, unknown>) {
  return {
    id,
    state: 'active',
    manifest: {
      id,
      contributes: { 'learning.surface': [contribution] },
    },
  };
}

describe('LearningSurface 渲染器目录（阶段 4）', () => {
  it('返回插件渲染器的 pluginId 与安全 view', () => {
    const renderers = listLearningSurfaceRenderers([
      pluginRecord('ext-quiz', {
        id: 'plugin-quiz',
        label: '插件测验',
        view: 'surface.html',
        sourceKinds: ['resource'],
        capabilities: ['progress', 'submittable'],
        defaultSize: { width: 640, height: 400 },
      }),
    ]);

    const renderer = renderers.find((item) => item.id === 'plugin-quiz');
    expect(renderer).toMatchObject({
      execution: 'sandbox',
      pluginId: 'ext-quiz',
      view: 'surface.html',
    });
  });

  it('拒绝穿越 / 协议 / 绝对路径的 view', () => {
    for (const badView of ['../secret.html', '/etc/passwd', 'https://evil.example/x.html', 'a\\b.html']) {
      const renderers = listLearningSurfaceRenderers([
        pluginRecord('ext-bad', {
          id: `bad-${badView.length}`,
          label: '坏视图',
          view: badView,
          sourceKinds: ['resource'],
        }),
      ]);
      const renderer = renderers.find((item) => item.id === `bad-${badView.length}`);
      expect(renderer?.view).toBeUndefined();
    }
  });

  it('manifest 通过合法声明', () => {
    const result = manifestSchema.safeParse({
      id: 'ext-ok',
      name: '示例',
      version: '1.0.0',
      main: 'index.js',
      contributes: {
        'learning.surface': [
          {
            id: 'plugin-ok',
            label: '示例渲染器',
            view: 'surface/index.html',
            sourceKinds: ['courseware', 'resource'],
            capabilities: ['progress'],
            defaultSize: { width: 800, height: 600 },
            aspectRatio: '4:3',
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('manifest 拒绝缺 view/entry、坏 sourceKind 与未知字段', () => {
    const base = {
      id: 'ext-bad',
      name: '坏插件',
      version: '1.0.0',
      main: 'index.js',
    };
    const parse = (contribution: Record<string, unknown>) =>
      manifestSchema.safeParse({
        ...base,
        contributes: { 'learning.surface': [contribution] },
      });

    expect(parse({ id: 'a', label: 'A', sourceKinds: ['resource'] }).success).toBe(false);
    expect(parse({ id: 'b', label: 'B', view: 'x.html', sourceKinds: ['nope'] }).success).toBe(false);
    expect(parse({ id: 'c', label: 'C', view: 'x.html', sourceKinds: ['resource'], evil: true }).success).toBe(false);
    expect(parse({ id: 'd', label: 'D', view: '../x.html', sourceKinds: ['resource'] }).success).toBe(false);
  });
});
