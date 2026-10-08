/**
 * PluginHost · reload 层（L-2 阶段 2）。
 *
 * `PluginHostReload` 继承 `PluginHostLifecycle`。链序约束见 `base.ts` 的说明。
 */

import { PluginHostLifecycle } from './lifecycle.js';
import { v7 as uuidv7 } from 'uuid';
import fs from 'fs';
import JSZip from 'jszip';
import path from 'path';
import type { PluginModule } from '../esm-loader/esm-loader.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import { ResourceTracker } from './resource-tracker.js';
import { buildContext } from './context-builder.js';
import { normalizeExecutionMode } from './types.js';
import { topologicalSort, buildDepGraph } from './dependency-resolver.js';
import { compose } from './middleware.js';
import { PluginState } from './types.js';
import type { Disposable } from './types.js';
import type { PluginContext, MiddlewareContext } from './types.js';
import {
  IllegalStateTransitionError,
  PluginActivateError,
  PluginDeactivateTimeoutError,
  HotReloadError,
  HotReloadActivationError,
} from './errors.js';
import { IEventBusServiceToken } from '../di/interfaces.js';
import type { IEventBusService } from '../di/interfaces.js';
import { DEACTIVATION_TIMEOUT_MS, PluginInstance } from './base.js';
import type { PluginHost } from './index.js';

