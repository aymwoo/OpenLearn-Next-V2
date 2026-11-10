// @vitest-environment node
/**
 * 扩展点元数据防漂移测试（Issue #428）
 *
 * CORE_EXTENSION_POINTS 目前有三处副本：
 * - 运行时权威：packages/core/extension-points/metadata.ts
 * - CLI 零依赖副本：cli-doctor.mjs
 * - 判定逻辑：packages/core/extension-points/compatibility-reporter.ts（复用元数据，无独立清单）
 *
 * 本测试把前两者的字段钉成一致，避免只改一边导致升级兼容报告与运行时告警口径分裂。
 */
import { describe, it, expect } from 'vitest';
import { CORE_EXTENSION_POINTS as CLI_POINTS } from '../../cli-doctor.mjs';
import { CORE_EXTENSION_POINTS as RUNTIME_POINTS } from '../../packages/core/extension-points/metadata.js';

interface Point {
  id: string;
  kind: string;
  since: string;
  deprecated?: string;
  removedIn?: string;
  replacement?: string;
}

function normalize(points: readonly Point[]) {
  return [...points]
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      since: p.since,
      deprecated: p.deprecated ?? null,
      removedIn: p.removedIn ?? null,
      replacement: p.replacement ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

describe('CORE_EXTENSION_POINTS parity', () => {
  it('cli-doctor 与运行时元数据的条目和生命周期字段完全一致', () => {
    expect(normalize(CLI_POINTS as Point[])).toEqual(normalize(RUNTIME_POINTS as unknown as Point[]));
  });

  it('没有重复 id', () => {
    const ids = (RUNTIME_POINTS as unknown as Point[]).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
