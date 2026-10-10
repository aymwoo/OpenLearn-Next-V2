/**
 * WorkerManager — Worker 线程生命周期管理器。
 *
 * 封装 WorkerRegistry（状态机 + 资源追踪）和 Worker 创建/销毁流程。
 * 与 PluginHost 无循环依赖：WorkerManager 不接收 PluginHost，
 * PluginHost 通过 setter 接收 WorkerManager。
 *
 * ## 架构
 *
 * ```
 * PluginHost.activatePlugin(mode='worker')
 *   → WorkerManager.createWorker(pluginId, manifest, sourceCode, tokens)
 *     → new Worker(bootstrapDataUrl)
 *     → NodeWorkerTransport(worker)
 *     → ServiceHost(registry, capGuard, actorId, caps)
 *     → WorkerRegistry.register(pluginId, instance)
 *     → transport.postMessage({ type: 'activate', ... })
 *     → wait for 'activated' (default 60s, sliding on activate-progress)
 *     → return { transport, serviceHost }
 * ```
 *
 * ## 威胁模型
 *
 * - T-05-09: WorkerRegistry.activeCount 上限 32，达到上限时 createWorker 抛出错误
 * - T-05-11: Worker 终止在 finally 块中保证清理
 * - T-05-13: WorkerRegistry 按 pluginId 追踪，transport 通道在创建时 1:1 配对
 *
 * @module
 */

import { Worker } from 'node:worker_threads';
import { WorkerLivenessMonitor } from './liveness-monitor.js';
import type { IWorkerIsolate } from './worker-isolate.js';
import { spawnPluginChild } from './child-spawn.js';
import { composeBootstrapCode } from './bootstrap/index.js';
import { DEFAULT_MAX_OLD_GENERATION_MB } from './plugin-limits.js';
import { ThreadIsolate } from './thread-isolate.js';
import type { Database } from 'better-sqlite3';
import fs from 'fs';
import path from 'node:path';
import { ServiceRegistry } from '../di/service-registry.js';
import { CapabilityGuard } from '../capability/index.js';
import type { EventBus } from '../event-bus/index.js';
import { NodeWorkerTransport } from './transport.js';
import type { IWorkerTransport } from './types.js';
import { ServiceHost } from './service-host.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import { createLogger } from '../observability/logger.js';
import { WorkerActivateError, WorkerTimeoutError } from './errors.js';
import { v7 as uuidv7 } from 'uuid';
import { IEventBusServiceToken } from '../di/index.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** 7 个内核服务 Token 名称字符串 — 用于 Worker 端 RPC 代理。 */
/**
 * 基础 Worker 服务白名单（7 个核心基础设施 Token）。
 * 无需任何额外依赖或权限声明，所有 Worker 插件默认且仅允许使用这些基础服务。
 *
 * 2026-10-04 收敛说明：
 * - **移除了 `IPluginHost`**。`PluginHost` 暴露 `installPlugin` / `installPluginFromZip` /
 *   `activatePlugin` / `uninstallPlugin`；沙箱化的插件本不该有能力安装并激活**其他**插件
 *   ——那等于给了它一个可持久化的后门（装一个能在自身被卸载后继续存活的东西）。
 *   内置插件需要它（`packages/plugins/builtin.ts` 通过 `ctx.resolve` 使用），但内置插件
 *   默认以 **inline 模式**运行，不经过 worker 白名单，因此移除无功能影响。
 *   需要它的 worker 插件应在 manifest 的 `requires` 中显式声明，走下面的条件授予分支。
 * - `IDatabase` 保留，但**其访问范围由 `ServiceHost.assertDatabaseAccessAllowed` 在语句
 *   级管控**：插件只能 DML 自己命名空间（`plugin_<自己id>_*`）下的表，核心表一律拒绝。
 *   白名单只决定"能不能拿到这个服务句柄"，语句守卫决定"能用它做什么"。
 */
export const BASE_WORKER_SERVICE_TOKENS: readonly string[] = Object.freeze([
  '@openlearn/core:ICommandBusService',
  '@openlearn/core:IEventBusService',
  '@openlearn/core:IActionRegistryService',
  '@openlearn/core:ICapabilityService',
  '@openlearn/core:IProcessService',
  '@openlearn/core:IStorageService',
  '@openlearn/core:IAIService',
  '@openlearn/core:IDatabase',
]);

/**
 * 兼容性超集列表，保留供历史外部模块引用。
 */
export const ALL_SERVICE_TOKENS = [
  ...BASE_WORKER_SERVICE_TOKENS,
  '@openlearn/core:IPointsDimensionRegistry',
  '@openlearn/core:IPointsLedgerService',
];

/** 需要显式声明才授予的积分领域服务（与前端 `SENSITIVE_FRONTEND_SERVICE_TOKENS` 同构）。 */
const POINTS_SERVICE_TOKENS = Object.freeze([
  '@openlearn/core:IPointsDimensionRegistry',
  '@openlearn/core:IPointsLedgerService',
]);

/**
 * 规范化依赖条目用于**精确比较**。
 *
 * manifest 依赖写法为 `@openlearn/core:IPointsLedgerService@^1.0.0`（域:服务名@版本范围），
 * 而上面的白名单常量只到服务名。剥掉版本范围后做全等比较，避免 `includes` 子串匹配
 * 被 `IAmPointsLedgerServiceButFake` 之类伪造条目命中。
 */
function normalizeDepEntry(entry: string): string {
  const slash = entry.indexOf('/');
  if (slash === -1) return entry;
  const versionAt = entry.indexOf('@', slash);
  return versionAt === -1 ? entry : entry.slice(0, versionAt);
}

/**
 * 根据插件 Manifest 声明动态计算该 Worker 允许访问的 Service Tokens 白名单。
 * 杜绝未声明权限的插件随意访问敏感领域服务（如积分账本）。
 */