export abstract class PluginHostReload extends PluginHostLifecycle {
  /**
   * 从 DB 恢复所有 active 状态的 ESM 插件。
   *
   * 方法 6: restoreActivePlugins(): Promise<void>
   *
   * 从 PluginRuntime.loadFromDB 迁移：
   * - 查询 SELECT * FROM plugins WHERE status = 'active' AND loader_version = 'esm'
   * - 对每个插件调用 activatePlugin()
   * - 单个插件激活失败不影响其他插件（D-10）
   * - loader_version='vm' 的插件不可恢复（PluginHost 仅处理 ESM 插件）
   *
   * 在服务器重启时调用，恢复之前运行中的插件。
   */
  async restoreActivePlugins(): Promise<void> {
    const plugins = this.db
      .prepare("SELECT * FROM plugins WHERE status = 'active' AND loader_version = 'esm'")
      .all() as Array<{ id: string; name?: string; execution_mode?: string; [key: string]: unknown }>;

    console.log(`[PluginHost] Restoring ${plugins.length} active ESM plugin(s) from database`);

    // Ensure frontend.js is extracted for all active plugins if missing
    for (const p of plugins) {
      try {
        const pluginDir = this.getPluginDir(p.id);
        const frontendPath = path.join(pluginDir, 'frontend.js');
        const zipFilePath = path.join(pluginDir, 'package.zip');
        if (fs.existsSync(zipFilePath) && !fs.existsSync(frontendPath)) {
          console.log(`[PluginHost] Extracting missing frontend.js for plugin ${p.id}...`);
          const zipBuffer = fs.readFileSync(zipFilePath);
          const zip = await JSZip.loadAsync(zipBuffer);
          const frontendFile = zip.file('frontend.js');
          if (frontendFile) {
            const frontendCode = await frontendFile.async('string');
            fs.writeFileSync(frontendPath, frontendCode, 'utf-8');
            console.log(`[PluginHost] Successfully restored frontend.js for plugin ${p.id}`);
          }
        }
      } catch (err) {
        console.error(`[PluginHost] Failed to restore frontend.js for plugin ${p.id}:`, err);
      }
    }

    // V3.0: 按拓扑序激活（依赖优先）
    const manifests = new Map<string, Manifest>();
    for (const p of plugins) {
      try {
        const row = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(p.id) as
          { manifest: string } | undefined;
        if (row) {
          manifests.set(p.id, JSON.parse(row.manifest));
        }
      } catch {
        // Skip malformed manifests
      }
    }

    const graph = buildDepGraph(manifests);
    const installedIds = Array.from(manifests.keys());
    const { sorted, blocked, cycles } = topologicalSort(graph, installedIds);

    if (cycles.length > 0) {
      console.warn(
        `[PluginHost] Dependency cycles detected during restore:`,
        cycles.map((c) => c.join(' → ')).join(', '),
      );
      console.warn(`[PluginHost] Cyclic plugins will be activated without ordering guarantees.`);
    }

    if (blocked.length > 0) {
      for (const b of blocked) {
        console.warn(
          `[PluginHost] Plugin "${b.pluginId}" blocked during restore: ` +
            `missing dependencies: ${b.missingDeps.join(', ')}`,
        );
      }
    }

    // ── 激活顺序（H-5）──
    //
    // 原实现把 blocked 与 cycles 一视同仁地「best-effort 激活」：
    //   const orderedIds = [...sorted];
    //   for (const b of blocked) orderedIds.push(b.pluginId);   // ← 缺依赖的插件被强行激活
    //   for (const cycle of cycles) orderedIds.push(...cycle);
    //
    // 缺依赖的插件被激活后会在 `activate()` 里撞上 MODULE_NOT_FOUND，
    // 状态机把它打成 ERROR —— 于是 DB 里出现一批「ERROR 状态的插件」，
    // 而真实原因是「它的依赖压根没装」。重启一次就复现一次，且现象与病因不在一处。
    //
    // 现在区分三类：
    //   · sorted  —— 依赖齐备，按拓扑序正常激活
    //   · cycles  —— 依赖成环，**仍** best-effort 激活（无序保证，但能跑）
    //   · blocked —— 依赖缺失/未激活，**不激活**，只记日志并保持 INSTALLED
    //                 理由：成环的插件功能上通常仍可用；缺依赖的插件一定不可用，
    //                 强行激活只会把「依赖没装」伪装成「插件自身报错」
    const orderedIds = [...sorted];
    for (const cycle of cycles) orderedIds.push(...cycle);

    if (blocked.length > 0) {
      const blockedIds = new Set(blocked.map((b) => b.pluginId));
      for (const b of blocked) {
        console.warn(
          `[PluginHost] Skipping activation of "${b.pluginId}": dependency not satisfied ` +
            `(${b.missingDeps.join(', ')}). 插件保持 INSTALLED —— 强行激活只会把` +
            `「依赖缺失」伪装成「插件自身报错」，重启后还会复现。`,
        );
      }
      // 双保险：即便 orderedIds 里因其他路径混入了被阻塞插件，这里也剔除
      for (let i = orderedIds.length - 1; i >= 0; i--) {
        if (blockedIds.has(orderedIds[i])) orderedIds.splice(i, 1);
      }
    }

    for (const id of orderedIds) {
      const resolvedId = this.resolvePluginUuid(id);
      const p = plugins.find((pl) => pl.id === resolvedId);
      if (!p) continue;

      const runtimeState = this.getPluginState(p.id);
      if (runtimeState === PluginState.ACTIVE) {
        continue;
      }

      try {
        // 归一化：DB 里的 execution_mode 是任意字符串（TEXT 列，无 CHECK 约束）
        const mode = normalizeExecutionMode(p.execution_mode);
        await this.activatePlugin(p.id, { mode });
      } catch (err) {
        // D-10: 单个插件激活失败不影响其他插件
        console.error(`[PluginHost] Failed to restore plugin "${p.name ?? p.id}" (${p.id}):`, err);
      }
    }

    console.log('[PluginHost] Plugin restoration complete');
  }

  // ── Phase 7: Hot Reload ──────────────────────────────────────────────────

  /**
   * Phase 7: 设置 HotReloadController 引用（避免循环依赖）。
   * 由 Kernel 在 dev 模式初始化 HotReloadController 后调用。
   */
  setHotReloadController(controller: import('./hot-reload.js').HotReloadController): void {
    this._hotReloadController = controller;
  }

  /**
   * 暴露 resourceTracker 给 reloadPlugin 和测试使用。
   */
  getResourceTracker(): ResourceTracker {
    return this.resourceTracker;
  }

