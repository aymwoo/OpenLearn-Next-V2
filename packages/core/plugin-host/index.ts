/**
 * PluginHost — 插件生命周期管理器。
 *
 * D-02: 构造函数接收 ServiceRegistry + EsmLoader + Database
 * D-03: 7 状态 PluginState 枚举 + VALID_TRANSITIONS 查找表
 *
 * 完整生命周期方法（Plan 03）：
 * - installPlugin(sourceCode) — 安装插件到 DB
 * - activatePlugin(pluginId) — 激活插件（含超时 + 回滚）
 * - deactivatePlugin(pluginId) — 停用插件（含超时 + 强制清理）
 * - uninstallPlugin(pluginId) — 卸载并删除
 * - installPluginFromZip(zipBuffer) — ZIP 插件包安装
 * - restoreActivePlugins() — 从 DB 恢复 active 插件
 */

import { v7 as uuidv7 } from 'uuid';
import type { Database } from 'better-sqlite3';
import fs from 'fs';
import JSZip from 'jszip';
import path from 'path';
import { pathToFileURL } from 'node:url';
import { ServiceRegistry } from '../di/service-registry.js';
import { EsmLoader } from '../esm-loader/esm-loader.js';
import type { PluginModule } from '../esm-loader/esm-loader.js';
import { EsmLoadTimeoutError, EsmActivationError } from '../esm-loader/errors.js';
import { manifestSchema } from '../esm-loader/manifest-schema.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import { validateAndBundleZip } from '../esm-loader/install-utils.js';
import { ResourceTracker } from './resource-tracker.js';
import { buildContext } from './context-builder.js';
import { ContributionRegistry } from './contribution-registry.js';
import type { ContributionSummary } from './contribution-registry.js';
import { ConfigService } from './config-service.js';
import { checkMissingDeps, topologicalSort, buildDepGraph } from './dependency-resolver.js';
import semver from 'semver';
import { parseRequiresEntry } from '../esm-loader/manifest-utils.js';
import { compose } from './middleware.js';
import { PluginState } from './types.js';
import type { PluginContext, PluginInfo, LifecyclePhase, Middleware, MiddlewareContext } from './types.js';
import {
  IllegalStateTransitionError,
  PluginActivateError,
  PluginDeactivateTimeoutError,
  SemverMismatchError,
  HotReloadError,
  HotReloadActivationError,
} from './errors.js';
import { ICapabilityServiceToken, IEventBusServiceToken } from '../di/interfaces.js';
import type { ICapabilityService, IEventBusService } from '../di/interfaces.js';
import { WorkerManager } from '../worker-runtime/worker-manager.js';
import type { IWorkerTransport } from '../worker-runtime/types.js';
import type { ServiceHost } from '../worker-runtime/service-host.js';

// ── VALID_TRANSITIONS ──────────────────────────────────────────────────────

/**
 * 插件状态机合法转换表（D-03）。
 *
 * 来源：04-RESEARCH.md lines 326-334
 */
const VALID_TRANSITIONS: Record<PluginState, PluginState[]> = {
  [PluginState.INSTALLED]: [PluginState.ACTIVATING, PluginState.UNINSTALLED],
  [PluginState.ACTIVATING]: [PluginState.ACTIVE, PluginState.ERROR],
  [PluginState.ACTIVE]: [PluginState.DEACTIVATING],
  [PluginState.DEACTIVATING]: [PluginState.INACTIVE],
  [PluginState.INACTIVE]: [PluginState.ACTIVATING, PluginState.UNINSTALLED],
  [PluginState.ERROR]: [PluginState.ACTIVATING, PluginState.UNINSTALLED],
  [PluginState.UNINSTALLED]: [],
};

/**
 * 纯函数：验证插件状态转换是否合法。
 *
 * 从 PluginHost 的 validateTransition 提取，使其可独立测试。
 * 使用 VALID_TRANSITIONS 查找表，非法转换时抛出 IllegalStateTransitionError。
 *
 * @param currentState - 当前插件状态
 * @param nextState - 目标状态
 * @param pluginId - 插件标识符（用于错误消息）
 * @throws IllegalStateTransitionError 当转换不合法时
 */
export function validatePluginStateTransition(
  currentState: PluginState,
  nextState: PluginState,
  pluginId: string,
): void {
  const allowed = VALID_TRANSITIONS[currentState];
  if (!allowed?.includes(nextState)) {
    throw new IllegalStateTransitionError(pluginId, currentState, nextState);
  }
}

// ── Constants ──────────────────────────────────────────────────────────────

/** 激活/停用超时阈值（毫秒） */
const ACTIVATION_TIMEOUT_MS = 5000;
const DEACTIVATION_TIMEOUT_MS = 5000;

/** 平台版本号 — 用于 engines.openlearn 兼容性检查 */
export const OPENLEARN_VERSION = '2.5.0';

// ── PluginHost ─────────────────────────────────────────────────────────────

export class PluginHost {
  // D-03: 插件状态追踪
  private pluginStates = new Map<string, PluginState>();

  // D-07: 资源追踪器 — 按 pluginId 管理 Disposable 资源
  private resourceTracker = new ResourceTracker();

  // V3.0: 贡献注册表 — 声明式 UI 贡献点存储
  private contributionRegistry = new ContributionRegistry();

  // Phase 7: 中间件注册表 — 按生命周期阶段分组
  private middlewareRegistry = new Map<LifecyclePhase, Middleware[]>();

  // Preloaded plugins map for built-in plugins running in inline mode (Phase 8)
  private preloadedPlugins = new Map<
    string,
    {
      manifest: any;
      activate: (ctx: PluginContext) => Promise<void>;
      deactivate?: () => Promise<void>;
    }
  >();

  // 活跃插件实例引用（manifest + activate/deactivate 函数）
  private pluginInstances = new Map<
    string,
    {
      manifest: Manifest;
      activate: ((ctx: PluginContext) => Promise<void>) | undefined;
      deactivate?: (() => Promise<void>) | undefined;
      workerRef?: { transport: IWorkerTransport; serviceHost: ServiceHost };
    }
  >();

