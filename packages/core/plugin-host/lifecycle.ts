/**
 * PluginHost · lifecycle 层（L-2 阶段 2）。
 *
 * `PluginHostLifecycle` 继承 `PluginHostHttp`。链序约束见 `base.ts` 的说明。
 */

import { PluginHostHttp } from './http.js';
import fs from 'fs';
import { pathToFileURL } from 'node:url';
import { EsmLoader } from '../esm-loader/esm-loader.js';
import type { PluginModule } from '../esm-loader/esm-loader.js';
import { EsmLoadTimeoutError, EsmActivationError } from '../esm-loader/errors.js';
import { manifestSchema } from '../esm-loader/manifest-schema.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import { ResourceTracker } from './resource-tracker.js';
import { buildContext } from './context-builder.js';
import { normalizeExecutionMode, requiresProcessIsolation, type PluginExecutionMode } from './types.js';
import { compose } from './middleware.js';
import { PluginState } from './types.js';
import type { PluginContext, MiddlewareContext } from './types.js';
import { IllegalStateTransitionError, PluginActivateError, PluginDeactivateTimeoutError } from './errors.js';
import { ICapabilityServiceToken, IEventBusServiceToken } from '../di/interfaces.js';
import type { ICapabilityService, IEventBusService } from '../di/interfaces.js';
import { WorkerManager } from '../worker-runtime/worker-manager.js';
import { ACTIVATION_TIMEOUT_MS, DEACTIVATION_TIMEOUT_MS } from './base.js';
import type { PluginHost } from './index.js';

export abstract class PluginHostLifecycle extends PluginHostHttp {
  /**
   * 激活插件。
   *
   * 方法 2: activatePlugin(pluginId: string): Promise<void>
   *
   * D-10, D-11, D-12：完整激活流程，含超时保护和失败回滚。
   *
   * 遵循 RESEARCH.md lines 446-514 的精确数据流：
   * 1. 验证状态转换 INSTALLED/INACTIVE/ERROR → ACTIVATING
   * 2. 设置状态为 ACTIVATING
   * 3. 从 DB 加载插件源码
   * 4. EsmLoader.load() 获取模块导出
   * 5. 提取 manifest、activate（支持 default export 和具名导出）
   * 6. manifestSchema.parse() 校验 schema
   * 7. buildContext() 构建 PluginContext
   * 8. capabilityService.grant() 授予能力
   * 9. Promise.race([activate(ctx), timeout]) 5 秒超时
   * 10. 成功：状态 → ACTIVE，存储实例，DB UPDATE
   * 11. 失败（D-12）：状态 → ERROR，disposeAll 回滚，revokeAll 撤销能力，重新抛出错误
   *
   * @param pluginId - 插件标识符
   * @throws PluginActivateError / EsmActivationError / IllegalStateTransitionError
   */
  async activatePlugin(pluginId: string, options?: { mode?: PluginExecutionMode }): Promise<void> {
    pluginId = this.resolvePluginUuid(pluginId);

    // Join in-flight activation instead of throwing activating → activating
    const inflight = this.inflightActivate.get(pluginId);
    if (inflight) return inflight;

    const task = this.activatePluginExclusive(pluginId, options);
    this.inflightActivate.set(pluginId, task);
    try {
      await task;
    } finally {
      if (this.inflightActivate.get(pluginId) === task) {
        this.inflightActivate.delete(pluginId);
      }
    }
  }

