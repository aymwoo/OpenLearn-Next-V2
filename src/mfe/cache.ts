/**
 * In-memory MFE entry URL cache with TTL-based expiration.
 *
 * D-24: First query caches the result; subsequent MfeLoader instances with
 * the same name reuse cached result, avoiding duplicate network requests.
 * TTL is set to 60 seconds (60000 ms).
 */

/** Cache TTL in milliseconds (1 minute) */
const TTL = 60000;

interface CacheEntry {
  entry: string;
  meta: Record<string, any>;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Get a cached entry by key.
 * Returns null if the key is missing or the entry has expired.
 */
export function get(key: string): { entry: string; meta: Record<string, any> } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL) {
    cache.delete(key);
    return null;
  }
  return { entry: entry.entry, meta: entry.meta };
}

/**
 * Set a cache entry with current timestamp.
 */
export function set(key: string, data: { entry: string; meta: Record<string, any> }): void {
  cache.set(key, { ...data, timestamp: Date.now() });
}

/**
 * Invalidate a specific cache entry, or clear the entire cache.
 * @param key - Optional key to invalidate. If omitted, clears all entries.
 */
export function invalidate(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/**
 * Check if a key exists in the cache and has not expired.
 */
export function has(key: string): boolean {
  const entry = cache.get(key);
  if (!entry) return false;
  if (Date.now() - entry.timestamp > TTL) {
    cache.delete(key);
    return false;
  }
  return true;
}