  /**
   * Register a preloaded built-in plugin directly into memory (Phase 8).
   */
  registerPreloadedPlugin(
    pluginId: string,
    plugin: { manifest: any; activate: (ctx: PluginContext) => Promise<void>; deactivate?: () => Promise<void> }
  ): void {
    this.preloadedPlugins.set(pluginId, plugin);
  }

  /**
   * D-02: 构造函数 — 接收 3 个核心依赖。
   *
   * @param serviceRegistry - DI 容器
   * @param esmLoader - ESM 动态加载器（Node.js / 浏览器实现）
   * @param db - SQLite 数据库实例
   */
  /** 插件文件系统存储目录 */
  private pluginsDir: string;

  constructor(
    private serviceRegistry: ServiceRegistry,
    private esmLoader: EsmLoader,
    private db: Database,
    pluginsDir?: string,
  ) {
    this.pluginsDir = pluginsDir ?? path.resolve(process.cwd(), 'plugins');
  }

  // ── 文件系统路径辅助方法 ──────────────────────────────────────────

  /** 获取插件的文件系统目录路径 */
  getPluginDir(pluginId: string): string {
    return path.join(this.pluginsDir, pluginId);
  }

  /** 获取插件入口 JS 文件路径 */
  getPluginFilePath(pluginId: string): string {
    return path.join(this.getPluginDir(pluginId), 'index.js');
  }

  /** 获取插件 manifest.json 文件路径 */
  getPluginManifestPath(pluginId: string): string {
    return path.join(this.getPluginDir(pluginId), 'manifest.json');
  }

  // ── Phase 5: WorkerManager wiring (circular dependency fix) ────────────

  private _workerManager: WorkerManager | null = null;

  /**
   * Set the WorkerManager instance (Phase 5).
   * Called by Kernel after both PluginHost and WorkerManager are constructed,
   * avoiding circular dependency between the two.
   */
  setWorkerManager(wm: WorkerManager): void {
    this._workerManager = wm;
  }

  /** Internal getter — throws if WorkerManager was not set. */
  private get workerManager(): WorkerManager {
    if (!this._workerManager) {
      throw new Error('[PluginHost] WorkerManager not set — call setWorkerManager before activating worker-mode plugins');
    }
    return this._workerManager;
  }

  // ── Phase 7: Middleware Registration ─────────────────────────────────────

  /**
   * Phase 7: 注册生命周期中间件。
   *
   * 中间件在下次 activate/deactivate 时生效，不影响已激活插件。
   * 按注册顺序执行（洋葱模型）。
   *
   * @param phase - 挂载的生命周期阶段
   * @param middleware - 中间件函数
   */
  registerMiddleware(phase: LifecyclePhase, middleware: Middleware): void {
    const list = this.middlewareRegistry.get(phase);
    if (list) {
      list.push(middleware);
    } else {
      this.middlewareRegistry.set(phase, [middleware]);
    }
  }

  /**
   * 注销所有中间件（用于测试清理和热重载重置）。
   */
  clearMiddleware(): void {
    this.middlewareRegistry.clear();
  }

  /**
   * 获取指定阶段的中间件数组副本。
   */
  getMiddleware(phase: LifecyclePhase): Middleware[] {
    return [...(this.middlewareRegistry.get(phase) ?? [])];
  }

  /**
   * Read execution_mode from DB (added in Phase 5 for Worker isolation).
   * Returns 'inline' as default for backward compatibility.
   */
  private getExecutionMode(pluginId: string): string {
    try {
      const row = this.db.prepare('SELECT execution_mode FROM plugins WHERE id = ?')
        .get(pluginId) as { execution_mode: string } | undefined;
      return row?.execution_mode ?? 'inline';
    } catch {
      // Column may not exist yet in test databases — fall back to 'inline'
      return 'inline';
    }
  }

  // ── Phase 6: SemVer compatibility check ─────────────────────────────────

  /**
   * Phase 6: 检查 manifest 中声明的 Token 版本兼容性。
   *
   * 供 installPlugin() 和 activatePlugin() 双重调用。
   *
   * - manifest.requires 中 Token 版本不兼容 -> 抛出 SemverMismatchError
   * - manifest.optional 中 Token 版本不兼容 -> console.warn + 收集到返回 Set
   * - 未注册的 Token -> 视为不兼容（requires 抛错，optional 收集到 Set）
   *
   * @returns Set<string> — 不兼容的 optional 依赖 tokenName 集合。
   *   激活时调用方将此集合传给 buildContext() 以设置 ctx.services[key] = null。
   *   安装时调用方可忽略返回值。
   * @param manifest - 插件 manifest（已通过 manifestSchema.parse）
   * @param pluginId - 插件 DB id
   * @param phase - 检查阶段标识（'install' 或 'activate'），仅用于日志
   */

  /**
   * V3.0: 检查插件的 pluginDependencies 是否全部已安装且处于 ACTIVE 状态。
   *
   * 返回 null 表示所有依赖满足；返回错误消息字符串表示依赖缺失或不可用。
   * 遵循 VS Code 模型：仅 ID 匹配，无版本范围约束。
   */
  private checkPluginDependencies(manifest: Manifest): string | null {
    const deps = manifest.pluginDependencies;
    if (!deps || deps.length === 0) return null;

    const activePluginIds = new Set<string>();
    for (const [id, state] of this.pluginStates) {
      if (state === PluginState.ACTIVE) {
        // Resolve to manifest.id
        const row = this.db
          .prepare('SELECT manifest FROM plugins WHERE id = ?')
          .get(id) as { manifest: string } | undefined;
        if (row) {
          try {
            const m = JSON.parse(row.manifest);
            activePluginIds.add(m.id ?? id);
          } catch {
            activePluginIds.add(id);
          }
        }
      }
    }

    const missing: string[] = [];
    for (const dep of deps) {
      if (!activePluginIds.has(dep)) {
        // Check if installed at all
        const allInstalled = new Set(this.listInstalledPluginIds());
        if (!allInstalled.has(dep)) {
          missing.push(`${dep} (not installed)`);
        } else {
          missing.push(`${dep} (installed but not active)`);
        }
      }
    }

    if (missing.length > 0) {
      return `Plugin "${manifest.id}" requires: ${missing.join(', ')}`;
    }
    return null;
  }