  /**
   * 精确销毁快照中的一组 Disposable，并把它们从 ResourceTracker 中摘除。
   *
   * 与 `disposeAll` 的区别：disposeAll 销毁该插件**全部**资源；本方法只碰快照里的那些，
   * 因此可在「新旧版本资源混在同一追踪表」的窗口里安全使用（热重载成功路径）。
   */
  private disposeSnapshot(pluginId: string, disposables: readonly Disposable[]): void {
    for (const d of disposables) {
      try {
        d.dispose();
      } catch (e) {
        console.error(`[PluginHost] Error disposing old resource for "${pluginId}":`, e);
      }
    }
    this.resourceTracker.reap(pluginId, disposables as Disposable[]);
  }

  /**
   * 热重载失败回滚：让旧版本恢复到「可服务命令」的状态。
   *
   * 场景：新版本 activate 抛错。此刻 ResourceTracker 里同时存在旧资源（第 3 步快照）
   * 与新版本 activate 期间注册的资源，**两者混在一个 list 中、无法逐一区分**。
   *
   * 因此采取「重建而非猜测」的策略：
   * 1. `disposeAll` 清空全部追踪资源（含旧资源与新资源）；
   * 2. **重新激活旧版本**（`activatePluginExclusive` 内部只新增不依赖历史状态，
   *    且 activate 失败会再次 disposeAll，不会累积残留）。
   *
   * 为什么不像成功路径那样「只 dispose 新资源」：ResourceTracker 只保存 Disposable 数组，
   * 不记录归属版本，没有可靠办法区分二者。要让回滚也精确，需在 ResourceTracker 上按版本
   * 分桶 —— 属架构变更，本轮不做（见台账 Batch 2 备注）。
   *
   * 若重建也失败，则把状态置为 ERROR 并让 DB 同步 —— 宁可显示「已停用并报错」，
   * 也不能留下「状态显示 active、命令全部 404」的僵尸态（审计 C-3）。
   */
  private async rollbackReload(pluginId: string, oldInstance: PluginInstance | undefined): Promise<void> {
    this.resourceTracker.disposeAll(pluginId);

    if (!oldInstance) {
      this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
      return;
    }

    try {
      // 回到 INSTALLED 再激活：validateTransition 不允许 ERROR→ACTIVE 之外的非法路径，
      // 而此处旧实例仍可运行，语义上就是「仍是已安装状态、只是本次热重载失败」。
      this.setPluginState(pluginId, PluginState.INSTALLED, { persistDb: true });
      await this.activatePluginExclusive(pluginId);
      console.warn(`[PluginHost] reload rollback for "${pluginId}": 旧版本已重新激活，插件恢复可用。`);
    } catch (err) {
      // 重建失败：进入 ERROR 并同步 DB，避免僵尸态
      console.error(`[PluginHost] reload rollback failed for "${pluginId}":`, err);
      this.resourceTracker.disposeAll(pluginId);
      this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
    }
  }

