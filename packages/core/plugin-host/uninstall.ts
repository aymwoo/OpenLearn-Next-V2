/**
 * PluginHost · uninstall 层（Issue #141）。
 *
 * `PluginHostUninstall` 继承 `PluginHostInstall`。链序约束见 `base.ts` 的说明。
 *
 * 为什么单独成层：卸载的数据语义（keep / purge、孤立数据登记、SQL 归档）
 * 与安装逻辑是两条独立演进路径；且 install.ts 已接近结构守卫生效的 1200 行，
 * 继续内联会让「拆分防膨胀」的断言失效，故把卸载整体抽为链尾新层。
 */

import fs from 'fs';
import path from 'path';
import { PluginHostInstall } from './install.js';
import { PluginState, normalizeExecutionMode, requiresIsolatedExecution } from './types.js';
import { isSafePluginTablePrefix, pluginTablePrefix, listAllowedPluginTablePrefixes } from './plugin-tables.js';
import { clearPublicRouteApprovals } from './public-routes.js';
import {
  deleteOrphanDataRecord,
  exportPluginDataToSql,
  hasOtherDataOwners,
  registerOrphanData,
  summarizePluginData,
  type PluginDataPolicy,
  type UninstallPluginOptions,
  type UninstallPluginResult,
} from './orphan-data.js';
import { recordSecurityAudit } from '../observability/audit-log.js';