  private checkSemVerCompatibility(
    manifest: { id?: string; name?: string; requires?: string[]; optional?: string[] },
    pluginId: string,
    phase: 'install' | 'activate',
  ): Set<string> {
    const pluginName = manifest.name ?? pluginId;
    const requiresList = manifest.requires ?? [];
    const optionalList = manifest.optional ?? [];
    const incompatibleOptionalTokens = new Set<string>();

    // -- Required dependencies -------------------------------------------------
    for (const req of requiresList) {
      const { tokenName, versionRange } = parseRequiresEntry(req);
      const actualVersion = this.serviceRegistry.getVersion(tokenName);

      if (!actualVersion) {
        throw new SemverMismatchError(
          pluginId, pluginName,
          tokenName, versionRange ?? '*', 'unregistered'
        );
      }

      if (!versionRange) continue; // No version range = accept any version

      try {
        if (!semver.satisfies(actualVersion, versionRange)) {
          throw new SemverMismatchError(
            pluginId, pluginName,
            tokenName, versionRange, actualVersion
          );
        }
      } catch (semverErr) {
        if (semverErr instanceof SemverMismatchError) throw semverErr;
        // Invalid version range string — wrap in SemverMismatchError
        throw new SemverMismatchError(
          pluginId, pluginName,
          tokenName, versionRange, actualVersion
        );
      }
    }

    // -- Optional dependencies (D-12: collect, don't throw) --------------------
    for (const opt of optionalList) {
      const { tokenName, versionRange } = parseRequiresEntry(opt);
      const actualVersion = this.serviceRegistry.getVersion(tokenName);

      if (!actualVersion || (versionRange && !semver.satisfies(actualVersion, versionRange))) {
        console.warn(
          `[PluginHost] Optional dependency ${tokenName}${versionRange ? '@' + versionRange : ''} not satisfied ` +
          `(host: ${actualVersion ?? 'unregistered'}) — skipping injection for plugin "${pluginId}" (${phase})`
        );
        incompatibleOptionalTokens.add(tokenName);
        continue;
      }
    }

    return incompatibleOptionalTokens;
  }

  // ── 状态机 ──────────────────────────────────────────────────────────────

  /**
   * 验证插件状态转换的合法性（D-03）。
   *
   * 使用 VALID_TRANSITIONS 查找表，非法转换时抛出 IllegalStateTransitionError。
   *
   * @param pluginId - 插件标识符
   * @param currentState - 当前状态
   * @param nextState - 目标状态
   * @throws IllegalStateTransitionError 当转换不合法时
   */
  private validateTransition(
    pluginId: string,
    currentState: PluginState,
    nextState: PluginState,
  ): void {
    validatePluginStateTransition(currentState, nextState, pluginId);
  }

  // ── 内省方法 ────────────────────────────────────────────────────────────

  /**
   * 查询数据库中所有已安装的插件，返回基本信息列表。
   *
   * 返回 id、name、version（从 JSON 解析的 manifest 中提取）、状态。
   * 若 DB 中无记录，返回空数组。
   */
  listPlugins(): PluginInfo[] {
    const rows = this.db
      .prepare('SELECT id, manifest, execution_mode, status, loader_version, created_at FROM plugins')
      .all() as Array<{ id: string; manifest: string; execution_mode: string; status: string; loader_version: string; created_at: number }>;

    return rows.map((row) => {
      let parsed: { name?: string; version?: string } = {};
      try {
        parsed = JSON.parse(row.manifest);
      } catch {
        // 解析失败时使用默认值
      }

      const state = this.pluginStates.get(row.id) ?? PluginState.INSTALLED;
      return {
        id: row.id,
        name: parsed.name ?? row.id,
        version: parsed.version ?? 'unknown',
        state,
        status: state === PluginState.ACTIVE ? 'active' : 'disabled',
        execution_mode: row.loader_version === 'vm' ? 'legacy' : 'esm',
        manifest: row.manifest,
        created_at: row.created_at,
      };
    });
  }

  /**
   * 获取插件的当前状态。
   *
   * 若插件未被追踪，返回 undefined。
   */
  getPluginState(pluginId: string): PluginState | undefined {
    pluginId = this.resolvePluginUuid(pluginId);
    return this.pluginStates.get(pluginId);
  }

  /**
   * V3.0: 查询插件声明的贡献点摘要。
   *
   * 无需激活插件即可枚举。用于管理后台预览插件将添加哪些 UI 元素。
   * 若未指定 pluginId，返回所有插件的贡献摘要。
   */
  listContributions(pluginId?: string): ContributionSummary[] | Array<{ pluginId: string; contributions: ContributionSummary[] }> {
    if (pluginId) {
      const resolved = this.resolvePluginUuid(pluginId);
      return this.contributionRegistry.summary(resolved);
    }
    return this.contributionRegistry.allSummaries();
  }

  /**
   * 返回所有已安装插件的 manifest.id 列表。
   * V3.0: 用于插件依赖解析。
   */
  listInstalledPluginIds(): string[] {
    const rows = this.db
      .prepare('SELECT manifest FROM plugins')
      .all() as Array<{ manifest: string }>;
    return rows.map((row) => {
      try {
        const m = JSON.parse(row.manifest);
        return m.id as string;
      } catch {
        return '';
      }
    }).filter(Boolean);
  }

  /**
   * V3.1: 读取插件的配置值（供 REST API 使用）。
   * 创建临时 ConfigService 实例加载 schema + DB 值，不保持内存引用。
   */
  getPluginConfig(pluginId: string, manifest?: Record<string, any>): Record<string, unknown> {
    let m = manifest;
    if (!m) {
      const row = this.db
        .prepare('SELECT manifest FROM plugins WHERE id = ?')
        .get(pluginId) as { manifest: string } | undefined;
      if (!row) return {};
      m = JSON.parse(row.manifest);
    }
    const svc = new ConfigService(this.db, m as any);
    svc.loadFromDB();
    return svc.getAll();
  }

