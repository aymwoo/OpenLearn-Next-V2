/**
 * PluginHost · core 层（L-2 阶段 2）。
 *
 * `PluginHostCore` 继承 `PluginHostBase`。链序约束见 `base.ts` 的说明。
 */

import { PluginHostBase } from './base.js';
import { normalizeStaticRoute } from './static-route.js';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { EsmLoader } from '../esm-loader/esm-loader.js';
import { manifestSchema } from '../esm-loader/manifest-schema.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import { buildContext } from './context-builder.js';
import { ContributionRegistry } from './contribution-registry.js';
import type { ContributionSummary } from './contribution-registry.js';
import { ConfigService } from './config-service.js';
import { parseServiceRequirement, CrossPluginServiceCheck } from './dependency-resolver.js';
import semver from 'semver';
import { parseRequiresEntry } from '../esm-loader/manifest-utils.js';
import { PluginState } from './types.js';
import type { PluginContext, PluginInfo, LifecyclePhase, Middleware } from './types.js';
import { IllegalStateTransitionError, SemverMismatchError } from './errors.js';
import { IStageGuardServiceToken, IProcessServiceToken } from '../di/interfaces.js';
import type { IProcessService } from '../di/interfaces.js';
import { WorkerManager } from '../worker-runtime/worker-manager.js';
import {
  VALID_TRANSITIONS,
  createPluginStaticMiddleware,
  resolveHostSdkDir,
  validatePluginStateTransition,
} from './base.js';
import type { PluginHost } from './index.js';

export abstract class PluginHostCore extends PluginHostBase {
  /**
   * Register a preloaded built-in plugin directly into memory (Phase 8).
   */
  registerPreloadedPlugin(
    pluginId: string,
    plugin: { manifest: any; activate: (ctx: PluginContext) => Promise<void>; deactivate?: () => Promise<void> },
  ): void {
    this.preloadedPlugins.set(pluginId, plugin);
  }

  /**
   * 静态路由的**归一化形式**，用于冲突检测与保留前缀比对（G-4b）。
   *
   * ## 为什么必须归一化
   *
   * Express 把 `/foo` 与 `/foo/` 当成**同一个** mount point（先挂载者生效，
   * 后者静默遮蔽），但字符串比较认为它们不同。原先只做 `toLowerCase()`，
   * 于是两个插件分别声明 `/assets` 与 `/assets/` 时：
   *   · 冲突检测放行
   *   · Express 静默让先挂载的赢
   *   · 后挂载插件的静态资源**永远 404，且没有任何日志或报错**
   *
   * 这类故障的排查成本极高：现象是「资源 404」，病因在两个插件的 manifest 里。
   *
   * ## 归一化规则
   *
   *   1. 转小写 —— URL 路径大小写不敏感（与既有 toLowerCase 行为一致）
   *   2. 压缩重复斜杠 —— `//a` ≡ `/a`
   *   3. 去掉末尾斜杠 —— `/a/` ≡ `/a`；根路径 `/` 例外，保留
   *   4. 补前导斜杠 —— 使 `a/b` 与 `/a/b` 也等价
   *
   * 规则 1 沿用既有实现而非新引入：改动它会扩大影响面，而它本身不是缺陷。
   */
  /**
   * 归一化规则见 `static-route.ts`。
   *
   * 保留这个静态方法是为了不改四处调用点；实现委托给同模块的纯函数，
   * 好让测试能直接 import（`private static` 是测试够不着的）。
   */
  protected static normalizeStaticRoute(route: string): string {
    return normalizeStaticRoute(route);
  }

