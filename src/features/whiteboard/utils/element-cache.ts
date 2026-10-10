/**
 * High-performance LRU cache for parsed whiteboard element data.
 *
 * Eliminates thousands of redundant JSON.parse() calls per second during
 * 60 FPS drag and resize interactions.
 */

const MAX_CACHE_SIZE = 1000;
const parsedDataCache = new Map<string, any>();

/**
 * Parses element data JSON with LRU caching and safe fallback.
 *
 * @param el Element object with .data or raw JSON string
 * @param fallback Fallback value if JSON parsing fails
 * @returns Parsed object (cached reference if unchanged)
 */
export function parseElementData<T = Record<string, any>>(
  el: { id?: string; data: string } | string | null | undefined,
  fallback?: T,
): T {
  const defaultFallback = (fallback !== undefined ? fallback : {}) as T;
  if (!el) return defaultFallback;

  const rawJson = typeof el === 'string' ? el : el.data;
  if (!rawJson || typeof rawJson !== 'string') {
    return (rawJson as any) || defaultFallback;
  }

  // Fast path: Cache hit
  if (parsedDataCache.has(rawJson)) {
    const cached = parsedDataCache.get(rawJson);
    // Refresh LRU order: delete and re-insert
    parsedDataCache.delete(rawJson);
    parsedDataCache.set(rawJson, cached);
    return cached;
  }

  // Slow path: JSON.parse
  try {
    const parsed = JSON.parse(rawJson);
    // Evict oldest if capacity exceeded
    if (parsedDataCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = parsedDataCache.keys().next().value;
      if (oldestKey !== undefined) {
        parsedDataCache.delete(oldestKey);
      }
    }
    parsedDataCache.set(rawJson, parsed);
    return parsed;
  } catch (error) {
    console.warn('[parseElementData] Failed to parse element data:', error, rawJson);
    return defaultFallback;
  }
}

/**
 * Clear the element data cache (useful for testing or cache invalidation).
 */
export function clearElementDataCache(): void {
  parsedDataCache.clear();
}

/**
 * Current cache size for metrics and diagnostics.
 */
export function getElementDataCacheSize(): number {
  return parsedDataCache.size;
}
