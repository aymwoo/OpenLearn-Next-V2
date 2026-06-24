/**
 * 通用数据获取 Hook — 三态管理 (loading / error / data)
 *
 * Phase 19 - FE-REFACTOR-02
 */
import { useState, useEffect, useCallback, useRef } from 'react';

interface UseDataFetchingOptions<T> {
  /** 初始数据 */
  initialData?: T;
  /** 是否在挂载时立即执行（默认 true） */
  immediate?: boolean;
  /** 依赖数组变化时重新获取（默认 []） */
  deps?: any[];
}

interface UseDataFetchingResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useDataFetching<T>(
  fetcher: () => Promise<T>,
  options: UseDataFetchingOptions<T> = {},
): UseDataFetchingResult<T> {
  const { initialData, immediate = true, deps = [] } = options;
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    if (immediate) {
      fetchData();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData, immediate]);

  return { data, loading, error, refetch: fetchData };
}