  setExpressApp(app: any): void {
    this.expressApp = app;
    // Restore static routes from installed plugins (survives server restart)
    const allPlugins = this.db.prepare('SELECT id, manifest, status FROM plugins').all() as Array<{
      id: string;
      manifest: string;
      status: string;
    }>;
    for (const p of allPlugins) {
      try {
        // 审计 D-3 / M-4：只为**活跃**插件挂载静态资源路由。
        //
        // 修复前对所有已安装插件（含 disabled / error / inactive）挂载，
        // 导致停用插件的静态资源仍可下载。
        //
        // 为什么在挂载时过滤、而不是在停用时摘除路由：
        //  1. `uninstallPlugin` 的摘除实现是遍历 `express._router.stack` 做 splice，
        //     只能命中一个 layer，而 `expressApp.use()` 挂载的是多层中间件；
        //  2. 本方法在**每次重启**都会重跑，任何运行时摘除都会被覆盖回去。
        // 在挂载时过滤则保证重启与运行时行为一致，且不依赖脆弱的 stack 手术。
        if (p.status !== 'active') continue;
        const m = JSON.parse(p.manifest);
        if (m.deploy?.staticRoute && m.deploy?.staticDir) {
          const pluginDir = this.getPluginDir(p.id);
          const absDir = path.join(pluginDir, m.deploy.staticDir);
          if (fs.existsSync(absDir)) {
            // 归一化 + 冲突检测（G-4b）。
            //
            // 恢复路径原先**两者都没做**：存原始路由，且完全不查冲突。
            // 后果是安装时检出（或未检出）的冲突在重启后被完全绕过 ——
            // 两个等价路由同时挂载，先到先得，另一方的资源永久 404 且无任何日志。
            const normalized = PluginHostCore.normalizeStaticRoute(m.deploy.staticRoute);
            let conflictWith: string | undefined;
            for (const [ownerId, existingRoute] of this._registeredRoutes.entries()) {
              if (ownerId !== m.id && PluginHostCore.normalizeStaticRoute(existingRoute) === normalized) {
                conflictWith = ownerId;
                break;
              }
            }
            if (conflictWith) {
              // 不抛错：重启路径不宜因一个插件的路由冲突而整体失败。
              // 但必须显式告警 —— 否则就是「静默遮蔽」，正是本项要消除的现象。
              console.error(
                `[PluginHost] Static route conflict on restore: "${m.deploy.staticRoute}" ` +
                  `(normalized: "${normalized}") for plugin "${m.id}" is already registered by ` +
                  `"${conflictWith}". 后者被遮蔽，其静态资源将 404。`,
              );
              continue;
            }
            this.expressApp.use(m.deploy.staticRoute, ...createPluginStaticMiddleware(absDir));
            this._registeredRoutes.set(m.id, normalized);
            console.log(`[PluginHost] Restored static route "${m.deploy.staticRoute}" for plugin "${m.id}"`);
          }
        }
      } catch {
        /* skip malformed */
      }
    }
  }

  setSocketIO(io: any): void {
    this._socketIO = io;
  }

  /**
   * P7-A2 Stage 2: 暴露声明式 UI 贡献点存储，供插件组合层接入。
   */
  public getContributionRegistry(): ContributionRegistry {
    return this.contributionRegistry;
  }

  protected emitProgress(manifestId: string, step: string, detail?: string) {
    if (this._socketIO) {
      this._socketIO.emit('plugin:install:progress', {
        pluginId: manifestId,
        step,
        detail: detail || '',
        timestamp: Date.now(),
      });
    }
  }

  // ── 文件系统路径辅助方法 ──────────────────────────────────────────

  /** 获取插件的文件系统目录路径 */
  getPluginDir(pluginId: string): string {
    return path.join(this.pluginsDir, pluginId);
  }

  /**
   * 本宿主实例实际使用的插件根目录。
   *
   * 供 `Kernel` 等调用方读取，避免它们各自重新推导 `cwd/plugins` ——
   * 那正是 H-1 残留缺陷的成因：`Kernel` 构造器支持注入 `pluginsDir`，
   * 但迁移函数绕过它、自己又算了一遍，测试的重定向因此失效。
   *
   * 读取宿主的真实值而不是复制推导逻辑，两个来源就不可能分叉。
   */
  getPluginsDir(): string {
    return this.pluginsDir;
  }

  /** 获取插件入口 JS 文件路径 */
  getPluginFilePath(pluginId: string): string {
    return path.join(this.getPluginDir(pluginId), 'index.js');
  }

  /** 获取插件 manifest.json 文件路径 */
  getPluginManifestPath(pluginId: string): string {
    return path.join(this.getPluginDir(pluginId), 'manifest.json');
  }

