import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlReadCache } from '../ttl-cache.js';

describe('TtlReadCache 单元测试 (Issue #409)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. 基础读写与存在性检查 (get / set / has)', () => {
    const cache = new TtlReadCache<string>({ defaultTtlMs: 2000 });
    expect(cache.has('k1')).toBe(false);
    expect(cache.get('k1')).toBeUndefined();

    cache.set('k1', 'val1');
    expect(cache.has('k1')).toBe(true);
    expect(cache.get('k1')).toBe('val1');

    const stats = cache.getStats();
    expect(stats.hits).toBe(2); // has + get
    expect(stats.misses).toBe(2); // initial has + get
    expect(stats.size).toBe(1);
  });

  it('2. TTL 自动过期机制', () => {
    const cache = new TtlReadCache<number>({ defaultTtlMs: 1000 });
    cache.set('count', 42);

    expect(cache.get('count')).toBe(42);

    // 前进 500ms（仍在 TTL 内）
    vi.advanceTimersByTime(500);
    expect(cache.get('count')).toBe(42);

    // 再前进 501ms（超过 1000ms TTL）
    vi.advanceTimersByTime(501);
    expect(cache.has('count')).toBe(false);
    expect(cache.get('count')).toBeUndefined();

    const stats = cache.getStats();
    expect(stats.evictions).toBeGreaterThanOrEqual(1);
  });

  it('3. 自定义单项 TTL', () => {
    const cache = new TtlReadCache<string>({ defaultTtlMs: 5000 });
    cache.set('short', 'expire_soon', 500);
    cache.set('long', 'persist_longer', 10000);

    vi.advanceTimersByTime(600);
    expect(cache.get('short')).toBeUndefined();
    expect(cache.get('long')).toBe('persist_longer');
  });

  it('4. 同步 getOrCompute 穿透防护', () => {
    const cache = new TtlReadCache<{ data: string }>({ defaultTtlMs: 3000 });
    const computeFn = vi.fn(() => ({ data: 'computed_result' }));

    // 第一次调用：缓存未命中，触发 computeFn
    const res1 = cache.getOrCompute('k_comp', computeFn);
    expect(res1).toEqual({ data: 'computed_result' });
    expect(computeFn).toHaveBeenCalledTimes(1);

    // 第二次调用（TTL 内）：命中缓存，不应再次触发 computeFn
    const res2 = cache.getOrCompute('k_comp', computeFn);
    expect(res2).toEqual({ data: 'computed_result' });
    expect(computeFn).toHaveBeenCalledTimes(1);

    // 过期后再调用：重新触发计算
    vi.advanceTimersByTime(3001);
    const res3 = cache.getOrCompute('k_comp', computeFn);
    expect(res3).toEqual({ data: 'computed_result' });
    expect(computeFn).toHaveBeenCalledTimes(2);
  });

  it('5. 异步 getOrComputeAsync 支持', async () => {
    const cache = new TtlReadCache<number>({ defaultTtlMs: 3000 });
    const asyncCompute = vi.fn(async () => 100);

    const res1 = await cache.getOrComputeAsync('async_k', asyncCompute);
    expect(res1).toBe(100);
    expect(asyncCompute).toHaveBeenCalledTimes(1);

    const res2 = await cache.getOrComputeAsync('async_k', asyncCompute);
    expect(res2).toBe(100);
    expect(asyncCompute).toHaveBeenCalledTimes(1);
  });

  it('6. 前缀批量失效与精确失效', () => {
    const cache = new TtlReadCache<string>({ defaultTtlMs: 5000 });
    cache.set('tp:les_01:all:5', 'data1');
    cache.set('tp:les_01:classA:5', 'data2');
    cache.set('tp:les_02:all:5', 'data3');
    cache.set('tp:global:all:5', 'data4');

    expect(cache.getStats().size).toBe(4);

    // 精确失效
    const removed = cache.invalidate('tp:global:all:5');
    expect(removed).toBe(true);
    expect(cache.get('tp:global:all:5')).toBeUndefined();

    // 前缀批量失效：按 lessonId 维度淘汰
    const evictedCount = cache.invalidatePrefix('tp:les_01:');
    expect(evictedCount).toBe(2);
    expect(cache.get('tp:les_01:all:5')).toBeUndefined();
    expect(cache.get('tp:les_01:classA:5')).toBeUndefined();

    // 其他课节不受影响
    expect(cache.get('tp:les_02:all:5')).toBe('data3');
  });

  it('7. 条件匹配批量失效 (invalidateMatching) 与 clear', () => {
    const cache = new TtlReadCache<number>({ defaultTtlMs: 5000 });
    cache.set('session:s1:pacing', 1);
    cache.set('session:s2:pacing', 2);
    cache.set('report:s1', 3);

    const count = cache.invalidateMatching((k) => k.includes(':pacing'));
    expect(count).toBe(2);
    expect(cache.get('session:s1:pacing')).toBeUndefined();
    expect(cache.get('report:s1')).toBe(3);

    cache.clear();
    expect(cache.getStats().size).toBe(0);
    expect(cache.get('report:s1')).toBeUndefined();
  });

  it('8. 容量上限与 LRU / FIFO 淘汰守护', () => {
    const cache = new TtlReadCache<number>({ maxEntries: 3, defaultTtlMs: 10000 });
    cache.set('k1', 1);
    cache.set('k2', 2);
    cache.set('k3', 3);

    // 访问 k1，使 k1 成为最近访问项（k2 成为最久未访问项）
    cache.get('k1');

    // 写入第 4 个条目，触发 LRU 淘汰
    cache.set('k4', 4);

    expect(cache.getStats().size).toBe(3);
    expect(cache.get('k2')).toBeUndefined(); // k2 被淘汰
    expect(cache.get('k1')).toBe(1);
    expect(cache.get('k3')).toBe(3);
    expect(cache.get('k4')).toBe(4);
  });

  it('9. 假值（falsy values）与边界情况处理', () => {
    const cache = new TtlReadCache<any>({ defaultTtlMs: 3000 });
    cache.set('zero', 0);
    cache.set('empty_str', '');
    cache.set('bool_false', false);
    cache.set('null_val', null);

    expect(cache.get('zero')).toBe(0);
    expect(cache.get('empty_str')).toBe('');
    expect(cache.get('bool_false')).toBe(false);
    expect(cache.get('null_val')).toBeNull();

    // 0 或负数 TTL 不应写入
    cache.set('no_cache', 'skip', 0);
    expect(cache.get('no_cache')).toBeUndefined();

    cache.set('negative_ttl', 'skip', -100);
    expect(cache.get('negative_ttl')).toBeUndefined();
  });

  it('10. 命中率与指标统计 (CacheStats)', () => {
    const cache = new TtlReadCache<string>({ defaultTtlMs: 2000 });
    cache.set('item', 'val');

    cache.get('item'); // hit 1
    cache.get('item'); // hit 2
    cache.get('miss1'); // miss 1
    cache.get('miss2'); // miss 2

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(2);
    expect(stats.hitRatio).toBe(0.5);

    cache.resetStats();
    expect(cache.getStats().hits).toBe(0);
    expect(cache.getStats().misses).toBe(0);
  });
});
