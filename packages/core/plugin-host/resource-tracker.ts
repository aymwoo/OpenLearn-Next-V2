/**
 * ResourceTracker — 按插件 ID 追踪 Disposable 资源的生命周期管理器。
 *
 * D-07: 按 pluginId 追踪 Disposable 资源
 * D-08: disposeAll(pluginId) 按插入顺序清理所有资源，单个失败不阻塞其余
 * D-09: 清理顺序由调用者通过 track() 调用顺序决定
 *       （先停进程 → 再清定时器 → 最后注销命令/事件）
 *
 * disposeAll 是幂等的：对已清理的 pluginId 再次调用为无操作。
 */

import type { Disposable } from './types.js';

export class ResourceTracker {
  /** 按 pluginId 分组的 Disposable 资源列表 */
  private resources = new Map<string, Disposable[]>();

  /**
   * 已被 `disposeAll` 回收、但插件代码可能仍在运行的 pluginId 集合（审计 H-3）。
   *
   * activate/deactivate 的超时只让宿主停止等待，**不取消插件代码本身**。
   * 因此 disposeAll 之后插件仍可能继续 track()，若无此集合兜底，这些资源会
   * 进入新建的 list 并被永久遗忘。保留在集合里可让它们被立即 dispose。
   *
   * 用 Set 而非在 disposeAll 后立刻忘记：只有插件重新激活（track 首次出现于新的
   * 生命周期）才应重置该标记，而重置由 `reopen()` 在 activate 入口显式完成。
   */
  private closed = new Set<string>();

  /**
   * 标记插件进入新的生命周期，清除「已关闭」标记。
   *
   * 必须在**每次 activate 入口**调用 —— 否则一次超时泄漏导致的关闭标记会
   * 让该插件后续所有 activate 注册的资源被立即 dispose（插件永远起不来）。
   */
  reopen(pluginId: string): void {
    this.closed.delete(pluginId);
  }

  /**
   * 追踪一个 Disposable 资源。
   *
   * @param pluginId - 插件标识符
   * @param disposable - 可清理资源
   */
  track(pluginId: string, disposable: Disposable): void {
    // 已清理过的插件再 track → 立即 dispose（审计 H-3）
    //
    // 场景：activate() 被 5s 超时打断后，插件代码**仍在后台运行**（Promise.race
    // 只是让宿主不再等待，并不会取消它）。catch 分支随即 disposeAll(pluginId)，
    // 该条目被 `resources.delete`。此后后台代码继续调 track() 会进入一个**新 list**，
    // 而那个 list 永远不会再被 disposeAll 触及 —— 资源永久泄漏，且没有任何报错。
    //
    // 这里让「已关闭的插件」的 track 立即回收，避免静默泄漏。
    if (this.closed.has(pluginId)) {
      try {
        disposable.dispose();
      } catch (e) {
        console.error(`[ResourceTracker] Error disposing late resource for closed plugin "${pluginId}":`, e);
      }
      return;
    }
    const list = this.resources.get(pluginId);
    if (list) {
      list.push(disposable);
    } else {
      this.resources.set(pluginId, [disposable]);
    }
  }

  /**
   * 清理指定插件的所有已追踪资源。
   *
   * 按原始追加顺序迭代资源数组，每个调用 d.dispose()。
   * 每个 dispose 包裹在 try/catch 中，防止单个恶意 dispose
   * 阻塞其余清理过程。所有 dispose 尝试完成后，
   * 调用 this.resources.delete(pluginId)。
   *
   * 如果 pluginId 不在 map 中，静默返回（幂等，无副作用）。
   *
   * @param pluginId - 要清理的插件标识符
   */
  disposeAll(pluginId: string): void {
    const list = this.resources.get(pluginId);
    if (!list) {
      return;
    }

    for (const disposable of list) {
      try {
        disposable.dispose();
      } catch (e) {
        console.error(`[PluginHost] Error disposing resource for plugin "${pluginId}":`, e);
      }
    }

    this.resources.delete(pluginId);
    // 标记为已关闭：此后 track() 会立即 dispose，避免超时后仍运行的插件代码
    // 把资源注册进一个永远无人回收的新 list（审计 H-3）
    this.closed.add(pluginId);
  }

  /**
   * Phase 7: 快照指定插件当前的 Disposable 列表。
   *
   * 返回浅拷贝数组，用于热重载时在激活新版本前保存旧资源引用。
   * 如果 pluginId 不在 map 中，返回空数组。
   *
   * @param pluginId - 插件标识符
   * @returns 当前追踪的 Disposable 数组的浅拷贝
   */
  snapshot(pluginId: string): Disposable[] {
    const list = this.resources.get(pluginId);
    return list ? [...list] : [];
  }

  /**
   * Phase 7: 部分清理 — 从追踪列表中移除指定的 Disposable 对象。
   *
   * 用于热重载场景：清理由 snapshot() 捕获的旧资源，
   * 但保留 ContextBuilder 在激活新版本时注册的新资源。
   *
   * 清理后如果列表为空，删除该 pluginId 条目。
   *
   * @param pluginId - 插件标识符
   * @param disposables - 要移除的 Disposable 对象数组
   */
  reap(pluginId: string, disposables: Disposable[]): void {
    const list = this.resources.get(pluginId);
    if (!list || disposables.length === 0) return;

    const toRemove = new Set(disposables);
    const remaining = list.filter((d) => !toRemove.has(d));

    if (remaining.length > 0) {
      this.resources.set(pluginId, remaining);
    } else {
      this.resources.delete(pluginId);
      // 注意：不要在此 closed.add()。
      // reap 是「精确保留另一批资源」的局部操作（热重载成功路径），
      // 该插件此刻仍是活跃的，标记关闭会让新版本注册的资源被立即 dispose。
    }
  }
}