  /**
   * 确保宿主的 @openlearn/plugin-sdk 能被插件解析到。
   *
   * 插件 index.js 位于 `<pluginsDir>/<id>/`，Node 只从该文件所在目录向上查找
   * node_modules。宿主的 node_modules（npx 缓存、仓库目录等）通常不在其祖先链上，
   * 于是 external 的 `@openlearn/plugin-sdk` 会抛 ERR_MODULE_NOT_FOUND。
   * 这里在 `<pluginsDir>/node_modules/@openlearn/plugin-sdk` 建立指向宿主 SDK 的
   * 链接，使该目录下所有插件共享宿主的同一份 SDK。
   */
  protected ensureHostSdkResolution(): void {
    const linkPath = path.join(this.pluginsDir, 'node_modules', '@openlearn', 'plugin-sdk');
    if (fs.existsSync(linkPath)) return;
    const sdkDir = resolveHostSdkDir();
    if (!sdkDir) {
      console.warn('[PluginHost] 未能定位宿主的 @openlearn/plugin-sdk，插件加载可能因缺少运行时依赖而失败');
      return;
    }
    try {
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      // junction：Windows 下无需提权即可创建目录链接，POSIX 下等价为普通软链
      fs.symlinkSync(sdkDir, linkPath, 'junction');
      console.log(`[PluginHost] Linked host @openlearn/plugin-sdk: ${linkPath} -> ${sdkDir}`);
    } catch (err) {
      console.warn('[PluginHost] 建立 @openlearn/plugin-sdk 链接失败:', err);
    }
  }

  // ── V5.2: RESTful API Gateway Dispatcher ───────────────────────────────

  /**
   * 获取指定插件的 Manifest（支持已激活或 DB 中的插件）
   */
  getPluginManifest(pluginIdOrManifestId: string): Manifest | null {
    const resolvedId = this.resolvePluginUuid(pluginIdOrManifestId);
    const instance = this.pluginInstances.get(resolvedId) ?? this.pluginInstances.get(pluginIdOrManifestId);
    if (instance?.manifest) return instance.manifest;

    const preloaded = this.preloadedPlugins.get(resolvedId) ?? this.preloadedPlugins.get(pluginIdOrManifestId);
    if (preloaded?.manifest) return preloaded.manifest;

    try {
      const row = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(resolvedId) as
        { manifest: string } | undefined;
      if (row?.manifest) {
        return JSON.parse(row.manifest);
      }
    } catch {}
    return null;
  }

  // ── Phase 5: WorkerManager wiring (circular dependency fix) ────────────