export function computeAllowedWorkerTokens(manifest?: Manifest, requestedTokens?: Iterable<string>): string[] {
  const allowed = new Set<string>(BASE_WORKER_SERVICE_TOKENS);
  if (manifest) {
    const reqs = Array.isArray(manifest.requires) ? manifest.requires : [];
    const opts = Array.isArray(manifest.optional) ? manifest.optional : [];
    const allDeclared = [...reqs, ...opts];
    const caps = Array.isArray(manifest.capabilitiesProposed) ? manifest.capabilitiesProposed : [];

    // 积分服务：仅当插件在 requires/optional 或 capabilitiesProposed 明确声明 points 权限时授予
    //
    // B-2：原先用 `dep.includes('IPointsLedgerService')` 做**子串匹配**，可被伪造绕过 ——
    // manifest 写 `requires: ['@evil/x:IAmPointsLedgerServiceButFake']` 即命中，
    // 从而拿到积分账本写入权。改为剥掉版本范围后的**精确 Token 比较**。
    const normalizedDeclared = new Set(
      allDeclared.filter((d): d is string => typeof d === 'string').map(normalizeDepEntry),
    );
    const hasPointsDep = POINTS_SERVICE_TOKENS.some((t) => normalizedDeclared.has(normalizeDepEntry(t)));
    const hasPointsCap = caps.some(
      (c) => typeof c === 'string' && (c === 'points' || c.startsWith('points:') || c === '*'),
    );

    if (hasPointsDep || hasPointsCap) {
      for (const t of POINTS_SERVICE_TOKENS) allowed.add(t);
    }
  }

  if (requestedTokens) {
    const requestedSet = new Set(requestedTokens);
    return Array.from(allowed).filter((t) => requestedSet.has(t));
  }

  return Array.from(allowed);
}

/** 最大并行 Worker 数（T-05-09: DoS 缓解）。 */
const MAX_WORKERS = 32;

/**
 * Worker 激活超时（毫秒）。
 *
 * 全栈插件在 Worker 内需要：动态 import、IPC resolve 多个 Token、schema migrate/建表。
 * 主线程繁忙时 parentPort RPC 会排队，固定 10s 极易误超时。
 * 可通过环境变量覆盖：OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS
 */
const ACTIVATE_TIMEOUT_MS = (() => {
  const raw = process.env.OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS;
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 5000) return Math.floor(n);
  return 60_000; // default 60s (was 10s)
})();

/** 收到 activate-progress 心跳时，将剩余超时重置为该窗口（滑动超时）。 */
const ACTIVATE_PROGRESS_SLIDE_MS = (() => {
  const raw = process.env.OPENLEARN_WORKER_ACTIVATE_PROGRESS_SLIDE_MS;
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 3000) return Math.floor(n);
  return Math.min(30_000, ACTIVATE_TIMEOUT_MS);
})();

// ── WorkerInstance ───────────────────────────────────────────────────────────

/**
 * WorkerInstance — 已注册 Worker 的内部运行时记录。
 *
 * 由 WorkerRegistry 追踪，包含 Worker 线程引用、运输层、ServiceHost 等。
 * status 字段追踪生命周期：activating → running → terminating/crashed。
 */
interface WorkerInstance {
  pluginId: string;
  /**
   * 隔离原语（P1 阶段 1）。
   *
   * 此前这里是 `worker: Worker`（`node:worker_threads.Worker`），把注册表与
   * worker_threads 焊死了 —— 即使消息通道已有 `IWorkerTransport` 抽象，
   * 生命周期（threadId / on('exit') / terminate）仍是专有的，子进程接不进来。
   *
   * 保留一个只读的 `worker` getter 供过渡期使用；新代码一律走 `isolate`。
   */
  isolate: IWorkerIsolate;
  createdAt: number;
  status: 'activating' | 'running' | 'terminating' | 'crashed';
  transport: IWorkerTransport;
  serviceHost: ServiceHost;
  manifest?: Manifest;
  sourceCode?: string;
  serviceTokens?: string[];
  eventBus?: EventBus;
  pluginDir?: string;
}

// ── WorkerRegistry ───────────────────────────────────────────────────────────

/**
 * WorkerRegistry — Worker 实例注册表。
 *
 * 职责：
 * - 按 pluginId 追踪活跃 Worker
 * - 'exit' 事件监听器自动检测 Worker 崩溃并触发自动拉起监控
 */
export class WorkerRegistry {
  /** pluginId → WorkerInstance */
  private workers = new Map<string, WorkerInstance>();

  /** pluginId → { count: number, lastTime: number } */
  private crashStats = new Map<string, { count: number; lastTime: number }>();

  /**
   * 看门狗重启的待执行定时器（审计 C-6）。
   *
   * 修复前 `setTimeout(...)` 的返回值被丢弃，`terminate()` 只做 `crashStats.delete(pluginId)`，
   * **不取消该定时器**。后果：worker 崩溃后若插件在同一秒内被停用或卸载，
   * 1–4 秒后回调仍会执行 `recreateWorkerCallback`，给已停用/已卸载的插件重建 Worker ——
   * 即「僵尸复活」。且 `pluginInstances.workerRef` 不会更新，
   * `dispatchHttpRequest` 与命令派发仍指向已死 transport。
   *
   * 用 `Set` 而非单个 Timer：连续多次崩溃会各自排定一次重启，
   * 单槽设计会让后一次排定覆盖前一次，从而丢失已排定的重启。
   */
  private watchdogTimers = new Map<string, Set<NodeJS.Timeout>>();

  public recreateWorkerCallback?: (
    pluginId: string,
    manifest: Manifest,
    sourceCode: string,
    serviceTokens: string[],
    eventBus?: EventBus,
    pluginDir?: string,
  ) => Promise<any>;

  public onCircuitBreakerTriggered?: (pluginId: string) => void;