  /**
   * Phase 7: 原子热重载插件。
   *
   * 策略（atomic new-before-old）：
   * 1. 提取新 manifest，验证 ID 一致性
   * 2. SemVer 兼容检查
   * 3. 构建新 PluginContext
   * 4. ESM 加载新源码 → 激活新版本
   * 5. [成功] 停用旧版本 → 清理旧资源 → 替换实例引用 → 更新 DB
   * 6. [失败] 保留旧版本运行，清理临时资源，抛出 HotReloadActivationError
   *
   * @param pluginId - 插件标识符
   * @param newSourceCode - 新版本源码
   */
  async reloadPlugin(pluginId: string, newSourceCode: string): Promise<void> {
    pluginId = this.resolvePluginUuid(pluginId);

    // ── 并发串行化（审计 H-2）─────────────────────────────────────────────
    //
    // 修复前 reload **完全不经过** inflightActivate / inflightDeactivate 串行化，
    // 也不检查 ACTIVATING/DEACTIVATING 中间态。与 deactivate 并发时，
    // 两边各自 `disposeAll(pluginId)` 互相踩踏：reload 刚注册的新资源会被
    // deactivate 的清理销毁，或反之，最终状态与实际注册情况不符。
    //
    // 这里等待在飞的生命周期操作结束后再进入 reload。
    await this.waitForLifecycleIdle(pluginId);

    const currentState = this.pluginStates.get(pluginId);

    // 1. 状态检查
    if (currentState !== PluginState.ACTIVE) {
      throw new IllegalStateTransitionError(pluginId, currentState ?? PluginState.UNINSTALLED, PluginState.ACTIVE);
    }

    const oldInstance = this.pluginInstances.get(pluginId);
    if (!oldInstance) {
      throw new PluginActivateError(pluginId, 'No active instance found for reload');
    }

    const oldManifest = oldInstance.manifest;
    const oldVersion = oldManifest.version ?? 'unknown';
    const filePath = '(hot-reload)';

    // 2. 提取 manifest
    let newManifest: Manifest;
    try {
      newManifest = await this.extractManifest(newSourceCode);
    } catch (err) {
      throw new HotReloadActivationError(pluginId, filePath, err instanceof Error ? err : new Error(String(err)));
    }

    // 2a. 验证 manifest.id 一致性
    if (newManifest.id !== oldManifest.id) {
      throw new HotReloadError(
        `Manifest id mismatch: expected "${oldManifest.id}", got "${newManifest.id}"`,
        pluginId,
        filePath,
      );
    }

    // 2b. SemVer 兼容检查
    const skipTokens = this.checkSemVerCompatibility(newManifest, pluginId, 'activate');

    // 3. 快照旧资源 — 在构建新 Context 之前（防止 disposeAll 误伤新资源）
    const oldDisposables = this.resourceTracker.snapshot(pluginId);

    // 4. 构建新 Context（会注册新 disposables 到 ResourceTracker）
    const ctx = await buildContext(
      this.serviceRegistry,
      this.resourceTracker,
      pluginId,
      newManifest,
      this.db,
      skipTokens,
      this.contributionRegistry,
    );

    // 5. Phase 5: Worker-mode check — if worker-mode, delegate to workerManager
    const mode = this.getExecutionMode(pluginId);
    if (mode === 'worker') {
      return this.reloadWorker(pluginId, newSourceCode, newManifest, oldInstance, oldDisposables, filePath, oldVersion);
    }

    // 6. ESM 加载 + 激活新版本（inline mode）
    let newInstance: {
      manifest: Manifest;
      activate: ((pluginCtx: PluginContext) => Promise<void>) | undefined;
      deactivate?: (() => Promise<void>) | undefined;
    };

    try {
      const pluginModule: PluginModule = await this.esmLoader.load(newSourceCode);
      newInstance = {
        manifest: newManifest,
        activate: pluginModule.activate,
        deactivate: pluginModule.deactivate,
      };

      // Phase 7: middleware wrapping for reload
      const middlewareCtx: MiddlewareContext = {
        pluginId,
        manifest: newManifest,
        phase: 'beforeActivate',
        timestamp: Date.now(),
      };
      const before = this.getMiddleware('beforeActivate');
      const after = this.getMiddleware('afterActivate');
      const pipeline = compose([
        ...before,
        async (_ctx, next) => {
          await next();
          const afterCtx: MiddlewareContext = { ...middlewareCtx, phase: 'afterActivate' };
          await compose(after)(afterCtx, async () => {});
        },
      ]);
      await pipeline(middlewareCtx, async () => {
        if (newInstance.activate) {
          await newInstance.activate(ctx);
        }
      });
    } catch (err) {
      // 激活失败 —— 回滚（审计 C-3，async）
      //
      // 修复前是 `disposeAll(pluginId)`：销毁该插件**全部**已追踪资源，包括旧版本
      // 仍在正常运行的 command handler / event 订阅 / interval / http 路由。而
      // `pluginStates` 仍为 ACTIVE、`pluginInstances` 仍指向旧实例、DB 仍 'active'。
      //
      // 用户可见后果：插件中心显示「已启用」，但全部命令返回 "No handler registered"，
      // 且**无自愈路径** —— 再次 activate 会因状态已是 ACTIVE 被 validateTransition 拒绝。
      //
      // 修复：走 rollbackReload()，把旧版本重新激活；重建失败则置 ERROR 并同步 DB，
      // 任何路径下都不留下「状态与实际不一致」的僵尸态。
      await this.rollbackReload(pluginId, oldInstance);
      throw new HotReloadActivationError(pluginId, filePath, err instanceof Error ? err : new Error(String(err)));
    }

    // 7. 激活成功 — 停用旧版本
    try {
      if (oldInstance.deactivate) {
        const deactResult = oldInstance.deactivate();
        if (deactResult instanceof Promise) {
          await Promise.race([
            deactResult,
            new Promise<void>((_, reject) =>
              setTimeout(
                () => reject(new PluginDeactivateTimeoutError(pluginId, DEACTIVATION_TIMEOUT_MS)),
                DEACTIVATION_TIMEOUT_MS,
              ),
            ),
          ]);
        }
      }
    } catch (deactErr) {
      console.error(`[PluginHost] Deactivation error during reload for "${pluginId}":`, deactErr);
    }

    // 8. 精确清理旧资源（仅快照中的，不碰新注册的）
    this.disposeSnapshot(pluginId, oldDisposables);

    // 9. 替换实例引用
    this.pluginInstances.set(pluginId, newInstance);

    // 10. 更新 DB
    this.db
      .prepare('UPDATE plugins SET source_code = ?, manifest = ?, updated_at = ?, version = ? WHERE id = ?')
      .run(newSourceCode, JSON.stringify(newManifest), Date.now(), newManifest.version, pluginId);

    const newVersion = newManifest.version ?? 'unknown';
    console.log(`[PluginHost] Hot reload succeeded for "${pluginId}" — old: ${oldVersion} → new: ${newVersion}`);

    // 11. Phase 7: publish reload event
    try {
      const eventBus = await this.serviceRegistry.resolve<IEventBusService>(IEventBusServiceToken);
      eventBus.publish({
        id: uuidv7(),
        type: 'plugin.reloaded',
        source: 'plugin-host',
        payload: { pluginId, oldVersion, newVersion },
        timestamp: Date.now(),
      });
    } catch {
      // Event publishing failure is non-fatal
    }
  }

