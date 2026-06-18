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
   * 追踪一个 Disposable 资源。
   *
   * @param pluginId - 插件标识符
   * @param disposable - 可清理资源
   */
  track(pluginId: string, disposable: Disposable): void {
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
        console.error(
          `[PluginHost] Error disposing resource for plugin "${pluginId}":`,
          e,
        );
      }
    }

    this.resources.delete(pluginId);
  }
}