  /**
   * 注册一个 WorkerInstance。
   *
   * 如果 pluginId 已有 Worker，抛出错误。
   * 注册时自动附加 'exit' 事件处理，用于崩溃检测。
   *
   * @param pluginId - 插件标识符
   * @param instance - Worker 实例
   * @throws Error 如果 pluginId 已存在
   */
  register(pluginId: string, instance: WorkerInstance): void {
    if (this.workers.has(pluginId)) {
      throw new Error(`Worker already registered for plugin "${pluginId}"`);
    }

    this.workers.set(pluginId, instance);

    // T-05-13: 自动崩溃检测 — 非零退出码且仍在追踪中时标记 crashed
    instance.isolate.onError((err) => {
      console.error(`[WorkerRegistry] Worker for "${pluginId}" encountered error:`, err);
    });

    instance.isolate.onExit((code) => {
      if (this.workers.has(pluginId)) {
        const entry = this.workers.get(pluginId)!;
        if (entry.status === 'terminating') {
          // Intentionally terminated, not a crash!
          return;
        }
        if (entry.status === 'activating') {
          // Worker crashed or exited during activation before sending 'activated'.
          // Mark as crashed, clean up, but DO NOT trigger watchdog restarts.
          // The activation promise in createWorker will reject with WorkerActivateError.
          entry.status = 'crashed';
          console.error(`[WorkerRegistry] Worker for "${pluginId}" exited with code ${code} during activation`);
          if (entry.serviceHost && typeof entry.serviceHost.dispose === 'function') {
            entry.serviceHost.dispose().catch((err) => {
              console.error(
                `[WorkerRegistry] Failed to dispose serviceHost on activation crash for "${pluginId}":`,
                err,
              );
            });
          }
          this.cleanup(pluginId);
          return;
        }
        if (code !== 0) {
          entry.status = 'crashed';
          console.error(`[WorkerRegistry] Worker for "${pluginId}" exited with code ${code}`);

          const manifest = entry.manifest;
          const sourceCode = entry.sourceCode;
          const serviceTokens = entry.serviceTokens;
          const eventBus = entry.eventBus;
          const pluginDir = entry.pluginDir;

          // Clean up registered commands and resources on the host side
          if (entry.serviceHost && typeof entry.serviceHost.dispose === 'function') {
            entry.serviceHost.dispose().catch((err) => {
              console.error(`[WorkerRegistry] Failed to dispose serviceHost on crash for "${pluginId}":`, err);
            });
          }

          this.cleanup(pluginId);

          if (manifest && sourceCode && serviceTokens) {
            this.scheduleWatchdogRestart(pluginId, { manifest, sourceCode, serviceTokens, eventBus, pluginDir });
          }
        }
      }
    });
  }

  /**
   * 崩溃后的看门狗重启调度（指数退避 1s / 2s / 4s，超过 3 次触发熔断）。
   *
   * 从 `createWorker` 的 exit 处理器里抽出为独立方法，原因有二：
   * 1. **可测**：exit 处理器是闭包，无法在测试中触发（需要真实 Worker 崩溃）；
   *    抽出后可直接测「排定 → terminate → 不复活」这个真正的安全不变量。
   * 2. **单职责**：崩溃检测与重启策略本就是两件事。
   *
   * 审计 C-6：定时器句柄必须记录，否则 `terminate()` 无法取消，
   * 会给已停用/已卸载的插件「复活」。
   */
  scheduleWatchdogRestart(
    pluginId: string,
    params: {
      manifest: unknown;
      sourceCode: string;
      serviceTokens: string[];
      eventBus: unknown;
      pluginDir?: string;
    },
  ): void {
    let stats = this.crashStats.get(pluginId) || { count: 0, lastTime: 0 };
    const now = Date.now();
    if (now - stats.lastTime > 300000) {
      stats.count = 0;
    }
    stats.count += 1;
    stats.lastTime = now;
    this.crashStats.set(pluginId, stats);

    if (stats.count > 3) {
      console.error(
        `[WorkerRegistry] Worker for "${pluginId}" crashed ${stats.count} times in 5 mins. Circuit breaker triggered.`,
      );
      if (this.onCircuitBreakerTriggered) {
        this.onCircuitBreakerTriggered(pluginId);
      }
      return;
    }

    const delay = Math.pow(2, stats.count - 1) * 1000;
    console.warn(
      `[WorkerRegistry] Worker for "${pluginId}" crashed. Watchdog restarting (attempt ${stats.count}/3) in ${delay}ms...`,
    );

    const timer = setTimeout(async () => {
      // 触发时从 Set 摘除，避免堆积已执行的句柄
      this.watchdogTimers.get(pluginId)?.delete(timer);
      try {
        if (this.recreateWorkerCallback) {
          await this.recreateWorkerCallback(
            pluginId,
            params.manifest as never,
            params.sourceCode,
            params.serviceTokens,
            params.eventBus as never,
            params.pluginDir,
          );
        }
      } catch (err) {
        console.error(`[WorkerRegistry] Watchdog recovery failed for "${pluginId}":`, err);
      }
    }, delay);

    // 记录句柄，供 terminateWorker()/terminate() 取消（审计 C-6 僵尸复活）
    let timers = this.watchdogTimers.get(pluginId);
    if (!timers) {
      timers = new Set();
      this.watchdogTimers.set(pluginId, timers);
    }
    timers.add(timer);
  }

  /**
   * 通过 pluginId 获取 WorkerInstance。
   *
   * @param pluginId - 插件标识符
   * @returns WorkerInstance 或 undefined
   */
  get(pluginId: string): WorkerInstance | undefined {
    return this.workers.get(pluginId);
  }

