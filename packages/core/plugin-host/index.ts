/**
 * PluginHost — 插件生命周期管理器。
 *
 * D-02: 构造函数接收 ServiceRegistry + EsmLoader + Database
 * D-03: 7 状态 PluginState 枚举 + VALID_TRANSITIONS 查找表
 *
 * Plans 03-04 将在此基础上构建完整的 activate/deactivate/install/uninstall 生命周期方法。
 * 本任务仅建立构造函数、状态机逻辑和内省方法。
 */

import type { Database } from 'better-sqlite3';
import { ServiceRegistry } from '../di/service-registry.js';
import { EsmLoader } from '../esm-loader/esm-loader.js';
import { ResourceTracker } from './resource-tracker.js';
import { buildContext } from './context-builder.js';
import { PluginState } from './types.js';
import type { PluginContext, PluginInfo, Manifest } from './types.js';
import { IllegalStateTransitionError } from './errors.js';

// ── VALID_TRANSITIONS ──────────────────────────────────────────────────────

/**
 * 插件状态机合法转换表（D-03）。
 *
 * 来源：04-RESEARCH.md lines 326-334
 */
const VALID_TRANSITIONS: Record<PluginState, PluginState[]> = {
  [PluginState.INSTALLED]: [PluginState.ACTIVATING],
  [PluginState.ACTIVATING]: [PluginState.ACTIVE, PluginState.ERROR],
  [PluginState.ACTIVE]: [PluginState.DEACTIVATING],
  [PluginState.DEACTIVATING]: [PluginState.INACTIVE],
  [PluginState.INACTIVE]: [PluginState.ACTIVATING, PluginState.UNINSTALLED],
  [PluginState.ERROR]: [PluginState.ACTIVATING, PluginState.UNINSTALLED],
  [PluginState.UNINSTALLED]: [],
};

// ── PluginHost ─────────────────────────────────────────────────────────────

export class PluginHost {
  // D-03: 插件状态追踪
  private pluginStates = new Map<string, PluginState>();

  // D-07: 资源追踪器 — 按 pluginId 管理 Disposable 资源
  private resourceTracker = new ResourceTracker();

  // 活跃插件实例引用（manifest + activate/deactivate 函数）
  private pluginInstances = new Map<
    string,
    { manifest: Manifest; activate: (ctx: PluginContext) => Promise<void>; deactivate?: () => Promise<void> }
  >();

  /**
   * D-02: 构造函数 — 接收 3 个核心依赖。
   *
   * @param serviceRegistry - DI 容器
   * @param esmLoader - ESM 动态加载器（Node.js / 浏览器实现）
   * @param db - SQLite 数据库实例
   */
  constructor(
    private serviceRegistry: ServiceRegistry,
    private esmLoader: EsmLoader,
    private db: Database,
  ) {}

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
    const allowed = VALID_TRANSITIONS[currentState];
    if (!allowed?.includes(nextState)) {
      throw new IllegalStateTransitionError(pluginId, currentState, nextState);
    }
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
      .prepare('SELECT id, manifest FROM plugins')
      .all() as Array<{ id: string; manifest: string }>;

    return rows.map((row) => {
      let parsed: { name?: string; version?: string } = {};
      try {
        parsed = JSON.parse(row.manifest);
      } catch {
        // 解析失败时使用默认值
      }

      return {
        id: row.id,
        name: parsed.name ?? row.id,
        version: parsed.version ?? 'unknown',
        state: this.pluginStates.get(row.id) ?? PluginState.INSTALLED,
      };
    });
  }

  /**
   * 获取插件的当前状态。
   *
   * 若插件未被追踪，返回 undefined。
   */
  getPluginState(pluginId: string): PluginState | undefined {
    return this.pluginStates.get(pluginId);
  }
}