  protected async activatePluginExclusive(pluginId: string, options?: { mode?: PluginExecutionMode }): Promise<void> {
    // 进入新的生命周期：清除 ResourceTracker 的「已关闭」标记（审计 H-3）。
    //
    // 必须在此处（而非仅首次安装）调用 —— 上一次 activate 若因 5s 超时被 disposeAll，
    // 该标记会保留；若不重置，本次 activate 注册的所有资源都会被立即 dispose，
    // 插件将永远无法正常启动。
    this.resourceTracker.reopen(pluginId);

    // Recover orphaned transient state left by a crashed/aborted previous attempt
    if (this.pluginStates.get(pluginId) === PluginState.ACTIVATING) {
      console.warn(`[PluginHost] Recovering stuck ACTIVATING state for "${pluginId}" → ERROR before retry`);
      this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
    }

    // Phase 5: Dual-mode activation — check if worker mode is requested
    // L-1 P1 阶段 3：mode 归一化后再分流。
    //
    // 归一化是必要的：mode 有三个来源（调用参数、DB 的 execution_mode 列、
    // manifest.executionMode），后两者都是任意字符串。归一化把未知值收敛到
    // 'inline'，避免一个脏字符串让插件悄悄走错隔离路径。
    const mode = normalizeExecutionMode(options?.mode ?? this.getExecutionMode(pluginId));
    // 'worker' 与 'process' 都走隔离路径，区别在 WorkerManager 选哪种原语。
    // 刻意合成一个分支而不是各写一条：两条路径的激活前检查、能力授予、
    // serviceHost 装配完全相同，拆开必然产生漂移。
    if (mode === 'worker' || mode === 'process') {
      return this.activateWorker(pluginId, mode);
    }

    // 1. 获取当前状态并验证转换
    const currentState = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;
    this.validateTransition(pluginId, currentState, PluginState.ACTIVATING);

    // 2. 设置状态为 ACTIVATING
    this.setPluginState(pluginId, PluginState.ACTIVATING);

    // Phase 8: Check if this is a preloaded inline plugin
    const preloaded = this.preloadedPlugins.get(pluginId);
    if (preloaded) {
      const manifest = preloaded.manifest;
      const activate = preloaded.activate;
      const deactivate = preloaded.deactivate;
      const actorId = `plugin:${manifest.id}`;

      try {
        manifestSchema.parse(manifest);

        // V3.0: 检查插件依赖是否满足（缺失 → ERROR）
        const depCheck = this.checkPluginDependencies(manifest);
        if (depCheck) {
          throw new PluginActivateError(pluginId, depCheck);
        }

        // V3.2: 检查跨插件服务依赖（阻塞激活）
        const serviceCheck = this.checkCrossPluginServices(manifest);
        if (serviceCheck) {
          const items = serviceCheck.unsatisfied.map((u) => `"${u.required}" from ${u.providerId}`).join(', ');
          throw new PluginActivateError(
            pluginId,
            `Plugin "${manifest.id}" requires cross-plugin services: ${items} (not provided)`,
          );
        }
        const skipTokens = this.checkSemVerCompatibility(manifest, pluginId, 'activate');
        // B-5：在构建上下文**之前**声明进程归属，否则本插件 spawn 的任务会被
        // 记到上一个声明者名下（归属列/内存 Map 都是同步写入，见 setPluginOwner 注释）。
        await this.declareProcessOwnership(pluginId);
        const ctx = await buildContext(
          this.serviceRegistry,
          this.resourceTracker,
          pluginId,
          manifest,
          this.db,
          skipTokens,
          this.contributionRegistry,
        );

        const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
        const caps = manifest.capabilitiesProposed ?? [];
        for (const cap of caps) {
          await capService.grant(actorId, cap);
        }

        const middlewareCtx: MiddlewareContext = {
          pluginId,
          manifest,
          phase: 'beforeActivate',
          timestamp: Date.now(),
        };

        const before = this.getMiddleware('beforeActivate');
        const after = this.getMiddleware('afterActivate');

        const activatePipeline = compose([
          ...before,
          async (_ctx, next) => {
            await next(); // 执行实际激活
            const afterCtx: MiddlewareContext = { ...middlewareCtx, phase: 'afterActivate' };
            const afterPipeline = compose(after);
            await afterPipeline(afterCtx, async () => {});
          },
        ]);

        await activatePipeline(middlewareCtx, async () => {
          // 激活带 5 秒超时
          await Promise.race([
            activate(ctx),
            new Promise<never>((_, reject) =>
              setTimeout(() => {
                reject(new EsmLoadTimeoutError(ACTIVATION_TIMEOUT_MS));
              }, ACTIVATION_TIMEOUT_MS),
            ),
          ]);
        });

        this.pluginInstances.set(pluginId, { manifest, activate, deactivate, context: ctx });
        this.setPluginState(pluginId, PluginState.ACTIVE, { persistDb: true });
      } catch (err: any) {
        console.error('[PluginHost] Preloaded plugin activation error stack:', err.stack);
        this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
        this.resourceTracker.disposeAll(pluginId);
        try {
          const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
          await capService.revokeAll(actorId);
        } catch {
          // ignore
        }
        throw new EsmActivationError(pluginId, err.message);
      }
      return;
    }

    // 3. 从 DB 加载插件
    const row = this.db.prepare('SELECT file_path, source_code, manifest FROM plugins WHERE id = ?').get(pluginId) as
      { file_path?: string; source_code: string; manifest: string } | undefined;
    if (!row) {
      this.setPluginState(pluginId, currentState);
      throw new PluginActivateError(pluginId, 'plugin not found in database');
    }

    // 解析已存储的 manifest（用于 actorId 和能力撤销）
    let storedManifest: Manifest;
    try {
      storedManifest = JSON.parse(row.manifest);
    } catch {
      this.setPluginState(pluginId, currentState);
      throw new PluginActivateError(pluginId, 'invalid manifest JSON in database');
    }

    const actorId = `plugin:${storedManifest.id}`;

    try {
      // 4. 加载源码 — 优先从文件系统 file:// URL 导入（使 Node.js 能解析 @openlearn/* 等裸模块），
      //    fallback 到 DB source_code 的 data: URL 加载（向后兼容旧格式插件）
      let mod: PluginModule;
      if (process.env.NODE_ENV !== 'test' && row.file_path && fs.existsSync(row.file_path)) {
        // 使用 file:// URL 直接导入，Node.js 会基于文件所在目录解析裸模块 specifier
        // 附加 ?t= 查询参数绕过 ESM 缓存，确保重新激活时加载最新代码
        // 宿主以 external 方式提供 SDK，先确保插件目录能解析到它
        this.ensureHostSdkResolution();
        const fileUrl = pathToFileURL(row.file_path);
        mod = await import(`${fileUrl.href}?t=${Date.now()}`);
      } else {
        let sourceCode: string = '';
        if (row.file_path && fs.existsSync(row.file_path)) {
          sourceCode = fs.readFileSync(row.file_path, 'utf-8');
        } else if (row.source_code) {
          sourceCode = row.source_code;
        } else {
          throw new PluginActivateError(pluginId, 'no source code available (file_path or source_code required)');
        }
        mod = await this.esmLoader.load(sourceCode);
      }

      // 5. 提取 manifest 和 activate（支持两种导出格式）
      const plugin = mod.default ?? mod;
      const manifest = plugin.manifest ?? (mod as any).manifest;
      const activate = plugin.activate ?? (mod as any).activate;
      const deactivate = plugin.deactivate ?? (mod as any).deactivate;

      if (!manifest || !activate) {
        throw new EsmActivationError(pluginId, 'missing manifest or activate function');
      }

      if (typeof activate !== 'function') {
        throw new EsmActivationError(pluginId, 'activate must be a function');
      }

      // Merge stored package manifest (from DB) with code-level manifest to ensure all required fields (e.g. main, requires) are present
      const mergedManifest = {
        ...storedManifest,
        ...manifest,
      };

      // 6. 校验 manifest schema
      manifestSchema.parse(mergedManifest);

      // V3.0: 检查插件依赖是否满足（缺失 → ERROR）
      const depCheck = this.checkPluginDependencies(mergedManifest);
      if (depCheck) {
        this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
        throw new PluginActivateError(pluginId, depCheck);
      }

      // 6a. Phase 6: Token version compatibility check (D-05, D-12)

      // V3.2: 检查跨插件服务依赖（阻塞激活）
      const serviceCheck = this.checkCrossPluginServices(mergedManifest);
      if (serviceCheck) {
        const items = serviceCheck.unsatisfied.map((u) => `"${u.required}" from ${u.providerId}`).join(', ');
        throw new PluginActivateError(
          pluginId,
          `Plugin "${mergedManifest.id}" requires cross-plugin services: ${items} (not provided)`,
        );
      }
      const skipTokens = this.checkSemVerCompatibility(mergedManifest, pluginId, 'activate');

      // 7. 构建安全的 PluginContext — skipTokens 中指定的可选服务 key 将被设为 null（D-12）
      const ctx = await buildContext(
        this.serviceRegistry,
        this.resourceTracker,
        pluginId,
        mergedManifest,
        this.db,
        skipTokens, // NEW: Phase 6 — incompatible optional token names
        this.contributionRegistry,
      );

      // 8. 授予能力（T-04-19: 仅授予 manifest.capabilitiesProposed 中声明的能力）
      try {
        const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
        const caps = mergedManifest.capabilitiesProposed ?? [];
        for (const cap of caps) {
          await capService.grant(actorId, cap);
        }
      } catch (capErr) {
        console.error(`[PluginHost] Failed to grant capabilities for "${pluginId}":`, capErr);
        throw capErr;
      }

      // 9. Phase 7: 中间件管道包裹激活（洋葱模型: beforeActivate → activate → afterActivate）
      const middlewareCtx: MiddlewareContext = {
        pluginId,
        manifest: mergedManifest,
        phase: 'beforeActivate',
        timestamp: Date.now(),
      };
      const before = this.getMiddleware('beforeActivate');
      const after = this.getMiddleware('afterActivate');

      const activatePipeline = compose([
        ...before,
        async (_ctx, next) => {
          await next(); // 执行实际激活
          // 激活成功后执行 afterActivate 中间件
          const afterCtx: MiddlewareContext = { ...middlewareCtx, phase: 'afterActivate' };
          const afterPipeline = compose(after);
          await afterPipeline(afterCtx, async () => {});
        },
      ]);

      await activatePipeline(middlewareCtx, async () => {
        // 10. 激活带 5 秒超时（D-11, T-04-17）
        await Promise.race([
          activate(ctx),
          new Promise<never>((_, reject) =>
            setTimeout(() => {
              reject(new EsmLoadTimeoutError(ACTIVATION_TIMEOUT_MS));
            }, ACTIVATION_TIMEOUT_MS),
          ),
        ]);

        // 11. 成功
        this.pluginInstances.set(pluginId, {
          manifest: mergedManifest,
          activate,
          deactivate: typeof deactivate === 'function' ? deactivate : undefined,
          context: ctx,
        });
        this.setPluginState(pluginId, PluginState.ACTIVE, { persistDb: true });

        // 热重载接线：注册到 FileWatcher
        if (this._hotReloadController) {
          const filePath = this.getPluginFilePath(pluginId);
          if (fs.existsSync(filePath)) {
            this._hotReloadController.registerPlugin(pluginId, filePath);
            console.log(`[PluginHost] Hot reload registered for "${pluginId}"`);
          }
        }

        console.log(`[PluginHost] Plugin "${mergedManifest.id}" activated (${pluginId})`);
      });
    } catch (err) {
      // 11. D-12: 失败回滚
      this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
      this.resourceTracker.disposeAll(pluginId);
      this.pluginInstances.delete(pluginId);

      // 撤销能力（T-04-19: 即使激活失败也撤销）
      try {
        const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
        await capService.revokeAll(actorId);
      } catch {
        // revokeAll 静默失败
      }

      console.error(`[PluginHost] Plugin "${pluginId}" activate failed:`, err);
      throw err;
    }
  }

