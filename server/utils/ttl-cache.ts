/**
 * 内存级 TTL 只读缓存 (In-Memory TTL Read Cache)
 *
 * 针对高并发场景下的高频报表统计与多表慢聚合读查询设计（Issue #409）。
 * 提供基于 TTL 自动过期、LRU 容量上限守护、命名空间/前缀主动失效与指标统计。
 */

export interface TtlCacheOptions {
  /** 默认存活时间（毫秒），默认 3000ms (3s) */
  defaultTtlMs?: number;
  /** 最大条目容量上限，防止高并发下因动态 Key 导致内存膨胀，默认 2048 */
  maxEntries?: number;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  invalidations: number;
  size: number;
  hitRatio: number;
}

export class TtlReadCache<T = any> {
  private readonly map = new Map<string, CacheEntry<T>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  private hits = 0;
  private misses = 0;
  private sets = 0;
  private evictions = 0;
  private invalidations = 0;

  constructor(options: TtlCacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 3000;
    this.maxEntries = options.maxEntries ?? 2048;
  }

  /**
   * 内部检索并校验条目：自动处理过期与 LRU 顺序更新
   */
  private getEntry(key: string): CacheEntry<T> | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.map.delete(key);
      this.misses++;
      this.evictions++;
      return undefined;
    }

    // LRU touch：移动到 Map 末尾作为最近使用
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry;
  }

  /**
   * 读取缓存项。若已过期或不存在则返回 undefined。
   */
  public get(key: string): T | undefined {
    const entry = this.getEntry(key);
    return entry ? entry.value : undefined;
  }

  /**
   * 判断是否存在有效缓存项
   */
  public has(key: string): boolean {
    return this.getEntry(key) !== undefined;
  }

  /**
   * 写入缓存项
   */
  public set(key: string, value: T, ttlMs?: number): void {
    const effectiveTtl = ttlMs !== undefined ? ttlMs : this.defaultTtlMs;
    if (effectiveTtl <= 0) {
      return;
    }

    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // 达到容量阈值时，优先清理已过期的条目
      const now = Date.now();
      for (const [k, e] of this.map.entries()) {
        if (now > e.expiresAt) {
          this.map.delete(k);
          this.evictions++;
        }
      }

      // 若仍然满容，淘汰最久未访问条目 (FIFO / LRU 头部)
      if (this.map.size >= this.maxEntries) {
        const oldestKey = this.map.keys().next().value;
        if (oldestKey !== undefined) {
          this.map.delete(oldestKey);
          this.evictions++;
        }
      }
    }

    const now = Date.now();
    this.map.set(key, {
      value,
      expiresAt: now + effectiveTtl,
      createdAt: now,
    });
    this.sets++;
  }

  /**
   * 同步读取或计算：若命中缓存且未过期则直接返回，否则调用 computeFn 计算并写入缓存
   */
  public getOrCompute(key: string, computeFn: () => T, ttlMs?: number): T {
    const entry = this.getEntry(key);
    if (entry !== undefined) {
      return entry.value;
    }
    const computed = computeFn();
    this.set(key, computed, ttlMs);
    return computed;
  }

  /**
   * 异步读取或计算：若命中缓存且未过期则直接返回，否则异步调用 computeFn 计算并写入缓存
   */
  public async getOrComputeAsync(key: string, computeFn: () => Promise<T>, ttlMs?: number): Promise<T> {
    const entry = this.getEntry(key);
    if (entry !== undefined) {
      return entry.value;
    }
    const computed = await computeFn();
    this.set(key, computed, ttlMs);
    return computed;
  }

  /**
   * 精确失效指定缓存项
   */
  public invalidate(key: string): boolean {
    if (this.map.delete(key)) {
      this.invalidations++;
      return true;
    }
    return false;
  }

  /**
   * 前缀批量失效：删除所有以 prefix 开头的缓存项
   * 例如 `invalidatePrefix('tp:les_01:')` 或 `invalidatePrefix('panoramic:')`
   */
  public invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
        count++;
      }
    }
    this.invalidations += count;
    return count;
  }

  /**
   * 匹配批量失效：根据自定义谓词批量淘汰
   */
  public invalidateMatching(predicate: (key: string) => boolean): number {
    let count = 0;
    for (const key of this.map.keys()) {
      if (predicate(key)) {
        this.map.delete(key);
        count++;
      }
    }
    this.invalidations += count;
    return count;
  }

  /**
   * 清空全部缓存
   */
  public clear(): void {
    const count = this.map.size;
    this.map.clear();
    this.invalidations += count;
  }

  /**
   * 获取当前缓存统计与命中率
   */
  public getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      evictions: this.evictions,
      invalidations: this.invalidations,
      size: this.map.size,
      hitRatio: total > 0 ? parseFloat((this.hits / total).toFixed(4)) : 0,
    };
  }

  /**
   * 重置统计计数器
   */
  public resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.evictions = 0;
    this.invalidations = 0;
  }
}

/**
 * 课堂只读路由共享全局缓存（用于 stage-data、panoramic-report、pacing-summary 等）
 */
export const classroomReadCache = new TtlReadCache<any>({ defaultTtlMs: 3000, maxEntries: 2048 });

/**
 * 失效课堂路由相关缓存
 */
export function invalidateClassroomReadCache(lessonId?: string, sessionId?: string): void {
  if (sessionId) {
    classroomReadCache.invalidate(`pacing-agg:${sessionId}`);
    classroomReadCache.invalidate(`pacing-summary:${sessionId}`);
    classroomReadCache.invalidate(`exit-ticket-summary:${sessionId}`);
    if (lessonId) {
      classroomReadCache.invalidatePrefix(`panoramic:${lessonId}:${sessionId}`);
    }
  }
  if (lessonId) {
    classroomReadCache.invalidatePrefix(`stage-db:${lessonId}:`);
    classroomReadCache.invalidatePrefix(`panoramic:${lessonId}:`);
  }
  if (!lessonId && !sessionId) {
    classroomReadCache.clear();
  }
}

/**
 * 重置课堂路由缓存（供测试清理）
 */
export function resetClassroomReadCache(): void {
  classroomReadCache.clear();
  classroomReadCache.resetStats();
}
