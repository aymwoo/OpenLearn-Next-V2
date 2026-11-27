import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 只读白板下的插件渲染器「进视口再挂载」容器。
 *
 * 背景：`whiteboard.renderer` 的每个图元都会创建一个插件前端实例（含 iframe）。
 * 画布进入只读演示态（全班专注锁定）时这些实例仍然全部挂载，大班 + 多插件时
 * 内存与攻击面开销明显，而只读态下绝大多数图元并不在视口内。
 *
 * 行为：
 * - `enabled=false`（可编辑态）直接挂载，保持原有首屏零延迟；
 * - `enabled=true` 时先渲染一个占位块，图元进入视口（含 800px 预取边距）后才挂载，
 *   挂载后不再卸载 —— 避免滚动来回导致插件重载丢状态；
 * - 环境没有 `IntersectionObserver`（如 jsdom 测试）时立即挂载，不改变既有行为。
 */
export function DeferredMountWhenVisible({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const sentinelRef = useRef<HTMLSpanElement | null>(null);
  const [mounted, setMounted] = useState(!enabled);

  useEffect(() => {
    if (!enabled || mounted) return;
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
      { rootMargin: '800px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, mounted]);

  if (mounted) return <>{children}</>;
  return <span ref={sentinelRef} aria-hidden="true" className="block h-full w-full" />;
}