  /**
   * V3.1: 更新插件的配置值（供 REST API 使用）。
   * 逐个调用 set()，schema 校验由 ConfigService 内部完成。
   */
  setPluginConfig(pluginId: string, manifest: Record<string, any>, updates: Record<string, unknown>): void {
    const svc = new ConfigService(this.db, manifest as any);
    svc.loadFromDB();
    for (const [key, value] of Object.entries(updates)) {
      svc.setSync(key, value);
    }
  }

  // ── 私有辅助方法 ────────────────────────────────────────────────────────

  /**
   * 将插件的标识符（可以是数据库 UUID 也可以是 manifest.id 别名）解析为数据库真实 UUID。
   * 优先直接匹配 DB 主键（O(1)），其次通过 SQLite json_extract 直接查询 manifest.id 列（O(1) 索引友好）。
   */
  /** @public 将插件标识符（DB UUID 或 manifest.id 别名）解析为数据库真实 UUID。供外部命令处理器使用。 */
  resolvePluginUuid(idOrManifestId: string): string {
    try {
      // 1. 优先：直接作为 DB 主键查找（最常见路径）
      const byId = this.db
        .prepare('SELECT id FROM plugins WHERE id = ?')
        .get(idOrManifestId) as { id: string } | undefined;
      if (byId) return byId.id;

      // 2. 回退：通过 SQLite json_extract 匹配 manifest.id 别名（无需全表 JSON 解析）
      const byManifestId = this.db
        .prepare("SELECT id FROM plugins WHERE json_extract(manifest, '$.id') = ?")
        .get(idOrManifestId) as { id: string } | undefined;
      if (byManifestId) return byManifestId.id;
    } catch {}

    // 3. 原样返回，让调用方自行处理"找不到"
    return idOrManifestId;
  }

  /**
   * 检查 manifest id 唯一性，防止重复注册。
   *
   * 直接迁移自 PluginRuntime lines 192-203，将 this.kernel.db 替换为 this.db。
   *
   * @param manifestId - 要检查的 manifest.id
   * @throws Error 如果 manifest id 已存在
   */
  private ensureUniqueManifestId(manifestId: string): void {
    const existing = this.db
      .prepare('SELECT id, manifest FROM plugins')
      .all() as Array<{ id: string; manifest: string }>;
    for (const plugin of existing) {
      try {
        const manifest = JSON.parse(plugin.manifest);
        if (manifest.id === manifestId) {
          throw new Error(`Plugin manifest id "${manifestId}" is already installed.`);
        }
      } catch (err: any) {
        if (err.message?.includes('already installed')) throw err;
      }
    }
  }

  /**
   * 从插件源代码中微加载提取 manifest。
   *
   * 用于 installPlugin 在 DB 插入前获取 manifest.id 进行唯一性检查。
   * 使用 EsmLoader.load() 加载源码，从模块导出中提取 manifest。
   *
   * @param sourceCode - 插件源代码
   * @returns 解析出的 manifest
   */
  private async extractManifest(sourceCode: string): Promise<Manifest> {
    const mod = await this.esmLoader.load(sourceCode);
    const plugin = mod.default ?? mod;
    const rawManifest = plugin.manifest ?? (mod as any).manifest;

    if (!rawManifest) {
      throw new Error('[PluginHost] Plugin source code has no manifest export');
    }

    // 内联安装补全默认值：main 字段在 ZIP 安装时必需，内联安装默认 index.js
    const withDefaults = {
      main: 'index.js',
      ...rawManifest,
    };

    return manifestSchema.parse(withDefaults);
  }

  // ── 生命周期方法 ────────────────────────────────────────────────────────

