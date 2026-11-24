import { describe, expect, it, vi } from 'vitest';
import {
  collectCoursewareHosts,
  pickCoursewareHost,
  type CoursewareHostPluginRecord,
} from '../courseware-host-catalog.js';

function manifest(pluginId: string, hosts: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: pluginId,
    name: `Plugin ${pluginId}`,
    version: '1.0.0',
    main: 'index.js',
    contributes: { 'courseware.host': hosts },
    ...overrides,
  });
}

function plugin(pluginId: string, hosts: unknown[], state = 'active'): CoursewareHostPluginRecord {
  return { id: pluginId, state, status: state, manifest: manifest(pluginId, hosts) };
}

const host = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: id,
  view: `${id}.html`,
  replaces: 'builtin',
  ...extra,
});

describe('collectCoursewareHosts', () => {
  it('只收集已激活插件且 manifest 合法的宿主', () => {
    const directory = collectCoursewareHosts([
      plugin('ext-a', [host('a')]),
      plugin('ext-b', [host('b')], 'inactive'),
      { id: 'ext-c', state: 'active', status: 'active', manifest: '{bad json' },
    ]);
    expect(directory.candidates.map((candidate) => candidate.id)).toEqual(['a']);
    expect(directory.takeoverCandidates).toHaveLength(1);
  });

  it('安装期拒绝既无 view 也无 entry 的宿主', () => {
    const directory = collectCoursewareHosts([plugin('ext-a', [{ id: 'bad', label: 'bad', replaces: 'builtin' }])]);
    expect(directory.candidates).toHaveLength(0);
  });

  it('未声明 replaces 的宿主不参与接管', () => {
    const directory = collectCoursewareHosts([plugin('ext-a', [host('a', { replaces: undefined })])]);
    expect(directory.candidates).toHaveLength(1);
    expect(directory.takeoverCandidates).toHaveLength(0);
  });
});

describe('pickCoursewareHost', () => {
  it('无候选时回落内置宿主', () => {
    expect(pickCoursewareHost(collectCoursewareHosts([]))).toEqual({ kind: 'builtin', host: null, conflicts: [] });
  });

  it('按 priority 选唯一宿主并记录冲突', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const directory = collectCoursewareHosts([
      plugin('ext-low', [host('low', { priority: 1 })]),
      plugin('ext-high', [host('high', { priority: 10 })]),
    ]);
    const resolution = pickCoursewareHost(directory);
    expect(resolution.kind).toBe('plugin');
    expect(resolution.host?.id).toBe('high');
    expect(resolution.conflicts).toEqual(['ext-low:low']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('同优先级按插件 id 稳定决胜', () => {
    const directory = collectCoursewareHosts([plugin('ext-z', [host('z')]), plugin('ext-a', [host('a')])]);
    expect(pickCoursewareHost(directory).host?.pluginId).toBe('ext-a');
  });
});