  /**
   * 终止指定 Worker 并清理所有资源。
   *
   * 流程：
   * 1. 发送 deactivate-request 消息
   * 2. Promise.race 等待 'deactivated' 响应或超时
   * 3. finally 块中总是调用 worker.terminate()（T-05-11）
   * 4. cleanup 从两个 Map 中移除
   *
   * @param pluginId - 插件标识符
   * @param timeoutMs - deactivate 等待超时（默认 3000ms）
   */
  async terminate(pluginId: string, timeoutMs = 3000): Promise<any> {
    // 取消待执行的重启定时器（审计 C-6 僵尸复活）。
    //
    // 修复前只做 `crashStats.delete`，定时器仍在飞 —— 崩溃后立刻停用/卸载插件，
    // 1–4 秒后回调仍会给已停用/已卸载的插件重建 Worker。
    //
    // **必须早于下面的 `if (!instance) return`**：崩溃路径已把实例移出 workers map，
    // 而「崩溃后立刻停用」正是僵尸复活的触发场景，若放在早退之后就完全失效。
    this.cancelWatchdog(pluginId);
    this.crashStats.delete(pluginId);

    const instance = this.workers.get(pluginId);
    if (!instance) return;

    instance.status = 'terminating';
    let state: any = undefined;

    try {
      // 发送 deactivate-request，等待 deactivated 响应或超时
      instance.transport.postMessage({ type: 'deactivate-request' });

      state = await Promise.race([
        new Promise<any>((resolve, reject) => {
          // 注册一次性消息处理器等待 deactivated 响应
          const originalHandler = (instance.transport as unknown as { messageHandler?: (msg: unknown) => void })
            .messageHandler;

          instance.transport.onMessage((msg: unknown) => {
            const typed = msg as { type?: string; state?: any };
            if (typed.type === 'deactivated') {
              resolve(typed.state);
            } else if (typed.type === 'error') {
              // Worker 报告错误 — 记录但继续等待 deactivated
              console.error(
                `[WorkerRegistry] Worker "${pluginId}" error during deactivate:`,
                (msg as { message?: string }).message,
              );
            }
          });

          // 超时
          setTimeout(() => {
            reject(new Error(`Deactivate timeout for "${pluginId}"`));
          }, timeoutMs);
        }),
      ]);
    } catch {
      // 超时或错误 — 记录警告，继续强制终止
      console.warn(`[WorkerRegistry] Graceful deactivate failed for "${pluginId}", force terminating`);
    } finally {
      // T-05-11: finally 块保证 Worker 终止
      try {
        await instance.isolate.terminate();
      } catch (termErr) {
        console.error(`[WorkerRegistry] Worker terminate error for "${pluginId}":`, termErr);
      }
      this.cleanup(pluginId);
    }
    return state;
  }

  /**
   * 清理 Worker 注册数据。
   *
   * 幂等操作 — 可重复调用。
   *
   * P1 阶段 1：原先这里还要从 `workerByThreadId` 删一条。该 Map 标注「用于崩溃检测」，
   * 但全仓**只写不读**（只有 set / delete，没有任何读取点）—— 崩溃检测实际由
   * `onExit` 回调完成。它是「注册表依赖 worker_threads 专有 threadId」的唯一来源，
   * 故随本次抽象一并删除。删除前已用 grep 确认零读取，并补了回归用例。
   *
   * @param pluginId - 插件标识符
   */
  cleanup(pluginId: string): void {
    this.workers.delete(pluginId);
  }

  /**
   * 取消该插件待执行的看门狗重启定时器（审计 C-6）。
   *
   * 幂等；无待执行定时器时为无操作。由 terminate() 与 shutdownAll() 调用。
   *
   * 注意：crash 路径自身的 cleanup() **不能**承担此职责 ——
   * crash handler 里 `cleanup()`（285 行）先于 `setTimeout()`（302 行）执行，
   * 在 cleanup 里取消只会清掉「上一次崩溃」的句柄，对本次刚排的定时器无效。
   */
  cancelWatchdog(pluginId: string): void {
    const timers = this.watchdogTimers.get(pluginId);
    if (!timers) return;
    for (const t of timers) clearTimeout(t);
    this.watchdogTimers.delete(pluginId);
  }

  /** 当前活跃 Worker 数量（用于 DoS 上限检测 T-05-09）。 */
  get activeCount(): number {
    return this.workers.size;
  }

  /** 返回所有活跃 Worker 的 pluginId 列表。 */
  list(): string[] {
    return Array.from(this.workers.keys());
  }
}

// ── Bootstrap code generator ─────────────────────────────────────────────────

/**
 * 生成 Worker 端引导代码（自包含 ESM 模块，以 data URL 形式加载）。
 *
 * 此代码在 Worker 的隔离 V8 上下文中执行，无法访问磁盘上的模块，
 * 因此必须内联 createServicesProxy 和 createMethodProxy 的实现。
 *
 * Worker 端消息处理架构（单 handler 分发）：
 * 1. invokeId 匹配 → RPC 结果/错误分发
 * 2. type === 'activate' → 加载插件、创建代理、激活
 * 3. type === 'deactivate-request' → 停用、清理
 */
function generateBootstrapCode(): string {
  const rootPath = process.cwd().replace(/\\/g, '/');
  // L-2 阶段 1：模板体已拆成 5 个具名 section（bootstrap/sections/*），
  // 这里只负责取 requirePath 并委托组装。
  return composeBootstrapCode(`${rootPath}/package.json`);
}

// ── WorkerManager ────────────────────────────────────────────────────────────

/**
 * WorkerManager — Worker 线程创建/终止管理器。
 *
 * **核心设计：** WorkerManager 不依赖 PluginHost（循环依赖已消除）。
 * PluginHost 通过 setter 接收 WorkerManager 引用。
 *
 * 构造函数参数：
 * - serviceRegistry: DI 容器，用于 ServiceHost 的 RPC 服务解析
 * - capabilityGuard: 能力守卫，用于 ServiceHost 的能力检查
 * - db: SQLite 数据库实例，用于 restoreWorkers
 *
 * @example
 * ```ts
 * const wm = new WorkerManager(serviceRegistry, capabilityGuard, db);
 * const { transport, serviceHost } = await wm.createWorker(
 *   'ext-my-service', manifest, sourceCode, ALL_SERVICE_TOKENS,
 * );
 * ```
 */
export class WorkerManager {
  /** Worker 注册表 */
  readonly registry = new WorkerRegistry();

  private serviceRegistry: ServiceRegistry;
  private capabilityGuard: CapabilityGuard;
  private db: Database;

