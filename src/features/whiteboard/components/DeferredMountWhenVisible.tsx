import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** 预取边距：与 IntersectionObserver 的 rootMargin 保持一致。 */
const PREFETCH_MARGIN_PX = 800;

/**
 * 白板插件渲染器的「进视口再挂载」容器。
 *
 * 背景：`whiteboard.renderer` 的每个图元都会创建一个插件前端实例（含 iframe）。
 * 一节白板课可能有几十个图元，其中绝大多数并不在视口内 —— 可编辑态与只读演示态
 * 都存在这份开销，懒挂载因此对两种状态都启用。
 *
 * 行为：
 * - 先渲染一个占位块，图元进入视口（含 800px 预取边距）后才挂载；
 * - **首帧同步判定**：挂载后立刻用 `getBoundingClientRect` 判断是否已在视口内，
 *   命中则同步挂载（`useLayoutEffect` 在绘制前提交），不会出现占位块闪一下再被替换；
 * - 挂载后不再卸载 —— 避免滚动来回导致插件重载丢状态；
 * - 环境没有 `IntersectionObserver`（如 jsdom 测试）时立即挂载，不改变既有行为。
 */
export function DeferredMountWhenVisible({ enabled = true, children }: { enabled?: boolean; children: ReactNode }) {
  const sentinelRef = useRef<HTMLSpanElement | null>(null);
  // 首帧同步挂载时置位：避免紧接着的被动 effect 再创建一次无用的 observer。
  const skipObserverRef = useRef(false);
  const [mounted, setMounted] = useState(!enabled);

  useLayoutEffect(() => {
    if (!enabled || mounted) return;
    const node = sentinelRef.current;
    if (!node) return;
    // 首帧同步判定：已在视口内（含预取边距）或无法观察时直接挂载，
    // 让首帧就是真实内容，而不是「占位 → 内容」的一帧闪烁。
    if (typeof IntersectionObserver === 'undefined' || isWithinViewport(node)) {
      skipObserverRef.current = true;
      setMounted(true);
    }
  }, [enabled, mounted]);

  useEffect(() => {
    if (!enabled || mounted || skipObserverRef.current) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setMounted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: `${PREFETCH_MARGIN_PX}px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, mounted]);

  if (mounted) return <>{children}</>;
  return <span ref={sentinelRef} aria-hidden="true" className="block h-full w-full" />;
}

/** 占位块是否已落在视口（含预取边距）内。 */
function isWithinViewport(node: HTMLElement): boolean {
  const rect = node.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
  return (
    rect.bottom >= -PREFETCH_MARGIN_PX &&
    rect.top <= viewportHeight + PREFETCH_MARGIN_PX &&
    rect.right >= -PREFETCH_MARGIN_PX &&
    rect.left <= viewportWidth + PREFETCH_MARGIN_PX
  );
}