  /**
   * Phase 7: Worker-mode hot reload.
   * Creates a new Worker for the updated source, terminates the old one on success.
   */
  private async reloadWorker(
    pluginId: string,
    newSourceCode: string,
    _newManifest: Manifest,
    _oldInstance: NonNullable<ReturnType<typeof this.pluginInstances.get>>,
    _oldDisposables: import('./types.js').Disposable[],
    filePath: string,
    _oldVersion: string,
  ): Promise<void> {
    // 1. Save old source code for rollback
    const oldRow = this.db.prepare('SELECT source_code FROM plugins WHERE id = ?').get(pluginId) as
      { source_code: string } | undefined;
    const oldSourceCode = oldRow?.source_code ?? '';

    // 2. Terminate old worker
    let prevState: any = undefined;
    try {
      prevState = await this.workerManager.terminateWorker(pluginId);
    } catch {
      // Old worker may already be gone — continue
    }

    // 3. Write new source code to disk and create new worker with updated source
    try {
      const pluginDir = this.getPluginDir(pluginId);
      if (fs.existsSync(pluginDir)) {
        fs.writeFileSync(path.join(pluginDir, 'index.js'), newSourceCode);
      }

      await this.workerManager.createWorker(
        pluginId,
        _newManifest,
        newSourceCode,
        (await import('../worker-runtime/worker-manager.js')).ALL_SERVICE_TOKENS,
        undefined,
        this.getPluginDir(pluginId),
        prevState,
      );
      this.db
        .prepare('UPDATE plugins SET source_code = ?, updated_at = ? WHERE id = ?')
        .run(newSourceCode, Date.now(), pluginId);
      console.log(`[PluginHost] Worker-mode reload succeeded for "${pluginId}"`);
    } catch (err) {
      // Failed — try to restore old worker
      if (oldSourceCode) {
        try {
          await this.workerManager.createWorker(
            pluginId,
            _newManifest,
            oldSourceCode,
            (await import('../worker-runtime/worker-manager.js')).ALL_SERVICE_TOKENS,
            undefined,
            this.getPluginDir(pluginId),
          );
        } catch {
          console.error(`[PluginHost] Worker-mode reload: failed to restore old worker for "${pluginId}"`);
        }
      }
      throw new HotReloadActivationError(pluginId, filePath, err instanceof Error ? err : new Error(String(err)));
    }
  }
}