  /**
   * 安装插件到数据库。
   *
   * 方法 1: installPlugin(sourceCode: string): Promise<Manifest>
   *
   * 从 PluginRuntime lines 45-59 迁移，适配 PluginHost 架构：
   * - 先通过 EsmLoader 微加载提取 manifest
   * - 调用 ensureUniqueManifestId 检查唯一性
   * - 生成 uuidv7() 作为 pluginId
   * - INSERT 到 DB（loader_version = 'esm', status = 'installed'）
   * - 设置状态为 INSTALLED
   * - 失败时回滚 DB 条目和状态
   *
   * @param sourceCode - 插件源代码字符串
   * @returns 解析后的 manifest
   */
  async installPlugin(sourceCode: string): Promise<Manifest> {
    // 1. 微加载提取 manifest（用于唯一性检查和 name 字段）
    const rawManifest = await this.extractManifest(sourceCode);

    // 1a. 内联安装补充默认 main（manifest Schema 要求 main 字段）
    const manifest: Manifest = {
      ...rawManifest,
      main: rawManifest.main ?? 'index.js',
    };

    // 2. 唯一性检查
    this.ensureUniqueManifestId(manifest.id);

    // 2a. Phase 6: install-time SemVer pre-check
    this.checkSemVerCompatibility(manifest, '(pending)', 'install');
    // Return value discarded: no buildContext at install time

    // 2b. engines.openlearn 平台版本兼容性检查
    if (manifest.engines?.openlearn) {
      if (!semver.satisfies(OPENLEARN_VERSION, manifest.engines.openlearn)) {
        throw new Error(
          `[PluginHost] Plugin "${manifest.id}" requires OpenLearn ${manifest.engines.openlearn}, ` +
          `but host is running ${OPENLEARN_VERSION}.`,
        );
      }
    }

    // 2c. V3.0: 注册声明式贡献点（classroomTools → contributes 自动桥接）
    if (manifest.contributes) {
      this.contributionRegistry.register(manifest.id, manifest.contributes);
    } else if (manifest.classroomTools && manifest.classroomTools.length > 0) {
      this.contributionRegistry.registerClassroomTools(manifest.id, manifest.classroomTools as any);
    }

    // 2d. V3.0: 检查插件依赖是否已安装（仅警告，不阻止安装）
    if (manifest.pluginDependencies && manifest.pluginDependencies.length > 0) {
      const installedIds = new Set(this.listInstalledPluginIds());
      const missing = checkMissingDeps(manifest.pluginDependencies, installedIds);
      if (missing.length > 0) {
        console.warn(
          `[PluginHost] Plugin "${manifest.id}" depends on: ${missing.join(', ')}, ` +
          `which are not installed. The plugin will fail to activate until dependencies are satisfied.`,
        );
      }
    }

    // 3. 生成 pluginId
    const pluginId = uuidv7();
    const pluginDir = this.getPluginDir(pluginId);
    const filePath = this.getPluginFilePath(pluginId);
    const manifestPath = this.getPluginManifestPath(pluginId);

    try {
      // 4. 写入文件系统
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(filePath, sourceCode, 'utf-8');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      // 5. INSERT 到 DB（source_code 留空，源码已迁移到文件系统）
      const stmt = this.db.prepare(
        'INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      stmt.run(
        pluginId,
        manifest.name,
        JSON.stringify(manifest),
        '',
        filePath,
        'installed',
        Date.now(),
        'esm',
      );

      // 6. 设置状态为 INSTALLED
      this.pluginStates.set(pluginId, PluginState.INSTALLED);

      console.log(`[PluginHost] Plugin "${manifest.id}" installed to ${filePath} (${pluginId})`);
      return manifest;
    } catch (err) {
      // 回滚：删除 DB 条目 + 清理文件系统 + 状态
      try {
        this.db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
      } catch {
        // 静默清理
      }
      try {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      } catch {
        // 静默清理
      }
      this.pluginStates.delete(pluginId);
      throw err;
    }
  }

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
  async activatePlugin(pluginId: string, options?: { mode?: 'inline' | 'worker' }): Promise<void> {
    pluginId = this.resolvePluginUuid(pluginId);
    // Phase 5: Dual-mode activation — check if worker mode is requested
    const mode = options?.mode ?? this.getExecutionMode(pluginId) ?? 'inline';
    if (mode === 'worker') {
      return this.activateWorker(pluginId);
    }

    // 1. 获取当前状态并验证转换
    const currentState = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;
    this.validateTransition(pluginId, currentState, PluginState.ACTIVATING);

    // 2. 设置状态为 ACTIVATING
    this.pluginStates.set(pluginId, PluginState.ACTIVATING);

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

        const skipTokens = this.checkSemVerCompatibility(manifest, pluginId, 'activate');
        const ctx = await buildContext(
          this.serviceRegistry,
          this.resourceTracker,
          pluginId,
          manifest,
          this.db,
          skipTokens,
          this.contributionRegistry,
        );

        const capService = await this.serviceRegistry.resolve<ICapabilityService>(
          ICapabilityServiceToken,
        );
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

        this.pluginInstances.set(pluginId, { manifest, activate, deactivate });
        this.pluginStates.set(pluginId, PluginState.ACTIVE);

        this.db.prepare('UPDATE plugins SET status = ? WHERE id = ?').run('active', pluginId);
      } catch (err: any) {
        console.error('[PluginHost] Preloaded plugin activation error stack:', err.stack);
        this.pluginStates.set(pluginId, PluginState.ERROR);
        this.resourceTracker.disposeAll(pluginId);
        try {
          const capService = await this.serviceRegistry.resolve<ICapabilityService>(
            ICapabilityServiceToken,
          );
          await capService.revokeAll(actorId);
        } catch {
          // ignore
        }
        throw new EsmActivationError(pluginId, err.message);
      }
      return;
    }

    // 3. 从 DB 加载插件
    const row = this.db
      .prepare('SELECT file_path, source_code, manifest FROM plugins WHERE id = ?')
      .get(pluginId) as { file_path?: string; source_code: string; manifest: string } | undefined;
    if (!row) {
      this.pluginStates.set(pluginId, currentState); // 回滚状态
      throw new PluginActivateError(pluginId, 'plugin not found in database');
    }

    // 解析已存储的 manifest（用于 actorId 和能力撤销）
    let storedManifest: Manifest;
    try {
      storedManifest = JSON.parse(row.manifest);
    } catch {
      this.pluginStates.set(pluginId, currentState);
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
        this.pluginStates.set(pluginId, PluginState.ERROR);
        throw new PluginActivateError(pluginId, depCheck);
      }

      // 6a. Phase 6: Token version compatibility check (D-05, D-12)
      const skipTokens = this.checkSemVerCompatibility(mergedManifest, pluginId, 'activate');

      // 7. 构建安全的 PluginContext — skipTokens 中指定的可选服务 key 将被设为 null（D-12）
      const ctx = await buildContext(
        this.serviceRegistry,
        this.resourceTracker,
        pluginId,
        mergedManifest,
        this.db,
        skipTokens,  // NEW: Phase 6 — incompatible optional token names
        this.contributionRegistry,
      );

      // 8. 授予能力（T-04-19: 仅授予 manifest.capabilitiesProposed 中声明的能力）
      try {
        const capService = await this.serviceRegistry.resolve<ICapabilityService>(
          ICapabilityServiceToken,
        );
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
        this.pluginStates.set(pluginId, PluginState.ACTIVE);
        this.pluginInstances.set(pluginId, {
          manifest: mergedManifest,
          activate,
          deactivate: typeof deactivate === 'function' ? deactivate : undefined,
        });
        this.db
          .prepare('UPDATE plugins SET status = ? WHERE id = ?')
          .run('active', pluginId);

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
      this.pluginStates.set(pluginId, PluginState.ERROR);
      this.resourceTracker.disposeAll(pluginId);
      this.pluginInstances.delete(pluginId);

      // 撤销能力（T-04-19: 即使激活失败也撤销）
      try {
        const capService = await this.serviceRegistry.resolve<ICapabilityService>(
          ICapabilityServiceToken,
        );
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
  private async activateWorker(pluginId: string): Promise<void> {
    const currentState = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;
    this.validateTransition(pluginId, currentState, PluginState.ACTIVATING);
    this.pluginStates.set(pluginId, PluginState.ACTIVATING);

    const row = this.db
      .prepare('SELECT file_path, source_code, manifest FROM plugins WHERE id = ?')
      .get(pluginId) as { file_path?: string; source_code: string; manifest: string } | undefined;
    if (!row) {
      this.pluginStates.set(pluginId, currentState);
      throw new PluginActivateError(pluginId, 'plugin not found in database');
    }

    // 读取源码 — 优先文件系统，fallback DB
    const sourceCode: string = (row.file_path && fs.existsSync(row.file_path))
      ? fs.readFileSync(row.file_path, 'utf-8')
      : row.source_code;

    const manifest: Manifest = JSON.parse(row.manifest);
    const actorId = `plugin:${manifest.id}`;

    try {
      // Grant capabilities (same as inline mode activation)
      const capService = await this.serviceRegistry.resolve<ICapabilityService>(
        ICapabilityServiceToken,
      );
      const caps = manifest.capabilitiesProposed ?? [];
      for (const cap of caps) {
        await capService.grant(actorId, cap);
      }

      // Resolve EventBus for event forwarding to Worker
      const eventBus = await this.serviceRegistry.resolve<IEventBusService>(
        IEventBusServiceToken,
      ) as unknown as import('../event-bus/index.js').EventBus;

      const { transport, serviceHost } = await this.workerManager.createWorker(
        pluginId,
        manifest,
        sourceCode,
        (await import('../worker-runtime/worker-manager.js')).ALL_SERVICE_TOKENS,
        eventBus,
        this.getPluginDir(pluginId),
      );

      this.pluginStates.set(pluginId, PluginState.ACTIVE);
      this.pluginInstances.set(pluginId, {
        manifest,
        activate: undefined,
        deactivate: undefined,
        workerRef: { transport, serviceHost },
      });
      this.db
        .prepare('UPDATE plugins SET status = ? WHERE id = ?')
        .run('active', pluginId);
      console.log(
        `[PluginHost] Plugin "${manifest.id}" activated in WORKER mode (${pluginId})`,
      );
    } catch (err) {
      this.pluginStates.set(pluginId, PluginState.ERROR);
      this.resourceTracker.disposeAll(pluginId);
      this.pluginInstances.delete(pluginId);
      try {
        const capService = await this.serviceRegistry.resolve<ICapabilityService>(
          ICapabilityServiceToken,
        );
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
    // 1. 获取当前状态 — UNINSTALLED、未找到、或非 ACTIVE 状态时静默返回
    const currentState = this.pluginStates.get(pluginId);
    if (!currentState || currentState === PluginState.UNINSTALLED || currentState !== PluginState.ACTIVE) {
      return;
    }

    // 2. 验证状态转换
    this.validateTransition(pluginId, currentState, PluginState.DEACTIVATING);

    // 3. 设置状态为 DEACTIVATING
    this.pluginStates.set(pluginId, PluginState.DEACTIVATING);

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
          this.pluginStates.set(pluginId, PluginState.INACTIVE);
          this.pluginInstances.delete(pluginId);

          // 热重载注销
          if (this._hotReloadController) {
            this._hotReloadController.unregisterPlugin(pluginId);
          }

          // DB UPDATE
          this.db
            .prepare('UPDATE plugins SET status = ? WHERE id = ?')
            .run('inactive', pluginId);

          // 撤销能力（T-04-20: finally 中强制撤销）
          if (actorId) {
            try {
              const capService = await this.serviceRegistry.resolve<ICapabilityService>(
                ICapabilityServiceToken,
              );
              await capService.revokeAll(actorId);
            } catch (capErr) {
              console.error(
                `[PluginHost] Failed to revoke capabilities for "${pluginId}":`,
                capErr,
              );
            }
          }
        }

        console.log(`[PluginHost] Plugin "${pluginId}" deactivated`);
      });
    } catch (pipelineErr) {
      console.warn(`[PluginHost] Onion deactivation pipeline crashed for "${pluginId}", executing safety fallback:`, pipelineErr);
      this.resourceTracker.disposeAll(pluginId);
      this.pluginStates.set(pluginId, PluginState.INACTIVE);
      this.pluginInstances.delete(pluginId);
      this.db
        .prepare('UPDATE plugins SET status = ? WHERE id = ?')
        .run('inactive', pluginId);
      if (actorId) {
        try {
          const capService = await this.serviceRegistry.resolve<ICapabilityService>(
            ICapabilityServiceToken,
          );
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
  private async deactivateWorker(pluginId: string): Promise<void> {
    const currentState = this.pluginStates.get(pluginId);
    if (!currentState || currentState === PluginState.UNINSTALLED) return;
    if (currentState !== PluginState.ACTIVE && currentState !== PluginState.DEACTIVATING) return;

    if (currentState === PluginState.ACTIVE) {
      this.validateTransition(pluginId, currentState, PluginState.DEACTIVATING);
      this.pluginStates.set(pluginId, PluginState.DEACTIVATING);
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
      this.pluginStates.set(pluginId, PluginState.INACTIVE);
      this.pluginInstances.delete(pluginId);
      this.db
        .prepare('UPDATE plugins SET status = ? WHERE id = ?')
        .run('inactive', pluginId);

      if (actorId) {
        try {
          const capService = await this.serviceRegistry.resolve<ICapabilityService>(
            ICapabilityServiceToken,
          );
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
    const row = this.db.prepare('SELECT status FROM plugins WHERE id = ?').get(pluginId) as { status: string } | undefined;
    if (!row) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const currentState = this.getPluginState(pluginId);
    const newStatus = currentState === PluginState.ACTIVE ? 'disabled' : 'active';

    if (newStatus === 'disabled') {
      await this.deactivatePlugin(pluginId);
    } else {
      await this.activatePlugin(pluginId);
    }

    this.db.prepare('UPDATE plugins SET status = ? WHERE id = ?').run(newStatus, pluginId);
    return newStatus;
  }

  /**
   * 卸载插件。
   *
   * 方法 4: uninstallPlugin(pluginId: string): Promise<void>
   *
   * 流程：
   * 1. 如果 ACTIVE，先调用 deactivatePlugin()
   * 2. 验证状态转换 INACTIVE/ERROR/INSTALLED → UNINSTALLED
   * 3. 从 DB DELETE（plugins + plugin_storage）
   * 4. 清理内存状态
   *
   * @param pluginId - 插件标识符
   */
  async uninstallPlugin(pluginId: string): Promise<void> {
    pluginId = this.resolvePluginUuid(pluginId);
    const currentState = this.pluginStates.get(pluginId);

    // 1. 如果当前是 ACTIVE，先停用（deactivatePlugin 自动检测 worker/inline 模式）
    if (currentState === PluginState.ACTIVE) {
      // Phase 5: If worker-mode, ensure Worker is terminated before DB deletion
      const execMode = this.getExecutionMode(pluginId);
      if (execMode === 'worker') {
        await this.deactivateWorker(pluginId);
      } else {
        await this.deactivatePlugin(pluginId);
      }
    }

    // 2. 获取当前状态（可能已被 deactivatePlugin 修改）
    const state = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;

    // 验证状态转换
    this.validateTransition(pluginId, state, PluginState.UNINSTALLED);

    // 3. 查询 file_path 和 manifest（DELETE 之前必须获取）
    const row = this.db
      .prepare('SELECT manifest, file_path FROM plugins WHERE id = ?')
      .get(pluginId) as { manifest: string; file_path?: string } | undefined;
    const manifestId = (() => {
      if (!row) return pluginId;
      try {
        const m = JSON.parse(row.manifest);
        return m.id ?? pluginId;
      } catch {
        return pluginId;
      }
    })();
    const pluginDir = row?.file_path
      ? this.getPluginDir(pluginId)
      : null;

    // 4. 从 DB 删除
    this.db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
    this.db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ?').run(manifestId);

    // v5.1: 清理插件自建表
    const tablePrefix = `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, '_')}_`;
    try {
      const tables = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?`)
        .all(tablePrefix + '%') as { name: string }[];
      for (const t of tables) {
        this.db.exec(`DROP TABLE IF EXISTS ${t.name}`);
      }
      if (tables.length > 0) {
        console.log(`[PluginHost] Dropped ${tables.length} plugin tables for "${pluginId}"`);
      }
    } catch (e) {
      console.warn(`[PluginHost] Failed to drop plugin tables for "${pluginId}":`, e);
    }

    // 5. 清理文件系统
    if (pluginDir && fs.existsSync(pluginDir)) {
      try {
        fs.rmSync(pluginDir, { recursive: true, force: true });
        console.log(`[PluginHost] Removed plugin directory: ${pluginDir}`);
      } catch (e) {
        console.warn(`[PluginHost] Failed to remove plugin directory "${pluginDir}":`, e);
      }
    }

    // 6. 清理内存
    this.pluginStates.set(pluginId, PluginState.UNINSTALLED);
    this.pluginInstances.delete(pluginId);

    // 6a. V3.0: 清理贡献注册
    this.contributionRegistry.unregister(manifestId);

    console.log(`[PluginHost] Plugin "${pluginId}" uninstalled`);
  }

  /**
   * 从 ZIP Buffer 安装插件。
   *
   * 方法 5: installPluginFromZip(zipBuffer: Buffer): Promise<Manifest>
   *
   * 从 PluginRuntime lines 69-107 迁移，适配 PluginHost 架构：
   * - 调用 validateAndBundleZip() 进行 ZIP 验证和 esbuild 打包
   * - 生成 uuidv7() 作为 id
   * - 唯一性检查
   * - INSERT 到 DB（含 zip_package BLOB, loader_version='esm'）
   * - 设置状态为 INSTALLED
   * - 失败时清理 DB 条目
   *
   * 注意：与 PluginRuntime 不同，PluginHost 不在安装时自动激活 —
   * 调用方需显式调用 activatePlugin()。
   *
   * @param zipBuffer - ZIP 文件的原始字节
   * @returns manifest
   */
  async installPluginFromZip(zipBuffer: Buffer): Promise<Manifest> {
    if (!this.esmLoader) {
      throw new Error('Cannot install ZIP plugin: no esmLoader injected');
    }

    // 1. 验证并打包 ZIP
    const { manifest, bundledCode } = await validateAndBundleZip(zipBuffer);

    // 2. 唯一性检查
    this.ensureUniqueManifestId(manifest.id);

    // 2a. engines.openlearn 平台版本兼容性检查
    if (manifest.engines?.openlearn) {
      if (!semver.satisfies(OPENLEARN_VERSION, manifest.engines.openlearn)) {
        throw new Error(
          `[PluginHost] Plugin "${manifest.id}" requires OpenLearn ${manifest.engines.openlearn}, ` +
          `but host is running ${OPENLEARN_VERSION}.`,
        );
      }
    }

    // 2b. V3.0: 注册声明式贡献点（classroomTools → contributes 自动桥接）
    if (manifest.contributes) {
      this.contributionRegistry.register(manifest.id, manifest.contributes);
    } else if (manifest.classroomTools && manifest.classroomTools.length > 0) {
      this.contributionRegistry.registerClassroomTools(manifest.id, manifest.classroomTools as any);
    }

    // 2c. V3.0: 检查插件依赖（仅警告）
    if (manifest.pluginDependencies && manifest.pluginDependencies.length > 0) {
      const installedIds = new Set(this.listInstalledPluginIds());
      const missing = checkMissingDeps(manifest.pluginDependencies, installedIds);
      if (missing.length > 0) {
        console.warn(
          `[PluginHost] Plugin "${manifest.id}" depends on: ${missing.join(', ')}, ` +
          `which are not installed.`,
        );
      }
    }

    // 3. 生成 ID
    const pluginId = uuidv7();
    const pluginDir = this.getPluginDir(pluginId);
    const filePath = this.getPluginFilePath(pluginId);
    const manifestPath = this.getPluginManifestPath(pluginId);
    const zipFilePath = path.join(pluginDir, 'package.zip');

    try {
      // 4. 写入文件系统
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(filePath, bundledCode, 'utf-8');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(zipFilePath, zipBuffer);

      // Extract frontend.js if present in ZIP
      const zip = await JSZip.loadAsync(zipBuffer);
      const frontendFile = zip.file('frontend.js');
      if (frontendFile) {
        const frontendCode = await frontendFile.async('string');
        fs.writeFileSync(path.join(pluginDir, 'frontend.js'), frontendCode, 'utf-8');
      }

      // 4b. Auto-install declared dependencies if present
      if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
        console.log(`[PluginHost] Installing dependencies for plugin "${manifest.id}" in ${pluginDir}...`);
        try {
          const pkgJsonPath = path.join(pluginDir, 'package.json');
          const pkgJson = {
            name: manifest.id,
            version: manifest.version,
            dependencies: manifest.dependencies,
          };
          fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2), 'utf-8');

          const { execSync } = await import('node:child_process');
          execSync('npm install --production --no-audit --no-fund --legacy-peer-deps --registry=https://registry.npmmirror.com', {
            cwd: pluginDir,
            stdio: 'ignore',
          });
          console.log(`[PluginHost] Dependencies successfully installed for plugin "${manifest.id}"`);
        } catch (installErr) {
          console.error(`[PluginHost] Failed to install dependencies for plugin "${manifest.id}":`, installErr);
        }
      }

      // 5. INSERT 到 DB（源码和 ZIP 已迁移到文件系统，DB 仅存元数据）
      const stmt = this.db.prepare(
        'INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      stmt.run(
        pluginId,
        manifest.name,
        JSON.stringify(manifest),
        '',
        filePath,
        'installed',
        Date.now(),
        'esm',
        'worker',
      );

      // 6. 设置状态
      this.pluginStates.set(pluginId, PluginState.INSTALLED);

      console.log(`[PluginHost] Plugin "${manifest.id}" installed from ZIP to ${filePath} (${pluginId})`);
      return {
        ...manifest,
        pluginId,
      };
    } catch (err) {
      // 失败时清理 DB 条目 + 文件系统
      try {
        this.db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
      } catch {
        // 静默清理
      }
      try {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      } catch {
        // 静默清理
      }
      this.pluginStates.delete(pluginId);
      throw err;
    }
  }

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

    console.log(
      `[PluginHost] Restoring ${plugins.length} active ESM plugin(s) from database`,
    );

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
        const row = this.db
          .prepare('SELECT manifest FROM plugins WHERE id = ?')
          .get(p.id) as { manifest: string } | undefined;
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
      console.warn(`[PluginHost] Dependency cycles detected during restore:`,
        cycles.map((c) => c.join(' → ')).join(', '));
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

    // Activate sorted plugins first, then any remaining (blocked + cyclic) with best-effort
    const orderedIds = [...sorted];
    for (const b of blocked) orderedIds.push(b.pluginId);
    for (const cycle of cycles) orderedIds.push(...cycle);

    for (const id of orderedIds) {
      const resolvedId = this.resolvePluginUuid(id);
      const p = plugins.find((pl) => pl.id === resolvedId);
      if (!p) continue;

      const runtimeState = this.getPluginState(p.id);
      if (runtimeState === PluginState.ACTIVE) {
        continue;
      }

      try {
        const mode = (p.execution_mode ?? 'inline') as 'inline' | 'worker';
        await this.activatePlugin(p.id, { mode });
      } catch (err) {
        // D-10: 单个插件激活失败不影响其他插件
        console.error(
          `[PluginHost] Failed to restore plugin "${p.name ?? p.id}" (${p.id}):`,
          err,
        );
      }
    }

    console.log('[PluginHost] Plugin restoration complete');
  }

  // ── Phase 7: Hot Reload ──────────────────────────────────────────────────

  private _hotReloadController: import('./hot-reload.js').HotReloadController | null = null;

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
    const currentState = this.pluginStates.get(pluginId);

    // 1. 状态检查
    if (currentState !== PluginState.ACTIVE) {
      throw new IllegalStateTransitionError(
        pluginId,
        currentState ?? PluginState.UNINSTALLED,
        PluginState.ACTIVE,
      );
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
      throw new HotReloadActivationError(
        pluginId, filePath,
        err instanceof Error ? err : new Error(String(err)),
      );
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
        pluginId, manifest: newManifest, phase: 'beforeActivate', timestamp: Date.now(),
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
      // 激活失败 — 清理新注册的临时 disposables，restore old manifest
      this.resourceTracker.disposeAll(pluginId);
      throw new HotReloadActivationError(
        pluginId, filePath,
        err instanceof Error ? err : new Error(String(err)),
      );
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
    for (const d of oldDisposables) {
      try { d.dispose(); } catch (e) {
        console.error(`[PluginHost] Error disposing old resource for "${pluginId}":`, e);
      }
    }
    this.resourceTracker.reap(pluginId, oldDisposables);

    // 9. 替换实例引用
    this.pluginInstances.set(pluginId, newInstance);

    // 10. 更新 DB
    this.db.prepare(
      'UPDATE plugins SET source_code = ?, manifest = ?, updated_at = ? WHERE id = ?',
    ).run(newSourceCode, JSON.stringify(newManifest), Date.now(), pluginId);

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
      | { source_code: string }
      | undefined;
    const oldSourceCode = oldRow?.source_code ?? '';

    // 2. Terminate old worker
    let prevState: any = undefined;
    try {
      prevState = await this.workerManager.terminateWorker(pluginId);
    } catch {
      // Old worker may already be gone — continue
    }

    // 3. Create new worker with updated source
    try {
      await this.workerManager.createWorker(
        pluginId,
        _newManifest,
        newSourceCode,
        (await import('../worker-runtime/worker-manager.js')).ALL_SERVICE_TOKENS,
        undefined,
        this.getPluginDir(pluginId),
        prevState,
      );
      this.db.prepare(
        'UPDATE plugins SET source_code = ?, updated_at = ? WHERE id = ?',
      ).run(newSourceCode, Date.now(), pluginId);
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
      throw new HotReloadActivationError(
        pluginId, filePath,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}

// ── Re-exports ───────────────────────────────────────────────────────────────

export { SemverMismatchError } from './errors.js';