  // ── Phase 5: Worker-mode activation ─────────────────────────────────────

  /**
   * Worker 模式激活插件。
   *
   * 通过 WorkerManager.createWorker() 创建一个隔离的 Worker 线程，
   * 在 Worker 中加载并激活插件。激活失败时回滚状态。
   */
  private async activateWorker(pluginId: string, mode: 'worker' | 'process' = 'worker'): Promise<void> {
    const currentState = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;
    this.validateTransition(pluginId, currentState, PluginState.ACTIVATING);
    this.setPluginState(pluginId, PluginState.ACTIVATING);

    const row = this.db.prepare('SELECT file_path, source_code, manifest FROM plugins WHERE id = ?').get(pluginId) as
      { file_path?: string; source_code: string; manifest: string } | undefined;
    if (!row) {
      this.setPluginState(pluginId, currentState);
      throw new PluginActivateError(pluginId, 'plugin not found in database');
    }

    // 读取源码 — 优先文件系统，fallback DB
    const sourceCode: string =
      row.file_path && fs.existsSync(row.file_path) ? fs.readFileSync(row.file_path, 'utf-8') : row.source_code;

    const manifest: Manifest = JSON.parse(row.manifest);
    const actorId = `plugin:${manifest.id}`;

    try {
      // Grant capabilities (same as inline mode activation)
      const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
      const caps = manifest.capabilitiesProposed ?? [];
      for (const cap of caps) {
        await capService.grant(actorId, cap);
      }

      // Resolve EventBus for event forwarding to Worker
      const eventBus = (await this.serviceRegistry.resolve<IEventBusService>(
        IEventBusServiceToken,
      )) as unknown as import('../event-bus/index.js').EventBus;

      const { transport, serviceHost } = await this.workerManager.createWorker(
        pluginId,
        manifest,
        sourceCode,
        (await import('../worker-runtime/worker-manager.js')).ALL_SERVICE_TOKENS,
        eventBus,
        this.getPluginDir(pluginId),
        undefined,
        // L-1 P1 阶段 3：把 executionMode 落到具体隔离原语。
        // 'process' → 子进程（最小 env）；'worker' → thread（缺省，保持原行为）。
        { isolateKind: requiresProcessIsolation(mode) ? 'process' : 'thread' },
      );

      this.pluginInstances.set(pluginId, {
        manifest,
        activate: undefined,
        deactivate: undefined,
        workerRef: { transport, serviceHost },
      });
      this.setPluginState(pluginId, PluginState.ACTIVE, { persistDb: true });
      console.log(`[PluginHost] Plugin "${manifest.id}" activated in WORKER mode (${pluginId})`);
    } catch (err) {
      this.setPluginState(pluginId, PluginState.ERROR, { persistDb: true });
      this.resourceTracker.disposeAll(pluginId);
      this.pluginInstances.delete(pluginId);
      try {
        const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
        await capService.revokeAll(actorId);
      } catch {
        // revokeAll 静默失败
      }
      throw err;
    }
  }