  /**
   * 存活探活器（L-1 P0）。
   *
   * 治的是「卡死但没崩溃」的 worker：一个 `while(true)` 的插件永久占住一个槽位
   * （上限 32），而崩溃看门狗监听 `exit` —— 死循环不产生 exit，故永不触发。
   *
   * 判据是 ping/pong 而非「多久没说话」：后者会误杀健康但空闲的插件。
   * 详见 `liveness-monitor.ts` 顶部注释（含两条被实测否决的替代判据）。
   */
  /**
   * 隔离原语类型（P1 阶段 2）。
   *
   * 默认 `'thread'` —— 与本项改造前**完全一致**。子进程模式是显式开启的，
   * 因为它是行为变更（进程级隔离、启动更慢、stdout/stderr 走管道、env 白名单），
   * 在拿到两种原语的全量行为对比数据之前不应改默认值。
   *
   * 可经 `OPENLEARN_WORKER_ISOLATE=process` 全局切换，便于灰度与对比。
   */
  private readonly isolateKind: 'thread' | 'process' =
    process.env.OPENLEARN_WORKER_ISOLATE === 'process' ? 'process' : 'thread';

  /** SIGKILL 之前的 SIGTERM 宽限期（ms）。0 = 立即强杀（保守默认，见 ChildProcessIsolate 注释） */
  private readonly childTermGraceMs: number = Number(process.env.OPENLEARN_WORKER_TERM_GRACE_MS ?? 0) || 0;

  private liveness = new WorkerLivenessMonitor({
    listRunningPluginIds: () => this.registry.list(),
    sendPing: (pluginId, seq) => {
      const inst = this.registry.get(pluginId);
      if (!inst) throw new Error(`no worker instance for ${pluginId}`);
      inst.transport.postMessage({ type: 'ping', seq });
    },
    // 走既有 terminateWorker → registry.terminate → exit 处理器
    // → scheduleWatchdogRestart（指数退避 + 熔断），不另建崩溃通道。
    terminate: (pluginId, reason) => {
      console.error(`[WorkerManager] [L-1 P0] ${reason} —— 终止 worker 并交由崩溃看门狗处理`);
      void this.terminateWorker(pluginId);
    },
  });

  /**
   * 探活器只读访问器（L-1 P0）。
   *
   * 存在的理由与 `PluginHost.contributions` 同源：探活的判定逻辑本身是一个
   * 值得断言的不变量（「空闲不被误杀」「卡死必被杀」「终止只发生一次」），
   * 而它的三个触发点分散在 activate / onMessage / terminate 三处。
   * 用 `as any` 绕 private 也能测，但那样测不到「这是有意的公开契约」。
   */
  get livenessMonitor(): WorkerLivenessMonitor {
    return this.liveness;
  }

