/**
 * F-2 回归：多段 manifest.id（`@scope/name`）在 REST 网关的识别。
 *
 * 背景：网关路由是 `app.all('/api/plugins/:pluginId/*')`，`:pluginId` 是单段
 * 参数。而 manifest.id 没有格式约束、社区市场的 id 校验正则
 * （PLUGIN_ID_PATTERN = /^@?[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$/）**明确允许
 * `/` 与 `@`** —— 因此 `@scope/name` 形式是合法且市场可安装的。
 *
 * 未修复时：这类插件的 REST 端点全部 404 或错派发（子路径首段被当成插件 id）。
 */
import { describe, it, expect } from 'vitest';
import { resolveScopedPluginId } from '../routes/plugin-api-gateway.js';

const hostWith = (ids: string[]) => ({ listInstalledPluginIds: () => ids });

describe('F-2 · 多段 manifest.id 重组（resolveScopedPluginId）', () => {
  const installed = ['@scope/plug-a', '@scope/plug-abcd', '@openscope/plug-a/x-tool'];

  it('未编码的多段 id + 子路径被重组回正确的 (manifest.id, subPath)', () => {
    const resolved = resolveScopedPluginId(hostWith(installed), '@scope/plug-a/health');
    expect(resolved).toEqual({ manifestId: '@scope/plug-a', subPath: 'health' });
  });

  it('取最长匹配（前缀歧义时短匹配会把归属判错）', () => {
    const resolved = resolveScopedPluginId(hostWith(installed), '@scope/plug-abcd/metrics/current');
    expect(resolved).toEqual({ manifestId: '@scope/plug-abcd', subPath: 'metrics/current' });
  });

  it('多级 scope id 同样支持', () => {
    const resolved = resolveScopedPluginId(hostWith(installed), '@openscope/plug-a/x-tool/run');
    expect(resolved).toEqual({ manifestId: '@openscope/plug-a/x-tool', subPath: 'run' });
  });

  it('路径恰好等于插件 id 时 subPath 为空', () => {
    const resolved = resolveScopedPluginId(hostWith(installed), '@scope/plug-a');
    expect(resolved).toEqual({ manifestId: '@scope/plug-a', subPath: '' });
  });

  it('前缀相同但不是该插件的路径不匹配', () => {
    // plug-a vs plug-a2 —— 要求 `/` 边界，`plug-a2/health` 不属于 `plug-a`
    expect(resolveScopedPluginId(hostWith(['@scope/plug-a']), '@scope/plug-a2/health')).toBeNull();
  });

  it('完全没有匹配的已安装插件时返回 null（交由既有逻辑 404）', () => {
    expect(resolveScopedPluginId(hostWith(installed), '@other/ext-z/ping')).toBeNull();
    expect(resolveScopedPluginId(hostWith(installed), 'no-slash-at-all')).toBeNull();
  });

  it('空仓库不抛错', () => {
    expect(resolveScopedPluginId(hostWith([]), '@scope/plug-a/health')).toBeNull();
  });
});