  /**
   * 停用插件。
   * 停用插件。
   *
   * 方法 3: deactivatePlugin(pluginId: string): Promise<void>
   *
   * D-09, D-11：带超时保护的停用流程，无论成功或失败均强制清理资源。
   *
   * 遵循 RESEARCH.md lines 522-548 的精确数据流：
   * 1. 如果 UNINSTALLED 或未找到，静默返回
   * 2. 验证状态转换 ACTIVE → DEACTIVATING
   * 3. 设置状态为 DEACTIVATING
   * 4. 获取 plugin 实例
   * 5. 如果有 deactivate 函数：Promise.race([deactivate(), timeout])
   * 6. finally 块（D-09）：无论成功/超时/错误 — 始终执行：
   *    - resourceTracker.disposeAll(pluginId)
   *    - 状态 → INACTIVE
   *    - DB UPDATE status='inactive'
   *    - capabilityService.revokeAll 撤销能力
   *
   * @param pluginId - 插件标识符
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    pluginId = this.resolvePluginUuid(pluginId);

    const inflight = this.inflightDeactivate.get(pluginId);
    if (inflight) return inflight;

    const task = this.deactivatePluginExclusive(pluginId);
    this.inflightDeactivate.set(pluginId, task);
    try {
      await task;
    } finally {
      if (this.inflightDeactivate.get(pluginId) === task) {
        this.inflightDeactivate.delete(pluginId);
      }
    }
  }

  /**
   * 等待指定插件当前在飞的生命周期操作（activate / deactivate）结束（审计 H-2）。
   *
   * 只等待、不改变状态。用于 reloadPlugin 这类**不参与 inflight 合并**的入口，
   * 使其与其它入口串行，避免双方各自 `disposeAll` 互相踩踏。
   *
   * 有界等待：单个操作本身已有 5s 超时保护，故这里不会无限挂起；
   * 仍加超时兜底，防止将来新增的入口引入无界 promise 时把 reload 拖死。
   */
  protected async waitForLifecycleIdle(pluginId: string, timeoutMs = 10_000): Promise<void> {
    for (let i = 0; i < 2; i++) {
      const inflight =
        (i === 0 ? this.inflightActivate.get(pluginId) : this.inflightDeactivate.get(pluginId)) ?? undefined;
      if (!inflight) continue;
      await Promise.race([
        inflight.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }
  }

  private async deactivatePluginExclusive(pluginId: string): Promise<void> {
    // Heal orphaned DEACTIVATING
    if (this.pluginStates.get(pluginId) === PluginState.DEACTIVATING) {
      console.warn(`[PluginHost] Recovering stuck DEACTIVATING state for "${pluginId}" → INACTIVE before retry`);
      this.setPluginState(pluginId, PluginState.INACTIVE, { persistDb: true });
      return;
    }

    // ── 1. 停用请求到达时插件仍在 ACTIVATING：等它跑完再停（审计 H-2）──────────
    //
    // 修复前此处直接落到下面的「非 ACTIVE 静默 return」，导致用户的停用意图被丢弃：
    // 用户点「停用」，插件随后仍变成 ACTIVE。
    //
    // 真实危害场景是卸载竞态：`uninstallPlugin` 发现状态是 ACTIVATING（非 ACTIVE）
    // 就跳过停用、直接 DELETE DB 行，而在飞的 activate 随后完成 → **已删除的插件
    // 仍在 commandBus 上留着一批 handler**。
    //
    // 正确做法是**等**：activate 完成后状态变为 ACTIVE，此时再执行正常停用流程。
    // 这样无论 activate 成功还是失败，下面的状态检查都会给出正确处置。
    const pendingActivate = this.inflightActivate.get(pluginId);
    if (pendingActivate && this.pluginStates.get(pluginId) === PluginState.ACTIVATING) {
      try {
        await pendingActivate;
      } catch {
        /* activate 失败 → 状态已是 ERROR/INSTALLED，下面会按状态正确处置 */
      }
    }

    // 2. 获取当前状态 — UNINSTALLED、未找到、或非 ACTIVE 状态时静默返回
    //
    // 注意：此处「非 ACTIVE 静默 return」在修复后只剩两种正当场景 ——
    // 插件本来就没激活（重复停用，幂等），或已卸载。不再有「掩盖竞态」的作用。
    const currentState = this.pluginStates.get(pluginId);
    if (!currentState || currentState === PluginState.UNINSTALLED || currentState !== PluginState.ACTIVE) {
      return;
    }

    // 2. 验证状态转换
    this.validateTransition(pluginId, currentState, PluginState.DEACTIVATING);

    // 3. 设置状态为 DEACTIVATING
    this.setPluginState(pluginId, PluginState.DEACTIVATING);

    // Phase 5: Check if this is a worker-mode plugin
    const mode = this.getExecutionMode(pluginId);
    if (mode === 'worker') {
      return this.deactivateWorker(pluginId);
    }

    // 4. 获取实例
    const instance = this.pluginInstances.get(pluginId);

    // 获取 actorId 用于能力撤销
    let actorId: string | undefined;
    if (instance) {
      actorId = `plugin:${instance.manifest.id}`;
    }

    // Phase 7: 中间件管道包裹停用（洋葱模型: beforeDeactivate → deactivate → afterDeactivate）
    const deactManifest = instance?.manifest ?? { id: pluginId, name: pluginId, version: '0.0.0' };
    const deactMiddlewareCtx: MiddlewareContext = {
      pluginId,
      manifest: deactManifest as Manifest,
      phase: 'beforeDeactivate',
      timestamp: Date.now(),
    };
    const beforeDeact = this.getMiddleware('beforeDeactivate');
    const afterDeact = this.getMiddleware('afterDeactivate');

    const deactivatePipeline = compose([
      ...beforeDeact,
      async (_ctx, next) => {
        await next(); // 执行实际停用
        const afterCtx: MiddlewareContext = { ...deactMiddlewareCtx, phase: 'afterDeactivate' };
        const afterPipeline = compose(afterDeact);
        await afterPipeline(afterCtx, async () => {});
      },
    ]);

    try {
      await deactivatePipeline(deactMiddlewareCtx, async () => {
        try {
          // 5. 如果有 deactivate，带超时调用
          if (instance?.deactivate) {
            try {
              await Promise.race([
                instance.deactivate(),
                new Promise<never>((_, reject) =>
                  setTimeout(() => {
                    reject(new PluginDeactivateTimeoutError(pluginId, DEACTIVATION_TIMEOUT_MS));
                  }, DEACTIVATION_TIMEOUT_MS),
                ),
              ]);
            } catch (deactivateErr) {
              // D-11: deactivate 超时或错误 — 记录警告，不重新抛出
              console.error(
                `[PluginHost] Plugin "${pluginId}" deactivate error (continuing forced cleanup):`,
                deactivateErr,
              );
            }
          }
        } finally {
          // 6. D-09: finally 块 — 无论成功/失败/超时，强制清理 (T-04-18)
          this.resourceTracker.disposeAll(pluginId);
          this.pluginInstances.delete(pluginId);
          this.setPluginState(pluginId, PluginState.INACTIVE, { persistDb: true });

          // 热重载注销
          if (this._hotReloadController) {
            this._hotReloadController.unregisterPlugin(pluginId);
          }

          // 撤销能力（T-04-20: finally 中强制撤销）
          if (actorId) {
            try {
              const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
              await capService.revokeAll(actorId);
            } catch (capErr) {
              console.error(`[PluginHost] Failed to revoke capabilities for "${pluginId}":`, capErr);
            }
          }
        }

        console.log(`[PluginHost] Plugin "${pluginId}" deactivated`);
      });
    } catch (pipelineErr) {
      console.warn(
        `[PluginHost] Onion deactivation pipeline crashed for "${pluginId}", executing safety fallback:`,
        pipelineErr,
      );
      this.resourceTracker.disposeAll(pluginId);
      this.pluginInstances.delete(pluginId);
      this.revokePluginContributions(pluginId); // D-1/D-2：注销声明式贡献
      this.setPluginState(pluginId, PluginState.INACTIVE, { persistDb: true });
      if (actorId) {
        try {
          const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
          await capService.revokeAll(actorId);
        } catch {}
      }
      throw pipelineErr;
    }
  }

  // ── Phase 5: Worker-mode deactivation ───────────────────────────────────

  /**
   * Worker 模式停用插件。
   *
   * 委托给 WorkerManager.terminateWorker()。
   * 无论停用成功或失败，finally 块保证清理状态和 DB 记录。
   */
  protected async deactivateWorker(pluginId: string): Promise<void> {
    const currentState = this.pluginStates.get(pluginId);
    if (!currentState || currentState === PluginState.UNINSTALLED) return;
    if (currentState !== PluginState.ACTIVE && currentState !== PluginState.DEACTIVATING) return;

    if (currentState === PluginState.ACTIVE) {
      this.validateTransition(pluginId, currentState, PluginState.DEACTIVATING);
      this.setPluginState(pluginId, PluginState.DEACTIVATING);
    }

    let actorId: string | undefined;
    const instance = this.pluginInstances.get(pluginId);
    if (instance?.manifest?.id) {
      actorId = `plugin:${instance.manifest.id}`;
    }

    try {
      await this.workerManager.terminateWorker(pluginId);
    } catch (termErr) {
      console.error(`[PluginHost] Worker termination error for "${pluginId}":`, termErr);
    } finally {
      // D-09: 与 inline 路径（deactivatePluginExclusive）保持一致 —— 无论成功/失败/超时，
      // 都在 finally 中强制回收资源。此前只有 inline 路径调用 disposeAll，
      // 导致 worker 模式插件停用后命令、事件订阅、定时器、路由永久残留。
      this.resourceTracker.disposeAll(pluginId);
      this.pluginInstances.delete(pluginId);
      this.revokePluginContributions(pluginId); // D-1/D-2：注销声明式贡献
      this.setPluginState(pluginId, PluginState.INACTIVE, { persistDb: true });

      if (actorId) {
        try {
          const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
          await capService.revokeAll(actorId);
        } catch (capErr) {
          console.error(`[PluginHost] Failed to revoke capabilities for "${pluginId}":`, capErr);
        }
      }

      console.log(`[PluginHost] Plugin "${pluginId}" deactivated (worker mode)`);
    }
  }

  /**
   * 切换插件激活/停用状态。
   *
   * @param pluginId - 插件标识符
   * @returns 切换后的状态：'active' 或 'disabled'
   */
  async togglePlugin(pluginId: string): Promise<string> {
    pluginId = this.resolvePluginUuid(pluginId);
    const row = this.db.prepare('SELECT status FROM plugins WHERE id = ?').get(pluginId) as
      { status: string } | undefined;
    if (!row) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    // Wait out any in-flight lifecycle op so we see a stable state
    const pendingActivate = this.inflightActivate.get(pluginId);
    if (pendingActivate) {
      try {
        await pendingActivate;
      } catch {
        /* previous attempt may have failed; continue to toggle based on new state */
      }
    }
    const pendingDeactivate = this.inflightDeactivate.get(pluginId);
    if (pendingDeactivate) {
      try {
        await pendingDeactivate;
      } catch {
        /* ignore */
      }
    }

    let currentState = this.getPluginState(pluginId) ?? PluginState.INSTALLED;

    // Heal stuck transient states (should not linger)
    if (currentState === PluginState.ACTIVATING) {
      console.warn(`[PluginHost] togglePlugin: healing stuck ACTIVATING for "${pluginId}" → ERROR`);
      currentState = PluginState.ERROR;
      this.setPluginState(pluginId, currentState);
    } else if (currentState === PluginState.DEACTIVATING) {
      console.warn(`[PluginHost] togglePlugin: healing stuck DEACTIVATING for "${pluginId}" → INACTIVE`);
      currentState = PluginState.INACTIVE;
      this.setPluginState(pluginId, currentState);
    }

    const newStatus = currentState === PluginState.ACTIVE ? 'disabled' : 'active';

    if (newStatus === 'disabled') {
      await this.deactivatePlugin(pluginId);
    } else {
      await this.activatePlugin(pluginId);
    }

    this.db.prepare('UPDATE plugins SET status = ? WHERE id = ?').run(newStatus, pluginId);
    return newStatus;
  }
}
