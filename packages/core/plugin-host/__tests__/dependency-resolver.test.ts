/**
 * Dependency Resolver 单元测试（V3.0）。
 */
import { describe, it, expect } from 'vitest';
import {
  buildDepGraph,
  topologicalSort,
  checkMissingDeps,
  detectCycle,
  computeActivationOrder,
} from '../dependency-resolver.js';
import type { Manifest } from '../../esm-loader/manifest-schema.js';

function makeManifest(id: string, deps?: string[]): Manifest {
  return {
    id,
    name: `Plugin ${id}`,
    version: '1.0.0',
    main: 'index.js',
    pluginDependencies: deps,
  };
}

describe('buildDepGraph', () => {
  it('从 manifest 映射构建依赖图', () => {
    const manifests = new Map<string, Manifest>();
    manifests.set('ext-a', makeManifest('ext-a', ['ext-b', 'ext-c']));
    manifests.set('ext-b', makeManifest('ext-b'));
    manifests.set('ext-c', makeManifest('ext-c', ['ext-b']));

    const graph = buildDepGraph(manifests);
    expect(graph.get('ext-a')).toEqual(['ext-b', 'ext-c']);
    expect(graph.get('ext-b')).toEqual([]);
    expect(graph.get('ext-c')).toEqual(['ext-b']);
  });
});

describe('topologicalSort', () => {
  it('线性依赖链 — 按顺序排列', () => {
    const graph = new Map<string, string[]>();
    graph.set('ext-c', ['ext-b']);
    graph.set('ext-b', ['ext-a']);
    graph.set('ext-a', []);

    const { sorted, blocked, cycles } = topologicalSort(graph, ['ext-a', 'ext-b', 'ext-c']);
    expect(sorted).toEqual(['ext-a', 'ext-b', 'ext-c']);
    expect(blocked).toHaveLength(0);
    expect(cycles).toHaveLength(0);
  });

  it('无依赖的独立插件 — 按任意顺序', () => {
    const graph = new Map<string, string[]>();
    graph.set('ext-a', []);
    graph.set('ext-b', []);
    graph.set('ext-c', []);

    const { sorted } = topologicalSort(graph, ['ext-a', 'ext-b', 'ext-c']);
    // 无依赖 → 任意顺序，3 个均在已排序列表中
    expect(sorted).toHaveLength(3);
    expect(sorted).toEqual(expect.arrayContaining(['ext-a', 'ext-b', 'ext-c']));
  });

  it('缺失依赖 → 阻止', () => {
    const graph = new Map<string, string[]>();
    graph.set('ext-a', ['ext-missing']); // 未安装的依赖
    graph.set('ext-b', []);

    const { sorted, blocked } = topologicalSort(
      graph,
      ['ext-a', 'ext-b'],
    );
    expect(sorted).toEqual(['ext-b']);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].pluginId).toBe('ext-a');
    expect(blocked[0].missingDeps).toContain('ext-missing');
  });

  it('非活跃依赖 → 阻止', () => {
    const graph = new Map<string, string[]>();
    graph.set('ext-a', ['ext-b']); // ext-b 已安装但不在 active 集中
    graph.set('ext-b', []);

    const { sorted, blocked } = topologicalSort(
      graph,
      ['ext-a', 'ext-b'],
      new Set(['ext-a']), // 仅 ext-a 活跃，ext-b 不在集合中
    );
    expect(sorted).toEqual([]);
    expect(blocked).toHaveLength(1);
  });

  it('循环检测', () => {
    const graph = new Map<string, string[]>();
    graph.set('ext-a', ['ext-b']);
    graph.set('ext-b', ['ext-a']); // 成环

    const { cycles } = topologicalSort(graph, ['ext-a', 'ext-b']);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('菱形依赖 — 无阻塞', () => {
    const graph = new Map<string, string[]>();
    graph.set('ext-d', ['ext-b', 'ext-c']);
    graph.set('ext-b', ['ext-a']);
    graph.set('ext-c', ['ext-a']);
    graph.set('ext-a', []);

    const { sorted, blocked } = topologicalSort(graph, ['ext-a', 'ext-b', 'ext-c', 'ext-d']);
    expect(sorted[0]).toBe('ext-a');
    expect(sorted[3]).toBe('ext-d');
    expect(blocked).toHaveLength(0);
  });
});

describe('checkMissingDeps', () => {
  it('返回缺失的依赖', () => {
    const installed = new Set(['ext-a', 'ext-b']);
    const missing = checkMissingDeps(['ext-a', 'ext-c', 'ext-d'], installed);
    expect(missing).toEqual(['ext-c', 'ext-d']);
  });

  it('全部满足 → 返回空', () => {
    const installed = new Set(['ext-a', 'ext-b', 'ext-c']);
    expect(checkMissingDeps(['ext-a', 'ext-b'], installed)).toHaveLength(0);
  });
});

describe('detectCycle', () => {
  it('无循环 → 返回 null', () => {
    const graph = new Map<string, string[]>();
    graph.set('ext-a', ['ext-b']);
    graph.set('ext-b', ['ext-c']);
    graph.set('ext-c', []);

    expect(detectCycle('ext-a', graph)).toBeNull();
  });

  it('直接循环（A→B→A）→ 检测到', () => {
    const graph = new Map<string, string[]>();
    graph.set('ext-a', ['ext-b']);
    graph.set('ext-b', ['ext-a']);

    const cycle = detectCycle('ext-a', graph);
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe('ext-a');
  });

  it('间接循环（A→B→C→A）→ 检测到', () => {
    const graph = new Map<string, string[]>();
    graph.set('ext-a', ['ext-b']);
    graph.set('ext-b', ['ext-c']);
    graph.set('ext-c', ['ext-a']);

    const cycle = detectCycle('ext-a', graph);
    expect(cycle).not.toBeNull();
  });
});

describe('computeActivationOrder', () => {
  it('按依赖顺序排序', () => {
    const manifests = new Map<string, Manifest>();
    manifests.set('ext-c', makeManifest('ext-c', ['ext-b']));
    manifests.set('ext-b', makeManifest('ext-b', ['ext-a']));
    manifests.set('ext-a', makeManifest('ext-a'));

    const { sorted } = computeActivationOrder(manifests, new Set(['ext-a', 'ext-b', 'ext-c']));
    expect(sorted).toEqual(['ext-a', 'ext-b', 'ext-c']);
  });
});