export abstract class PluginHostUninstall extends PluginHostInstall {
  /**
   * 删除某个前缀下的插件私有表，返回删除数量。
   *
   * 表名来自 `sqlite_master` 且双重复核（前缀白名单 + 命名白名单），
   * 绝不接受外部传入的任意标识符。
   */
  private dropPluginTables(prefix: string): number {
    if (!isSafePluginTablePrefix(prefix)) return 0;
    try {
      const tables = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?`)
        .all(`${prefix}%`) as { name: string }[];
      let dropped = 0;
      for (const table of tables) {
        if (!table.name.startsWith(prefix) || !/^plugin_[A-Za-z0-9_]+$/.test(table.name)) continue;
        this.db.exec(`DROP TABLE IF EXISTS ${table.name}`);
        dropped += 1;
      }
      return dropped;
    } catch (error) {
      console.warn(`[PluginHost] Failed to drop plugin tables for prefix "${prefix}":`, error);
      return 0;
    }
  }

  /**
   * 插件数据归档目录。
   *
   * 与 `pluginsDir` 同级（`<data>/plugin-data-exports`），**刻意不放在**
   * `pluginsDir` 内部：`/plugins` 由 server.ts 静态挂载且只要求登录，
   * 插件数据归档（含学生数据）不能出现在该目录下。
   */
  protected getPluginDataExportDir(): string {
    return path.join(path.dirname(this.pluginsDir), 'plugin-data-exports');
  }

  /**
   * 卸载插件。
   *
   * 方法 4: uninstallPlugin(pluginId: string, options?): Promise<UninstallPluginResult>
   *
   * 数据语义（Issue #141）：卸载 ≠ 删数据。
   * - `dataPolicy: 'keep'`（默认）：插件表、`plugin_migrations` 版本记录与
   *   `plugin_storage` 键值**原样保留**，并登记为「孤立插件数据」；重装同
   *   `manifest.id` 时复用本插件安装 UUID，旧数据自动回到插件视野；
   * - `dataPolicy: 'purge'`（显式）：**先**导出 SQL 归档，导出失败即中止卸载
   *   （此刻数据、DB 行与文件都还完好），成功后再删表 / 迁移记录 / 存储键，并写审计。
   *
   * 授权状态（公开路由审批、能力授予、静态路由与内存资源）无论策略都照旧清除：
   * 它们是**授权**而非数据，重装后必须重新审批。
   *
   * 流程：
   * 1. 如果 ACTIVE，先调用 deactivatePlugin()
   * 2. 验证状态转换 INACTIVE/ERROR/INSTALLED → UNINSTALLED
   * 3. 从 DB DELETE plugins 行；数据按 dataPolicy 处理
   * 4. 清理内存状态
   *
   * @param pluginId - 插件标识符
   * @param options.dataPolicy - 'keep'（默认）| 'purge'
   * @param options.exportDir - purge 时归档目录；默认为数据目录下 `plugin-data-exports`
   * @param options.actorId - 审计日志中的操作者
   */
  async uninstallPlugin(pluginId: string, options: UninstallPluginOptions = {}): Promise<UninstallPluginResult> {
    const dataPolicy: PluginDataPolicy = options.dataPolicy ?? 'keep';
    if (dataPolicy !== 'keep' && dataPolicy !== 'purge') {
      throw new Error(`[PluginHost] Invalid dataPolicy "${String(options.dataPolicy)}" (expected "keep" | "purge")`);
    }

    pluginId = this.resolvePluginUuid(pluginId);
    if (this.isSystemPluginRecord(pluginId)) {
      throw new Error(`Cannot uninstall system plugin: ${pluginId}`);
    }

    // 等待在飞的生命周期操作结束（审计 H-2）。
    //
    // 修复前：下方只判断 `currentState === ACTIVE`，若插件此刻正在 ACTIVATING 就跳过停用、
    // 直接 DELETE DB 行，而在飞的 activate 随后完成 → **已删除的插件仍留在 commandBus 上**，
    // 其 handler 永久泄漏。典型触发：装完插件立刻点卸载。
    await this.waitForLifecycleIdle(pluginId);

    const currentState = this.pluginStates.get(pluginId);

    // 1. 如果当前是 ACTIVE，先停用（deactivatePlugin 自动检测 worker/inline 模式）
    if (currentState === PluginState.ACTIVE) {
      // Phase 5: If worker-mode, ensure Worker is terminated before DB deletion
      // 判据用 requiresIsolatedExecution（审计 F-1）：process 模式的卸载
      // 也必须走 deactivateWorker，否则子进程在 DB 行删除后仍在运行。
      const execMode = normalizeExecutionMode(this.getExecutionMode(pluginId));
      if (requiresIsolatedExecution(execMode)) {
        await this.deactivateWorker(pluginId);
      } else {
        await this.deactivatePlugin(pluginId);
      }
    }

    // 1b. 兜底资源回收：插件若非 ACTIVE 态（如 ERROR / INACTIVE / INSTALLED），
    // 上面的停用分支不会执行，其命令、事件订阅、定时器与路由可能仍然残留
    // （典型场景：activate 中途失败、reload 失败后直接卸载）。
    // disposeAll 幂等，对已回收过的插件为无操作，故无条件执行。
    this.resourceTracker.disposeAll(pluginId);

    // 2. 获取当前状态（可能已被 deactivatePlugin 修改）
    const state = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;

    // 3. 查询 file_path 和 manifest（DELETE 之前必须获取）
    const row = this.db.prepare('SELECT manifest, file_path FROM plugins WHERE id = ?').get(pluginId) as
      { manifest: string; file_path?: string } | undefined;

    const manifestId = (() => {
      if (!row) return pluginId;
      try {
        const m = JSON.parse(row.manifest);
        return m.id ?? pluginId;
      } catch {
        return pluginId;
      }
    })();

    // 幂等：已卸载且 DB 无残留记录时直接返回，避免 uninstalled → uninstalled 非法转换
    if (state === PluginState.UNINSTALLED && !row) {
      this.pluginStates.delete(pluginId);
      return {
        pluginId,
        manifestId,
        dataPolicy,
        keptTables: [],
        keptRows: 0,
        droppedTables: 0,
        orphanRegistered: false,
      };
    }

    // 验证状态转换（已处于 UNINSTALLED 但仍有残留记录时跳过校验，继续清理）
    if (state !== PluginState.UNINSTALLED) {
      this.validateTransition(pluginId, state, PluginState.UNINSTALLED);
    }
    const pluginDir = row?.file_path ? this.getPluginDir(pluginId) : null;

    // 建表与删表统一使用复合前缀；同时清掉该插件相关的历史合法前缀表：
    // pluginTablePrefix(pluginId) 与 pluginTablePrefix(manifestId)
    const otherPluginSharingManifest = this.db
      .prepare('SELECT id FROM plugins WHERE id != ? AND manifest LIKE ?')
      .get(pluginId, `%"id":"${manifestId}"%`);

    const prefixes = listAllowedPluginTablePrefixes(pluginId, manifestId, true);

    // 4a. 采集数据摘要：keep 用于登记，purge 用于判断是否需要归档
    const summary = summarizePluginData(this.db, prefixes, { pluginId, manifestId });

    // 4b. purge 策略：**先导出**。导出失败必须中止卸载 —— 此刻数据、DB 行、文件都完好，
    // 失败只是「这次没卸干净」，而不是「数据没了」。
    let exportFile: string | undefined;
    if (dataPolicy === 'purge' && summary.hasData) {
      const exportDir = options.exportDir ?? this.getPluginDataExportDir();
      const targetFile = path.join(exportDir, `${sanitizeFileSegment(manifestId)}__${pluginId}__${Date.now()}.sql`);
      const exported = exportPluginDataToSql(this.db, { manifestId, pluginId, prefixes, targetFile });
      exportFile = exported.file;
      console.log(
        `[PluginHost] Exported plugin data for "${manifestId}" before purge: ${exported.file} ` +
          `(${exported.tables.length} tables, ${exported.rowCount} rows)`,
      );
    }

    // 4c. 从 DB 删除 plugins 行（数据按策略处理）
    this.db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);

    let totalDropped = 0;
    let orphanRegistered = false;
    if (dataPolicy === 'purge') {
      // 插件键空间总是可以删；manifestId 共享键空间仅在无其他持有者时删除
      this.db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ?').run(pluginId);
      const sharedOwners = hasOtherDataOwners(this.db, manifestId, pluginId);
      if (!sharedOwners) {
        this.db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ?').run(manifestId);
      }

      for (const prefix of prefixes) {
        // 若仍有同 manifestId 的兄弟插件已安装，保留旧前缀避免误删
        if (otherPluginSharingManifest && prefix === pluginTablePrefix(manifestId)) {
          continue;
        }
        totalDropped += this.dropPluginTables(prefix);
      }
      // 迁移版本记录必须随数据一起清除，否则重装会从旧版本号继续升级（跳版）
      try {
        this.db.prepare('DELETE FROM plugin_migrations WHERE plugin_id = ?').run(pluginId);
      } catch {
        // 迁移表不存在时无记录
      }
      // 清理可能残留的历史登记（例如上次 keep 卸载后重装又卸载）
      deleteOrphanDataRecord(this.db, manifestId, pluginId);
      if (totalDropped > 0) {
        console.log(`[PluginHost] Dropped ${totalDropped} plugin tables for "${pluginId}"`);
      }
    } else if (summary.hasData) {
      // keep：登记孤立数据，重装同 manifest.id 时复用。无数据则不登记，避免管理页噪声。
      registerOrphanData(this.db, {
        manifestId,
        pluginId,
        pluginName: extractManifestField(row?.manifest, 'name'),
        pluginVersion: extractManifestField(row?.manifest, 'version'),
        tablePrefixes: prefixes,
        summary,
      });
      orphanRegistered = true;
      console.log(
        `[PluginHost] Kept plugin data for "${manifestId}" (pluginId=${pluginId}, ` +
          `${summary.tables.length} tables, ${summary.rowCount} rows, ${summary.storageRows} storage keys)`,
      );
    }
    clearPublicRouteApprovals(this.db, [pluginId, manifestId]);

    // 4d. 撤销插件能力（与 T-04-20 等价的兜底）
    // 非 ACTIVE 态卸载不会走 deactivate 路径，也就不会执行 revokeAll，
    // 会造成已授予能力在内存中残留（权限泄漏）。此处无条件撤销一次。
    // 与 activate/deactivate 共用 revokeCapabilities（P1：能力授予/撤销
    // 从 7 处内联收敛为单一来源，避免只改一处造成漂移）。
    await this.revokeCapabilities(`plugin:${manifestId}`);

    // 4e. Deregister static routes registered by deploy (best-effort cleanup)
    if (this.expressApp && this._registeredRoutes.has(manifestId)) {
      try {
        const route = this._registeredRoutes.get(manifestId);
        const stack = this.expressApp._router?.stack || [];
        for (let i = stack.length - 1; i >= 0; i--) {
          const layer = stack[i];
          if (layer.route === undefined && layer.regexp && new RegExp(layer.regexp).test(route + '/')) {
            stack.splice(i, 1);
            // 审计 R-6：原先此处 `break` —— createPluginStaticMiddleware 挂载的是
            // **两个**中间件（CSP 头 + express.static），只摘一个会留下一个
            // 空转层（继续给已卸载插件的路由设 header）。从后往前遍历时
            // splice 不影响更小的索引，故可安全删除全部匹配层。
          }
        }
        this._registeredRoutes.delete(manifestId);
        console.log(`[PluginHost] Deregistered static route "${route}" for plugin "${manifestId}"`);
      } catch (routeErr: any) {
        console.warn(`[PluginHost] Failed to deregister static route for "${manifestId}":`, routeErr.message);
      }
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
    this.setPluginState(pluginId, PluginState.UNINSTALLED);
    this.pluginInstances.delete(pluginId);

    // 6a. V3.0: 清理贡献注册
    this.contributionRegistry.unregister(manifestId);

    console.log(`[PluginHost] Plugin "${pluginId}" uninstalled (dataPolicy=${dataPolicy})`);
    recordSecurityAudit('plugin.uninstalled', {
      actorId: options.actorId,
      pluginId,
      manifestId,
      dataPolicy,
      keptTables: dataPolicy === 'keep' ? summary.tables.map((t) => t.name) : [],
      keptRows: dataPolicy === 'keep' ? summary.rowCount : 0,
      droppedTables: totalDropped,
      exportFile,
    });
    if (dataPolicy === 'purge' && summary.hasData) {
      recordSecurityAudit('plugin.data_purged', {
        actorId: options.actorId,
        pluginId,
        manifestId,
        droppedTables: totalDropped,
        exportFile,
      });
    }

    return {
      pluginId,
      manifestId,
      dataPolicy,
      keptTables: dataPolicy === 'keep' ? summary.tables.map((t) => t.name) : [],
      keptRows: dataPolicy === 'keep' ? summary.rowCount : 0,
      droppedTables: totalDropped,
      exportFile,
      orphanRegistered,
    };
  }
}

/** 归档文件名安全段：manifest.id 可能含 `@` / `/` 等路径字符。 */
function sanitizeFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._@-]/g, '_');
}

/** 从 plugins.manifest JSON 中安全提取字段（损坏 JSON 返回 null，不影响卸载）。 */
function extractManifestField(manifestJson: string | undefined, key: 'name' | 'version'): string | null {
  if (!manifestJson) return null;
  try {
    const value = JSON.parse(manifestJson)?.[key];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