  /**
   * Set the WorkerManager instance (Phase 5).
   * Called by Kernel after both PluginHost and WorkerManager are constructed,
   * avoiding circular dependency between the two.
   */
  setWorkerManager(wm: WorkerManager): void {
    this._workerManager = wm;
  }

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
  protected getExecutionMode(pluginId: string): string {
    try {
      const row = this.db.prepare('SELECT execution_mode FROM plugins WHERE id = ?').get(pluginId) as
        { execution_mode: string } | undefined;
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
  protected checkPluginDependencies(manifest: Manifest): string | null {
    const deps = manifest.pluginDependencies;
    if (!deps || deps.length === 0) return null;

    const activePluginIds = new Set<string>();
    for (const [id, state] of this.pluginStates) {
      if (state === PluginState.ACTIVE) {
        // Resolve to manifest.id
        const row = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(id) as
          { manifest: string } | undefined;
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

  /**
   * V3.2: 检查 manifest.requires 中的跨插件服务需求是否能在提供方 manifest.provides 中找到声明。
   *
   * 安装时调用（warn），激活时调用（block）。
   *
   * @returns 未满足的跨插件服务需求列表，空数组表示全部满足
   */
  protected checkCrossPluginServices(manifest: Manifest): CrossPluginServiceCheck | null {
    const reqs = manifest.requires;
    if (!reqs || reqs.length === 0) return null;

    const unsatisfied: Array<{ required: string; providerId: string }> = [];

    for (const req of reqs) {
      const parsed = parseServiceRequirement(req);
      if (!parsed) continue;

      const providerRow = this.db
        .prepare('SELECT id FROM plugins WHERE manifest LIKE ?')
        .get(`%"id":"${parsed.pluginId}"%`) as { id: string } | undefined;
      if (!providerRow) {
        unsatisfied.push({ required: req, providerId: parsed.pluginId });
        continue;
      }

      const mRow = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(providerRow.id) as
        { manifest: string } | undefined;
      if (!mRow) {
        unsatisfied.push({ required: req, providerId: parsed.pluginId });
        continue;
      }

      try {
        const providerManifest = JSON.parse(mRow.manifest);
        const provides: string[] = providerManifest.provides ?? [];
        if (!provides.includes(parsed.tokenName)) {
          unsatisfied.push({ required: req, providerId: parsed.pluginId });
        }
      } catch {
        unsatisfied.push({ required: req, providerId: parsed.pluginId });
      }
    }

    return unsatisfied.length > 0 ? { consumerId: manifest.id, unsatisfied } : null;
  }

  protected checkSemVerCompatibility(
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
        throw new SemverMismatchError(pluginId, pluginName, tokenName, versionRange ?? '*', 'unregistered');
      }

      if (!versionRange) continue; // No version range = accept any version

      try {
        if (!semver.satisfies(actualVersion, versionRange)) {
          throw new SemverMismatchError(pluginId, pluginName, tokenName, versionRange, actualVersion);
        }
      } catch (semverErr) {
        if (semverErr instanceof SemverMismatchError) throw semverErr;
        // Invalid version range string — wrap in SemverMismatchError
        throw new SemverMismatchError(pluginId, pluginName, tokenName, versionRange, actualVersion);
      }
    }

    // -- Optional dependencies (D-12: collect, don't throw) --------------------
    for (const opt of optionalList) {
      const { tokenName, versionRange } = parseRequiresEntry(opt);
      const actualVersion = this.serviceRegistry.getVersion(tokenName);

      if (!actualVersion || (versionRange && !semver.satisfies(actualVersion, versionRange))) {
        console.warn(
          `[PluginHost] Optional dependency ${tokenName}${versionRange ? '@' + versionRange : ''} not satisfied ` +
            `(host: ${actualVersion ?? 'unregistered'}) — skipping injection for plugin "${pluginId}" (${phase})`,
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
  protected validateTransition(pluginId: string, currentState: PluginState, nextState: PluginState): void {
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
      .all() as Array<{
      id: string;
      manifest: string;
      execution_mode: string;
      status: string;
      loader_version: string;
      created_at: number;
    }>;

    return rows.map((row) => {
      let parsed: { name?: string; version?: string } = {};
      try {
        parsed = JSON.parse(row.manifest);
      } catch {
        // 解析失败时使用默认值
      }

      // Prefer live state machine; fall back to DB status when not yet tracked in memory
      let state = this.pluginStates.get(row.id);
      if (!state) {
        if (row.status === 'active') state = PluginState.ACTIVE;
        else if (row.status === 'error') state = PluginState.ERROR;
        else if (row.status === 'disabled' || row.status === 'inactive') state = PluginState.INACTIVE;
        else state = PluginState.INSTALLED;
      }
      const pluginDir = this.getPluginDir(row.id);
      const has_frontend = fs.existsSync(path.join(pluginDir, 'frontend.js'));

      const status =
        state === PluginState.ACTIVE
          ? 'active'
          : state === PluginState.ERROR
            ? 'error'
            : state === PluginState.ACTIVATING
              ? 'activating'
              : 'disabled';

      return {
        id: row.id,
        name: parsed.name ?? row.id,
        version: parsed.version ?? 'unknown',
        state,
        status,
        execution_mode: row.loader_version === 'vm' ? 'legacy' : 'esm',
        manifest: row.manifest,
        created_at: row.created_at,
        has_frontend,
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
   *
   * ## 关于参数形态（H-2）
   *
   * 本方法的两种输入形态（DB UUID 与 manifest.id）**都必须支持**，因为调用方
   * 天然会有两种：HTTP 层拿到的多为 DB 主键，而依赖解析、命令行等内部路径
   * 手上只有 manifest.id。
   *
   * 之所以要显式做双向映射：`contributionRegistry` 的两级索引是以
   * **`manifest.id`** 为键的（见 `register()` 的 `@param pluginId`，以及
   * contribution-registry.ts 的两级 Map），而 `getByPlugin()` 是纯
   * `Map.get()`，**不做任何反向解析**。因此原实现两条路都错：
   *
   *   · 只传原样输入 → 传 UUID 时落空
   *   · 只传 `resolvePluginUuid()` 的结果 → 把 manifest.id 主动改成了 UUID，落空
   *
   * 后者尤其隐蔽：**唯一语义正确的输入反而被改成了查不到的形式**。
   * 而全仓唯一调用点（canary.step5）断言的是「卸载后为 0」，
   * 无论命中空集合还是查错键落空，结果都是 0 —— 该缺陷因此长期未被察觉。
   *
   * 这里对所有候选键取并集（而非「先试原样、落空再回退」）：不依赖查询顺序，
   * 也不在两个键恰好都注册过时产生歧义。并集按 slot 去重，
   * 语义稳定为「该插件的全部贡献」。
   */
  listContributions(
    pluginId?: string,
  ): ContributionSummary[] | Array<{ pluginId: string; contributions: ContributionSummary[] }> {
    if (pluginId) {
      // registry 的键是 manifest.id，入参可能是 UUID 或 manifest.id，两种都要覆盖
      const candidates = new Set<string>([pluginId]);

      const uuid = this.resolvePluginUuid(pluginId);
      if (uuid) candidates.add(uuid);

      // UUID → manifest.id 的反向解析：resolvePluginUuid 是单向的，缺这一步 UUID 入参永远查不到
      const manifestId = this.resolveManifestId(pluginId);
      if (manifestId) candidates.add(manifestId);

      const merged = new Map<string, ContributionSummary>();
      for (const key of candidates) {
        for (const summary of this.contributionRegistry.summary(key)) {
          // 按 slot 去重（候选集本身已去重，故不会重复计数）
          if (!merged.has(summary.slot)) merged.set(summary.slot, summary);
        }
      }
      return [...merged.values()];
    }
    return this.contributionRegistry.allSummaries();
  }

  /**
   * 返回所有已安装插件的 manifest.id 列表。
   * V3.0: 用于插件依赖解析。
   */
  listInstalledPluginIds(): string[] {
    const rows = this.db.prepare('SELECT manifest FROM plugins').all() as Array<{ manifest: string }>;
    return rows
      .map((row) => {
        try {
          const m = JSON.parse(row.manifest);
          return m.id as string;
        } catch {
          return '';
        }
      })
      .filter(Boolean);
  }

  /**
   * V3.1: 读取插件的配置值（供 REST API 使用）。
   * 创建临时 ConfigService 实例加载 schema + DB 值，不保持内存引用。
   */
  getPluginConfig(pluginId: string, manifest?: Record<string, any>): Record<string, unknown> {
    let m = manifest;
    if (!m) {
      const row = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(pluginId) as
        { manifest: string } | undefined;
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
      const byId = this.db.prepare('SELECT id FROM plugins WHERE id = ?').get(idOrManifestId) as
        { id: string } | undefined;
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
   * `resolvePluginUuid()` 的**反向**：把 DB 主键（或已是 manifest.id 的入参）解析为 manifest.id。
   *
   * ## 为什么需要它
   *
   * 宿主内部存在两套「插件标识符」命名空间，而两个方向的解析此前**只存在一个**：
   *
   * | 命名空间 | 典型值 | 谁在用 |
   * |---|---|---|
   * | DB 主键（UUID） | `11111111-…` | HTTP 路由参数、DB 行 |
   * | manifest.id（别名） | `ext-canary` | `contributionRegistry` 的索引键、依赖解析 |
   *
   * `resolvePluginUuid()` 只做了「别名 → UUID」。而 `contributionRegistry` 的键
   * 是 **manifest.id**，其 `getByPlugin()` 又是纯 `Map.get()`、不接受 UUID。
   * 于是「查 registry」必须有「UUID → 别名」这一步，此前**不存在** —— 这就是 H-2：
   * `listContributions()` 无论收到哪种输入都返回空。
   *
   * @param idOrManifestId - DB 主键或 manifest.id
   * @returns manifest.id；查不到时返回空串（调用方据此跳过，不污染候选键集合）
   */
  resolveManifestId(idOrManifestId: string): string {
    try {
      // 1. 优先按主键查（O(1)，最常见路径）
      const byId = this.db.prepare('SELECT manifest FROM plugins WHERE id = ?').get(idOrManifestId) as
        { manifest: string } | undefined;
      const fromPrimary = this.extractManifestId(byId?.manifest);
      if (fromPrimary) return fromPrimary;

      // 2. 回退：入参本身就是 manifest.id 别名
      const byAlias = this.db
        .prepare("SELECT manifest FROM plugins WHERE json_extract(manifest, '$.id') = ?")
        .get(idOrManifestId) as { manifest: string } | undefined;
      const fromAliasId = this.extractManifestId(byAlias?.manifest);
      if (fromAliasId) return fromAliasId;
    } catch {
      // 表不存在 / SQL 不可用 —— 一律按「查不到」处理，不向上抛
    }
    return '';
  }

  /** 从 plugins.manifest 的 JSON 文本里取 `id` 字段；缺失或非法 JSON 返回空串 */
  private extractManifestId(manifestJson: string | undefined): string {
    if (!manifestJson) return '';
    try {
      const id = (JSON.parse(manifestJson) as { id?: unknown }).id;
      return typeof id === 'string' ? id : '';
    } catch {
      return '';
    }
  }

  /**
   * 检查 manifest id 唯一性，防止重复注册。
   *
   * 直接迁移自 PluginRuntime lines 192-203，将 this.kernel.db 替换为 this.db。
   *
   * @param manifestId - 要检查的 manifest.id
   * @throws Error 如果 manifest id 已存在
   */
  protected ensureUniqueManifestId(manifestId: string): void {
    const existing = this.db.prepare('SELECT id, manifest FROM plugins').all() as Array<{
      id: string;
      manifest: string;
    }>;
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
  protected async extractManifest(sourceCode: string): Promise<Manifest> {
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
   * Look up an installed plugin by manifest.id (logical id).
   * Returns null when not installed.
   */
  findByManifestId(manifestId: string): {
    pluginId: string;
    manifest: Manifest;
    status: string;
    state: PluginState;
    name: string;
    version: string;
  } | null {
    const row = this.db
      .prepare("SELECT id, name, status, manifest FROM plugins WHERE json_extract(manifest, '$.id') = ?")
      .get(manifestId) as { id: string; name: string; status: string; manifest: string } | undefined;
    if (!row) return null;
    let parsed: Manifest;
    try {
      parsed = JSON.parse(row.manifest) as Manifest;
    } catch {
      return null;
    }
    const state = this.pluginStates.get(row.id) ?? PluginState.INSTALLED;
    return {
      pluginId: row.id,
      manifest: parsed,
      status: row.status,
      state,
      name: parsed.name ?? row.name,
      version: parsed.version ?? '0.0.0',
    };
  }

  protected isSystemPluginRecord(pluginId: string, manifestId?: string): boolean {
    if (pluginId.startsWith('@openlearn/') || this.preloadedPlugins.has(pluginId)) return true;
    if (manifestId?.startsWith('@openlearn/')) return true;
    return false;
  }

  /**
   * **插件状态的唯一写入点**（审计 H-4）。
   *
   * 修复前，`pluginStates`（内存）与 `plugins.status`（DB）由 16 处代码**各自独立**写入：
   * - 激活失败只写内存 `ERROR`，不写 DB（成功路径才写 `status='active'`）
   *   → 重启后 `restoreActivePlugins` 会重试一个已知失败的插件；
   * - worker-manager 熔断直接 `UPDATE plugins SET status='error'`，
   *   **不动** `pluginStates` → DB=error、内存=ACTIVE。
   *
   * 两个方向的分歧都会造成「重启前后行为不同」或「UI 与运行时不一致」。
   * 收敛到本方法后，任何状态变更都必须显式声明是否持久化，
   * 且两侧在同一函数内更新，物理上无法只改一边。
   *
   * @param pluginId 插件 id
   * @param state 目标状态
   * @param opts.persistDb 是否同步写入 DB（默认 false）。仅在状态确应跨重启存活时传 true
   */
  /**
   * 插件转入非活跃态时，注销其**声明式贡献**（审计 D-1 / D-2）。
   *
   * `contributionRegistry` 的键是 `manifest.id`（而非 DB 主键 pluginId），
   * 见 installPlugin 的 `register(manifest.id, manifest.contributes)`。
   * 之前只有 `uninstallPlugin` 会注销，停用时不清 → 服务端贡献摘要长期包含
   * 已停用插件的条目。
   *
   * 说明：这**不影响前端 UI** —— 前端扩展点由插件在 `activate()` 内自行注册、
   * 停用时由前端宿主 `unregisterPluginResources()` 清理，走的是另一条链路。
   * 这里清理的是服务端这份无人读取的死数据（审计 M-2 已更正其影响面）。
   */
  /**
   * 声明本插件对 ProcessManager 的所有权（B-5）。
   *
   * 必须在 buildContext 之前调用：归属通过 ProcessManager 的同步字段写入，
   * 顺序错了会把任务记到上一个插件名下。
   *
   * 失败不阻断激活 —— 归属声明只是 kill() 的归属校验依据，缺失时校验退化为
   * 「不拦截」（与修复前一致），不该让插件因它起不来。
   */
  protected async declareProcessOwnership(pluginId: string): Promise<void> {
    try {
      const pm = await this.serviceRegistry.resolve<IProcessService>(IProcessServiceToken);
      if (typeof pm?.setPluginOwner === 'function') pm.setPluginOwner(pluginId);
    } catch (e) {
      console.warn(`[PluginHost] Failed to declare process ownership for "${pluginId}":`, e);
    }
  }

  protected revokePluginContributions(pluginId: string): void {
    const manifestId = this.getPluginManifest(pluginId)?.id ?? pluginId;
    try {
      this.contributionRegistry.unregister(manifestId);
    } catch (e) {
      console.warn(`[PluginHost] Failed to unregister contributions for "${pluginId}":`, e);
    }
    void this.revokePluginStageGuards(pluginId, manifestId);
  }

  /**
   * 回收该插件注册的教学环节门禁守卫（I-3）。
   *
   * 守卫注册在**内核 DI 的 StageGuardPipeline 单例**里，进程级存活 ——
   * 插件停用/卸载时不清理，门禁会继续按已停用插件的规则判定。
   * 旧实现里守卫没有 owner 字段，插件只能按 id 全局删，会误伤同名的他人守卫；
   * I-3 给守卫加了 owner 后即可精确回收。
   *
   * 两侧 id 都试一遍：注册方可能传 pluginId（DB uuid）也可能传 manifestId，
   * 取决于插件作者用了哪个。
   */
  private async revokePluginStageGuards(pluginId: string, manifestId: string): Promise<void> {
    try {
      const pipeline = await this.serviceRegistry.resolve(IStageGuardServiceToken);
      if (!pipeline || typeof pipeline.unregisterByOwner !== 'function') return;
      let removed = 0;
      for (const owner of new Set([pluginId, manifestId])) {
        removed += pipeline.unregisterByOwner(owner) ?? 0;
      }
      if (removed > 0) {
        console.log(`[PluginHost] Revoked ${removed} stage guard(s) for plugin "${pluginId}"`);
      }
    } catch (e) {
      console.warn(`[PluginHost] Failed to revoke stage guards for "${pluginId}":`, e);
    }
  }

  protected setPluginState(pluginId: string, state: PluginState, opts: { persistDb?: boolean } = {}): void {
    this.pluginStates.set(pluginId, state);
    if (!opts.persistDb) return;

    // UNINSTALLED 走 DELETE 而非 status 更新（uninstallPlugin 会删行）
    if (state === PluginState.UNINSTALLED) return;

    // PluginState 值与 DB status 字符串一一对应（'installed'/'activating'/...）
    const statusMap: Partial<Record<PluginState, string>> = {
      [PluginState.INSTALLED]: 'installed',
      [PluginState.ACTIVATING]: 'installed',
      [PluginState.ACTIVE]: 'active',
      [PluginState.DEACTIVATING]: 'active',
      [PluginState.INACTIVE]: 'inactive',
      [PluginState.ERROR]: 'error',
    };
    const status = statusMap[state];
    if (!status) return;

    try {
      this.db.prepare('UPDATE plugins SET status = ? WHERE id = ?').run(status, pluginId);
    } catch (e) {
      // 测试库可能缺少 plugins 表；不因持久化失败而中断状态机
      console.warn(`[PluginHost] Failed to persist status "${status}" for "${pluginId}":`, e);
    }
  }
}
