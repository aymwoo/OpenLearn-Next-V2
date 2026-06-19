/**
 * Hot Reload — 开发模式文件监听 + 插件热重载控制器。
 *
 * Phase 7: 使用 chokidar 监听 plugins/ 目录的文件变更，
 * 通过 debounce 合并快速连续变更，触发 PluginHost.reloadPlugin()。
 *
 * 仅在 NODE_ENV=development 时启用。
 */

import * as chokidar from 'chokidar';
import type { PluginHost } from './index.js';
import type { HotReloadCallback } from './types.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** 文件变更 debounce 窗口（毫秒），合并编辑器自动保存 + 格式化触发的多次写入 */
const DEBOUNCE_MS = 300;

// ── FileWatcher ────────────────────────────────────────────────────────────

/**
 * FileWatcher — chokidar 包装器，管理 pluginId ↔ filePath 映射。
 *
 * 负责文件系统监听和变更事件的发射；不包含业务逻辑。
 */
export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private pluginFileMap = new Map<string, string>(); // pluginId → absolute filePath
  private filePluginMap = new Map<string, string>(); // absolute filePath → pluginId
  private onChangeCallback: HotReloadCallback | null = null;
  private watching = false;

  /**
   * 启动文件监听。
   *
   * @param watchDir - 要监听的目录（绝对路径）
   * @param onPluginChanged - 插件文件变更回调
   */
  async startWatch(
    watchDir: string,
    onPluginChanged: HotReloadCallback,
  ): Promise<void> {
    if (this.watching) return;

    this.onChangeCallback = onPluginChanged;

    this.watcher = chokidar.watch('**/*.{ts,js,mjs}', {
      cwd: watchDir,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on('change', (relativePath: string) => {
      // chokidar returns the relative path; resolve to absolute
      const absPath = relativePath;
      const pluginId = this.filePluginMap.get(absPath);
      if (pluginId && this.onChangeCallback) {
        this.onChangeCallback({
          pluginId,
          filePath: absPath,
          timestamp: Date.now(),
        });
      }
    });

    this.watcher.on('error', (err: Error) => {
      console.error('[FileWatcher] chokidar error:', err.message);
    });

    this.watching = true;
    console.log(`[FileWatcher] Watching ${watchDir} for plugin changes`);
  }

  /**
   * 注册插件的文件路径映射。
   */
  registerPlugin(pluginId: string, filePath: string): void {
    this.pluginFileMap.set(pluginId, filePath);
    this.filePluginMap.set(filePath, pluginId);
  }

  /**
   * 移除插件的文件路径映射（不再监听该插件的变更）。
   */
  unregisterPlugin(pluginId: string): void {
    const filePath = this.pluginFileMap.get(pluginId);
    if (filePath) {
      this.filePluginMap.delete(filePath);
    }
    this.pluginFileMap.delete(pluginId);
  }

  /**
   * 获取所有被监听插件的 ID 列表。
   */
  getWatchedPlugins(): string[] {
    return [...this.pluginFileMap.keys()];
  }

  /**
   * 停止文件监听并释放 chokidar 资源。
   */
  async stopWatch(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.onChangeCallback = null;
    this.watching = false;
    console.log('[FileWatcher] Stopped watching');
  }

  /**
   * 是否正在监听。
   */
  isWatching(): boolean {
    return this.watching;
  }
}

// ── HotReloadController ────────────────────────────────────────────────────

/**
 * HotReloadController — 编排文件监听和热重载触发。
 *
 * 接收 FileWatcher 的变更事件，通过 debounce 合并快速连续变更，
 * 读取新源码并调用 PluginHost.reloadPlugin()。
 */
export class HotReloadController {
  private fileWatcher: FileWatcher;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private enabled = false;
  private readonly watchDir: string;

  constructor(
    private pluginHost: PluginHost,
    watchDir: string,
  ) {
    this.fileWatcher = new FileWatcher();
    this.watchDir = watchDir;
  }

  /**
   * 启动热重载监听（仅 NODE_ENV=development）。
   */
  async start(): Promise<void> {
    if (process.env.NODE_ENV !== 'development') {
      console.log('[HotReload] Skipped — not in development mode');
      return;
    }

    if (this.enabled) return;
    this.enabled = true;

    await this.fileWatcher.startWatch(this.watchDir, (event) => {
      this.handleFileChange(event.pluginId, event.filePath);
    });

    console.log('[HotReload] Hot reload enabled — watching for plugin changes');
  }

  /**
   * 停止热重载监听。
   */
  async stop(): Promise<void> {
    // Clear all pending debounce timers
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    await this.fileWatcher.stopWatch();
    this.enabled = false;
  }

  /**
   * 注册插件到文件监听。
   */
  registerPlugin(pluginId: string, filePath: string): void {
    this.fileWatcher.registerPlugin(pluginId, filePath);
  }

  /**
   * 移除插件的文件监听。
   */
  unregisterPlugin(pluginId: string): void {
    this.fileWatcher.unregisterPlugin(pluginId);
  }

  /**
   * 获取 FileWatcher 实例（供测试使用）。
   */
  getFileWatcher(): FileWatcher {
    return this.fileWatcher;
  }

  /**
   * 处理文件变更事件 — debounce + 触发 reload。
   */
  private async handleFileChange(
    pluginId: string,
    filePath: string,
  ): Promise<void> {
    // 清除旧的 debounce timer
    const existingTimer = this.debounceTimers.get(pluginId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 创建新的 debounce timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(pluginId);

      try {
        // 读取新源码
        const fs = await import('fs/promises');
        const newSourceCode = await fs.readFile(filePath, 'utf-8');

        console.log(
          `[HotReload] File changed: ${filePath} → triggering reload for "${pluginId}"`,
        );

        // 触发 reload
        await this.pluginHost.reloadPlugin(pluginId, newSourceCode);
      } catch (err) {
        console.error(
          `[HotReload] Reload failed for "${pluginId}" (file: ${filePath}):`,
          (err as Error).message,
        );
        // 不重新抛出 — 保持监听器存活
      }
    }, DEBOUNCE_MS);

    this.debounceTimers.set(pluginId, timer);
  }
}
