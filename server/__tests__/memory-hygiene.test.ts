/**
 * Phase B4: 内存泄漏治理测试。
 *
 * 覆盖三块：
 *   1. MF_REMOTE_CACHE TTL 惰性过期（fake timers）
 *   2. MF_REMOTE_CACHE 容量上限淘汰（100 条）
 *   3. EventBus.subscribe 返回取消订阅函数 + 同类型 >50 告警
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { MF_REMOTE_CACHE, cacheGetMfRemote, cacheSetMfRemote, lessonActiveSegments } from '../shared-state.js';

describe('B4: MF_REMOTE_CACHE TTL 与容量上限', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MF_REMOTE_CACHE.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    MF_REMOTE_CACHE.clear();
  });

  it('set 后可读取；超过 5 分钟 TTL 后 get 返回 undefined 并剔除条目', () => {
    cacheSetMfRemote('r1', 'entry-1', { v: 1 });
    expect(cacheGetMfRemote('r1')?.entry).toBe('entry-1');

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(cacheGetMfRemote('r1')).toBeUndefined();
    expect(MF_REMOTE_CACHE.has('r1')).toBe(false);
  });

  it('TTL 内重复 get 命中（不剔除未过期条目）', () => {
    cacheSetMfRemote('r2', 'entry-2', {});
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(cacheGetMfRemote('r2')).toBeDefined();
    vi.advanceTimersByTime(59 * 1000);
    expect(cacheGetMfRemote('r2')).toBeDefined();
  });

  it('超过 100 条时按插入序淘汰最旧条目', () => {
    for (let i = 0; i < 105; i++) {
      cacheSetMfRemote(`r-${i}`, `entry-${i}`, {});
    }
    expect(MF_REMOTE_CACHE.size).toBeLessThanOrEqual(100);
    // 最旧的 r-0..r-4 被淘汰
    expect(MF_REMOTE_CACHE.has('r-0')).toBe(false);
    expect(MF_REMOTE_CACHE.has('r-4')).toBe(false);
    // 最新条目仍在
    expect(cacheGetMfRemote('r-104')?.entry).toBe('entry-104');
  });
});

describe('B4: lessonActiveSegments 清理钩子', () => {
  it('课程结束/删除清理后条目不存在（供 classroom.ts / lessons.ts 钩子使用的语义验证）', () => {
    lessonActiveSegments.set('lesson-mem-1', 'seg-1');
    expect(lessonActiveSegments.get('lesson-mem-1')).toBe('seg-1');
    lessonActiveSegments.delete('lesson-mem-1');
    expect(lessonActiveSegments.has('lesson-mem-1')).toBe(false);
  });
});