  constructor(serviceRegistry: ServiceRegistry, capabilityGuard: CapabilityGuard, db: Database) {
    this.serviceRegistry = serviceRegistry;
    this.capabilityGuard = capabilityGuard;
    this.db = db;

    // 启动探活定时器（L-1 P0）。
    //
    // 在构造期就启动（而不是等第一个 worker 激活成功）是为了让「运行时长」不成为
    // 隐性依赖；而它 `unref()` 过，不会让宿主进程保持存活，也不是业务必需路径。
    // 默认 30s 一轮、15s 宽限 ⇒ 卡死后最多 ~45s 被终止。
    // 可用 `OPENLEARN_WORKER_LIVENESS=off` 关闭，或用
    // `OPENLEARN_WORKER_LIVENESS_INTERVAL_MS` / `_GRACE_MS` 调整。
    this.liveness.start();

    // Set up supervisor watchdog callbacks for auto-recovery
    this.registry.recreateWorkerCallback = async (
      pluginId,
      manifest,
      sourceCode,
      serviceTokens,
      eventBus,
      pluginDir,
    ) => {
      console.log(`[WorkerManager] Watchdog supervisor restarting worker for plugin "${pluginId}"`);
      await this.createWorker(pluginId, manifest, sourceCode, serviceTokens, eventBus, pluginDir);
    };

    this.registry.onCircuitBreakerTriggered = async (pluginId) => {
      // Set plugin status to ERROR in database
      this.db.prepare('UPDATE plugins SET status = ? WHERE id = ?').run('error', pluginId);

      // Also publish plugin.crashed event to the EventBus
      try {
        const eventBusService = await this.serviceRegistry.resolve(IEventBusServiceToken);
        if (eventBusService) {
          eventBusService.publish({
            id: uuidv7(),
            type: 'plugin.crashed',
            source: 'worker-registry',
            payload: { pluginId },
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error('[WorkerManager] Failed to publish plugin.crashed event:', err);
      }
    };
  }

  /**
   * 创建一个 Worker 隔离的插件实例。
   *
   * 流程（遵循 RESEARCH.md lines 868-963）：
   * 1. 检查 pluginId 是否已注册 → 抛出错误
   * 2. 检查 activeCount 是否达到上限（T-05-09）→ 抛出错误
   * 3. 生成引导代码 data URL
   * 4. 创建 Worker 线程
   * 5. 创建 NodeWorkerTransport
   * 6. 创建 ServiceHost（用于 RPC）
   * 7. 注册到 WorkerRegistry（含 crash 检测）
   * 8. 设置 transport.onMessage 路由到 ServiceHost
   * 9. 发送 activate 消息
   * 10. 等待 'activated'（默认 60s；activate-progress 心跳滑动续期）
   * 11. 返回 { transport, serviceHost }
   *
   * @param pluginId - 插件标识符
   * @param manifest - 插件 manifest
   * @param sourceCode - 插件源代码
   * @param serviceTokens - 服务 Token 名称列表
   * @param eventBus - 可选的 EventBus 实例，用于事件转发。提供时，Worker
   *                   的 subscribe 消息会创建 EventForwarder 订阅。
   * @returns transport 和 serviceHost
   * @throws WorkerActivateError — 创建失败
   * @throws WorkerTimeoutError — 激活超时
   * @throws Error — 已存在或达到上限
   */
  /**
   * @param opts.isolateKind - 本次实例用哪种隔离原语。**不给则用 Manager 级默认值**
   *   （`OPENLEARN_WORKER_ISOLATE`，默认 `'thread'`）。
   *
   *   L-1 P1 阶段 3：原先隔离原语是 Manager 级单值，一个进程内所有 worker 只能同种。
   *   改成**按实例覆盖**，才能让 `'worker'` 与 `'process'` 两种模式的插件在同一
   *   进程内共存 —— 这也是让 `executionMode` 真正有第三个取值的意义。
   */
  async createWorker(
    pluginId: string,
    manifest: Manifest,
    sourceCode: string,
    serviceTokens: string[],
    eventBus?: EventBus,
    pluginDir?: string,
    prevState?: any,
    opts?: { isolateKind?: 'thread' | 'process' },
  ): Promise<{ transport: IWorkerTransport; serviceHost: ServiceHost }> {
    // 1. 检查重复
    if (this.registry.get(pluginId)) {
      throw new Error(`Worker already exists for plugin "${pluginId}"`);
    }

    // 2. T-05-09: DoS 上限控制
    if (this.registry.activeCount >= MAX_WORKERS) {
      throw new Error(`Cannot create Worker: maximum active Workers (${MAX_WORKERS}) reached`);
    }

    // 3. 生成引导代码
    const bootstrapCode = generateBootstrapCode();
    const encodedBootstrap = Buffer.from(bootstrapCode, 'utf-8').toString('base64');
    const bootstrapDataUrl = `data:text/javascript;base64,${encodedBootstrap}`;

    // 动态按 Manifest 计算当前插件被授权的 Tokens（能力沙箱隔离）
    const allowedTokens = computeAllowedWorkerTokens(manifest, serviceTokens);

    // 4. 创建隔离原语
    //
    // P1 阶段 2：worker_threads（默认）与 child_process（可选）两条路径并存。
    // 默认值不变 —— 子进程模式是**显式开启**的，因为它是行为变更（进程级隔离、
    // 启动更慢、stdout/stderr 走管道），不应在未验证对比数据前切换默认值。
    //
    // 选择哪种原语由 `isolateKind` 决定，可经 `OPENLEARN_WORKER_ISOLATE=process` 全局切换。
    const resolvedPluginDir = pluginDir && fs.existsSync(path.join(pluginDir, 'index.js')) ? pluginDir : undefined;
    const workerData = {
      pluginId,
      manifestId: manifest.id,
      serviceTokens: allowedTokens,
      pluginDir: resolvedPluginDir,
    };

    let worker: Worker | undefined;
    let childProcess: import('node:child_process').ChildProcess | undefined;
    let transport: IWorkerTransport;
    let isolate: IWorkerIsolate;
    let childLogger: { info: (m: string) => void; error: (m: string) => void } | undefined;

    try {
      const isolateKind = opts?.isolateKind ?? this.isolateKind;
      if (isolateKind === 'process') {
        const spawned = spawnPluginChild({
          bootstrapCode,
          data: workerData,
          termGraceMs: this.childTermGraceMs,
          // L-1 P2：能力面收敛。刻意**不**往这层传 policy —— 它由
          // spawnPluginChild 内部读 OPENLEARN_PLUGIN_PERMISSION，
          // 这样任何 spawn 路径（含测试直接调 spawnPluginChild）都自动受约束，
          // 而不存在「WorkerManager 记得传、别处忘了传」的口子。
          // ⚠️ 仅对 process 原语生效；worker_threads 侧未启用（见 plugin-permission.ts）。
          permissionPaths: { pluginDir: pluginDir, rootPath: process.cwd() },
        });
        childProcess = spawned.child;
        transport = spawned.transport;
        isolate = spawned.isolate;

        const tag = `Plugin:${manifest.id || pluginId}`;
        childLogger = {
          info: (m: string) => console.log(`[${tag}] ${m}`),
          error: (m: string) => console.error(`[${tag}] ${m}`),
        };
        childProcess.stdout?.on('data', (chunk: Buffer) => childLogger!.info(chunk.toString().trim()));
        childProcess.stderr?.on('data', (chunk: Buffer) => childLogger!.error(chunk.toString().trim()));
      } else {
        worker = new Worker(new URL(bootstrapDataUrl), {
          // Pass both the DB id (`pluginId` — used as the actor/registry key)
          // and `manifestId` (used as the namespace prefix for command types).
          // The two diverge for ZIP-uploaded plugins whose DB id is a generated
          // UUID while manifest.id is the plugin author's chosen name.
          workerData,
          eval: false,
          stdout: true,
          stderr: true,
          /**
           * 用一段**实测结论**替换掉此前错误的断言（2026-10-07 收尾复核更正）。
           *
           * 此前这里写的是「worker_threads 是协作式的，terminate() 对同步死循环无效，
           * 同步死循环无法被强制终止」—— **该断言是错的**，来源是我在 I-5 时的一次探针
           * 缺陷：那次探针打印的「6s 未终止」测的是 `WorkerOptions.timeout` 选项有没有触发，
           * 之后才调 terminate()，**从未单独验证 terminate 本身**。
           *
           * 复测（3 轮 × 2 种载荷，同一份脚本）：
           *
           *   模块体 while(true)         exit code=1@2ms  exit code=1@2ms  exit code=1@3ms
           *   定时器内 while(true)        exit code=1@2ms  exit code=1@3ms  exit code=1@2ms
           *   死循环期间主线程 300ms 内完成 29 次 tick → 主线程未被阻塞
           *
           * 结论：**terminate() 能可靠终止同步死循环的 worker**（worker 有独立 isolate，
           * V8 侧销毁 isolate 不需要 JS 栈配合；这与 `Atomics.wait` 的协作式阻塞不同）。
           *
           * 那 CPU DoS 的真实缺口是什么？不是「杀不掉」，而是**没有人去杀**：
           *   · 没有 CPU 时间配额 —— resourceLimits 只管堆
           *   · watchdog 监听 `exit` 事件，而死循环**不产生 exit**，故永不触发
           *   ⇒ 一个 `while(true)` 的插件会占住一个槽位直到进程结束，打满 32 个即 DoS
           *
           * 修法是**宿主侧的 CPU 看门狗**（超时未收到心跳即调 terminate()），
           * 属低成本改动，不需要换隔离原语。真正的进程隔离另见 L-1 立项提案，
           * 其理由是**纵深防御与爆炸半径**，不是「当前已可 RCE」。
           */
          // I-5（D-1 决策）：此处刻意不设 timeout —— 该选项在 @types/node@24 的
          // WorkerOptions 中**不存在**，实测传入亦完全无效。CPU 侧的兜底靠宿主
          // 看门狗调 terminate()，见上方说明。
          resourceLimits: {
            // ★ 与子进程的 --max-old-space-size 取**同一个常量**（plugin-limits.ts）。
            //   之前这里是硬编码 128，而子进程根本没有堆上限 —— 于是同一插件在两种
            //   隔离原语下内存行为不同，且漂移表现为「worker 模式正常、process 模式
            //   OOM」，极难排查。收敛到单一真源后不可能再漂移。
            maxOldGenerationSizeMb: DEFAULT_MAX_OLD_GENERATION_MB,
            maxYoungGenerationSizeMb: 32,
          },
        });
        const pluginLogger = createLogger(`Plugin:${manifest.id || pluginId}`);
        worker.stdout.on('data', (chunk) => {
          pluginLogger.info(chunk.toString().trim());
        });
        worker.stderr.on('data', (chunk) => {
          pluginLogger.error(chunk.toString().trim());
        });
        transport = new NodeWorkerTransport(worker);
        isolate = new ThreadIsolate(worker);
      }
    } catch (err) {
      // 子进程若已起来但后续失败，必须把它杀掉 —— 否则留下一个孤儿进程，
      // 它会一直占着一个 CPU 槽位直到进程结束（正是 L-1 要防的形态）。
      try {
        childProcess?.kill('SIGKILL');
      } catch {
        /* 已经退出 */
      }
      throw new WorkerActivateError(pluginId, 'Worker constructor failed', {
        cause: err instanceof Error ? err : undefined,
      });
    }

    // 6. 创建 ServiceHost（带可选的 EventBus 用于事件转发与 Token 授权白名单）
    const actorId = `plugin:${manifest.id}`;
    const manifestCaps = manifest.capabilitiesProposed ?? [];
    const serviceHost = new ServiceHost(
      this.serviceRegistry,
      this.capabilityGuard,
      actorId,
      manifestCaps,
      eventBus, // optional: enables event forwarding
      undefined,
      // 7th arg is the namespace prefix used by the host-side
      // registerHandler/unregisterHandler intercept. It must be
      // `manifest.id` (NOT the DB UUID `pluginId`) so the prefix
      // matches what the frontend `ctx.invokeCommand` produces —
      // see packages/core/plugin-host/plugin-namespace.ts.
      manifest.id,
      pluginId,
      allowedTokens,
    );

    // 7. 注册到 WorkerRegistry（含 crash 检测）
    const createdAt = Date.now();
    this.registry.register(pluginId, {
      pluginId,
      // P1 阶段 1/2：把隔离原语包成 IWorkerIsolate，注册表只看接口，
      // 不再知道 threadId / on('exit') 这类专有形状 —— 两种原语在此归一。
      isolate,
      createdAt,
      status: 'activating',
      transport,
      serviceHost,
      manifest,
      sourceCode,
      serviceTokens,
      eventBus,
      pluginDir,
    });

    // 8. 设置 transport 消息路由 → ServiceHost 及生命周期拦截
    let activationResolve: (() => void) | null = null;
    let activationReject: ((err: Error) => void) | null = null;
    let activationTimer: ReturnType<typeof setTimeout> | null = null;
    let activationTimedOut = false;
    const activationStartedAt = Date.now();

    const clearActivationTimer = () => {
      if (activationTimer) {
        clearTimeout(activationTimer);
        activationTimer = null;
      }
    };

    const armActivationTimer = (ms: number, reason: string) => {
      clearActivationTimer();
      activationTimer = setTimeout(() => {
        activationTimedOut = true;
        const elapsed = Date.now() - activationStartedAt;
        if (activationReject) {
          activationReject(
            new WorkerTimeoutError(
              ms,
              `Worker activation timed out after ${elapsed}ms (last window ${ms}ms, reason=${reason}). ` +
                `Full-stack plugins may need OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS raised ` +
                `(current default ${ACTIVATE_TIMEOUT_MS}ms).`,
            ),
          );
          activationResolve = null;
          activationReject = null;
        }
      }, ms);
    };

    const onWorkerExit = (code: number | null) => {
      clearActivationTimer();
      if (activationReject) {
        activationReject(
          new WorkerActivateError(
            pluginId,
            `Worker process exited with code ${code} during activation before sending 'activated'`,
          ),
        );
        activationResolve = null;
        activationReject = null;
      }
    };

    const onWorkerError = (err: Error) => {
      clearActivationTimer();
      if (activationReject) {
        activationReject(
          new WorkerActivateError(
            pluginId,
            `Worker process encountered error during activation: ${err?.message || err}`,
            { cause: err },
          ),
        );
        activationResolve = null;
        activationReject = null;
      }
    };

    // P1 阶段 2：走 isolate 而非 worker —— 两种原语在此归一。
    // 原本用 once/off 精确解绑；IWorkerIsolate 不提供 off，因为两种原语的
    // exit/error 都**至多触发一次**，且下面的 activationReject/Resolve 置 null
    // 已保证重复触发无害（不会二次 reject）。
    isolate.onExit(onWorkerExit);
    isolate.onError(onWorkerError);

    const cleanupActivationWorkerListeners = () => {
      /* 见上：activate/terminate 路径靠置空 activationResolve/Reject 保证幂等 */
    };

    transport.onMessage((msg: unknown) => {
      const typed = msg as { type?: string; stage?: string; message?: string };

      // 任何入站消息都是存活证据（L-1 P0），不只认 pong：
      // RPC 响应、事件、日志、HTTP 流分片都说明事件循环在转。
      // 只认 pong 会误杀高频通信但 pong 排在队列后面的插件。
      if (typed.type === 'pong') {
        this.liveness.notePong(pluginId, (msg as { seq: number }).seq);
      } else {
        this.liveness.noteActivity(pluginId);
      }

      if (typed.type === 'activated') {
        clearActivationTimer();
        cleanupActivationWorkerListeners();
        const instance = this.registry.get(pluginId);
        if (instance) {
          instance.status = 'running';
        }
        // 激活成功后才开始探活（L-1 P0）
        //
        // 刻意**不在 worker 一创建时就跟**：激活阶段已有 `ACTIVATE_TIMEOUT_MS`
        // 与 `activate-progress` 滑动续期在管，两套超时并行会对
        // 「正在慢慢迁移数据 / 建表」的插件产生误杀。
        this.liveness.startTracking(pluginId);
        if (activationResolve) {
          activationResolve();
          activationResolve = null;
          activationReject = null;
        }
      } else if (typed.type === 'activate-progress') {
        // Sliding timeout: each progress heartbeat extends the wait window.
        // Keeps long migrate/IPC sequences alive without unbounded hangs.
        if (!activationTimedOut && activationReject) {
          const stage = typed.stage || typed.message || 'progress';
          console.log(
            `[WorkerManager] activate-progress for "${pluginId}": ${stage} ` +
              `(+${ACTIVATE_PROGRESS_SLIDE_MS}ms window)`,
          );
          armActivationTimer(ACTIVATE_PROGRESS_SLIDE_MS, `progress:${stage}`);
        }
      } else if (typed.type === 'error') {
        clearActivationTimer();
        cleanupActivationWorkerListeners();
        if (activationReject) {
          const errMsg = (msg as any).stack
            ? `${(msg as any).message}\n${(msg as any).stack}`
            : ((msg as any).message ?? 'Unknown error');
          activationReject(new WorkerActivateError(pluginId, errMsg));
          activationResolve = null;
          activationReject = null;
        } else {
          console.error(`[WorkerRuntime] Unhandled error from worker "${pluginId}":`, msg);
        }
      }

      // 总是路由到 serviceHost，以处理其它 RPC/事件消息（激活期间的 db/commandBus IPC）
      serviceHost.handleMessage(msg, transport);
    });

    // 9. 发送 activate 消息
    transport.postMessage({
      type: 'activate',
      pluginCode: sourceCode,
      manifest,
      serviceTokens,
      prevState,
    });

    // 10. 等待 'activated'（初始窗口 ACTIVATE_TIMEOUT_MS；progress 心跳滑动续期）
    try {
      await new Promise<void>((resolve, reject) => {
        activationResolve = resolve;
        activationReject = reject;
        armActivationTimer(ACTIVATE_TIMEOUT_MS, 'initial');
      });
    } catch (err) {
      clearActivationTimer();
      cleanupActivationWorkerListeners();
      // 激活失败 — 清理 Worker
      try {
        await serviceHost.dispose();
      } catch {}
      try {
        // strict: process 隔离模式下 worker 未创建（childProcess 路径），走 isolate 终止；thread 模式保持原路径
        if (worker) {
          await worker.terminate();
        } else {
          await isolate.terminate();
        }
      } catch {
        // 静默
      }
      this.registry.cleanup(pluginId);
      throw err;
    } finally {
      clearActivationTimer();
      cleanupActivationWorkerListeners();
    }

    // 11. 返回
    return { transport, serviceHost };
  }

  /**
   * 终止指定插件的 Worker 线程。
   *
   * 委托给 WorkerRegistry.terminate()。
   *
   * @param pluginId - 插件标识符
   */
  async terminateWorker(pluginId: string): Promise<any> {
    // 停止探活（L-1 P0）：必须与取消看门狗定时器同批做，
    // 否则会给已终止的插件继续发 ping，而它已不在 registry.list() 里，下轮自然被跳过 ——
    // 但 pendingPing / lastSeen 会一直留在 Map 里（内存泄漏），且重启后的新实例
    // 会继承旧的时间戳而立刻被判卡死。
    this.liveness.stopTracking(pluginId);

    // 即使 workers map 中已无该插件（如已崩溃并 cleanup），也必须取消待执行的重启定时器，
    // 否则会给已停用/已卸载的插件「复活」（审计 C-6）。
    this.registry.cancelWatchdog(pluginId);
    const instance = this.registry.get(pluginId);
    if (instance) {
      await instance.serviceHost.dispose();
    }
    return await this.registry.terminate(pluginId);
  }

  /**
   * 中止所有活跃 Worker 线程（有序关闭）。
   *
   * 遍历 WorkerRegistry 中当前活跃的 Worker，逐个调用 terminate() 释放线程资源。
   * 供 PluginRuntimeComposition 在平台停机阶段调用。
   */
  async shutdownAll(): Promise<void> {
    const ids = this.registry.list();
    await Promise.all(ids.map((id) => this.terminateWorker(id)));
  }

  /**
   * 从数据库恢复所有 worker-mode 的活跃插件。
   *
   * 查询 execution_mode = 'worker' 且 status = 'active' 的插件，
   * 为每个插件重新创建 Worker。
   * 单个插件恢复失败不影响其他插件（独立 try/catch）。
   */
  async restoreWorkers(): Promise<void> {
    const plugins = this.db
      .prepare(
        "SELECT id, manifest, file_path, source_code FROM plugins WHERE status = 'active' AND execution_mode = 'worker'",
      )
      .all() as Array<{
      id: string;
      manifest: string;
      file_path?: string;
      source_code: string;
    }>;

    for (const row of plugins) {
      try {
        const manifest: Manifest = JSON.parse(row.manifest);
        // 优先从文件系统读取，fallback 到 DB source_code
        const code =
          row.file_path && fs.existsSync(row.file_path) ? fs.readFileSync(row.file_path, 'utf-8') : row.source_code;
        await this.createWorker(row.id, manifest, code, ALL_SERVICE_TOKENS);
        console.log(`[WorkerManager] Restored worker for plugin "${manifest.id}" (${row.id})`);
      } catch (err) {
        console.error(`[WorkerManager] Failed to restore worker for plugin "${row.id}":`, err);
      }
    }
  }
}
