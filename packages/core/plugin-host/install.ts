/**
 * PluginHost · install 层（L-2 阶段 2）。
 *
 * `PluginHostInstall` 继承 `PluginHostReload`。链序约束见 `base.ts` 的说明。
 */

import { PluginHostReload } from './reload.js';
import { PluginHostCore } from './core.js';
import { v7 as uuidv7 } from 'uuid';
import fs from 'fs';
import JSZip from 'jszip';
import path from 'path';
import { EsmLoader } from '../esm-loader/esm-loader.js';
import { manifestSchema } from '../esm-loader/manifest-schema.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import { validateAndBundleZip } from '../esm-loader/install-utils.js';
import { buildContext } from './context-builder.js';
import type { ClassroomToolConfig } from './contribution-registry.js';
import { normalizeExecutionMode, requiresIsolatedExecution, type PluginExecutionMode } from './types.js';
import { installPluginDependencies, parsePluginDependencies } from './dependency-install.js';
import { checkMissingDeps } from './dependency-resolver.js';
import semver from 'semver';
import { PluginState } from './types.js';
import { ICapabilityServiceToken } from '../di/interfaces.js';
import type { ICapabilityService } from '../di/interfaces.js';
import { OPENLEARN_VERSION } from '../version.js';
import { createPluginStaticMiddleware } from './base.js';
import type { PluginHost } from './index.js';

export abstract class PluginHostInstall extends PluginHostReload {
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
      this.contributionRegistry.registerClassroomTools(manifest.id, manifest.classroomTools as ClassroomToolConfig[]);
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

    // 2e. V3.2: 检查跨插件服务依赖（warn，不阻塞安装）
    const serviceCheck = this.checkCrossPluginServices(manifest);
    if (serviceCheck) {
      for (const u of serviceCheck.unsatisfied) {
        console.warn(
          `[PluginHost] Plugin "${manifest.id}" requires service "${u.required}" from "${u.providerId}", ` +
            `but the provider has not declared it in manifest.provides. The plugin will fail to activate.`,
        );
      }
    }
    // 3. 生成 pluginId
    const pluginId = uuidv7();
    const pluginDir = this.getPluginDir(pluginId);
    const filePath = this.getPluginFilePath(pluginId);
    const manifestPath = this.getPluginManifestPath(pluginId);

    try {
      // 4a. 词法静态门（A-1 / C-1 / C-6）
      //
      // 放在 bundlePlugin() **之前**，这样拒绝理由是明确的 PluginSecurity 错误，
      // 而不是在 esbuild 报错里看到 `openlearn-token-enforcer`（那是 ZIP 路径的消息）。
      // 两层门职责不同：词法门拦计算式 import / eval / 动态 require，
      // esbuild enforcer 拦裸 specifier 与绝对路径。
      const { assertPluginCodeSafe } = await import('../esm-loader/install-utils.js');
      assertPluginCodeSafe(sourceCode);

      // 4b. esbuild token enforcer + 绝对路径拦截
      //
      // 此前本方法把 `sourceCode` **原样落盘**，完全不经过 bundlePlugin() 与
      // openlearn-token-enforcer —— 于是 `plugin.install`（源码安装）路径的静态防线
      // 等于不存在，而 `plugin.install_zip` 路径却有一整套。两条安装路径强度严重不对称：
      // 经审批的管理员用前者装插件，可直接 `import fs from 'node:fs'`。
      //
      // 现在两条路径共用同一组门。bundlePlugin 在此**只做校验、不落盘其产物**：
      // inline 安装传入的是单文件源码字符串，本就不存在相对导入需要内联
      // （多文件场景走 installPluginFromZip，那里落盘的才是 bundle）。
      // 因此落盘的仍是原始 sourceCode —— 既拿到与 ZIP 路径一致的防线强度，
      // 又不改变 activatePlugin 的读盘与 loader 既有契约。
      const { bundlePlugin } = await import('../esm-loader/install-utils.js');
      await bundlePlugin(sourceCode, pluginDir); // 抛错即拒绝安装

      // 5. 写入文件系统
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(filePath, sourceCode, 'utf-8');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      // 6. INSERT 到 DB（source_code 留空，源码已迁移到文件系统）
      // version 列是 H-3 新增的**加速索引**（真源仍是 manifest JSON），
      // 漏写不会造成功能回归，但会让版本筛选查不到该行 —— 故此处同步写入。
      const stmt = this.db.prepare(
        'INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        manifest.version,
      );

      // 7. 设置状态为 INSTALLED（上方 INSERT 已写入 status='installed'，此处只同步内存）
      this.setPluginState(pluginId, PluginState.INSTALLED);

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
    if (pluginId.startsWith('@openlearn/') || this.preloadedPlugins.has(pluginId)) {
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

    // 幂等：已卸载且 DB 无残留记录时直接返回，避免 uninstalled → uninstalled 非法转换
    if (state === PluginState.UNINSTALLED && !row) {
      this.pluginStates.delete(pluginId);
      return;
    }

    // 验证状态转换（已处于 UNINSTALLED 但仍有残留记录时跳过校验，继续清理）
    if (state !== PluginState.UNINSTALLED) {
      this.validateTransition(pluginId, state, PluginState.UNINSTALLED);
    }
    const manifestId = (() => {
      if (!row) return pluginId;
      try {
        const m = JSON.parse(row.manifest);
        return m.id ?? pluginId;
      } catch {
        return pluginId;
      }
    })();
    const pluginDir = row?.file_path ? this.getPluginDir(pluginId) : null;

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

    // 4b. 撤销插件能力（与 T-04-20 等价的兜底）
    // 非 ACTIVE 态卸载不会走 deactivate 路径，也就不会执行 revokeAll，
    // 会造成已授予能力在内存中残留（权限泄漏）。此处无条件撤销一次。
    try {
      const capService = await this.serviceRegistry.resolve<ICapabilityService>(ICapabilityServiceToken);
      await capService.revokeAll(`plugin:${manifestId}`);
    } catch (capErr) {
      console.warn(`[PluginHost] Failed to revoke capabilities for "${pluginId}":`, capErr);
    }

    // 4c. Deregister static routes registered by deploy (best-effort cleanup)
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
  async installPluginFromZip(zipBuffer: Buffer, overrideExecutionMode?: PluginExecutionMode): Promise<Manifest> {
    if (!this.esmLoader) {
      throw new Error('Cannot install ZIP plugin: no esmLoader injected');
    }

    // 1. 验证并打包 ZIP
    const { manifest, bundledCode } = await validateAndBundleZip(zipBuffer);
    this.emitProgress(manifest.id, 'validating', 'Plugin validated, writing files...');

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
      this.contributionRegistry.registerClassroomTools(manifest.id, manifest.classroomTools as ClassroomToolConfig[]);
    }

    // 2c. V3.0: 检查插件依赖（仅警告）
    if (manifest.pluginDependencies && manifest.pluginDependencies.length > 0) {
      const installedIds = new Set(this.listInstalledPluginIds());
      const missing = checkMissingDeps(manifest.pluginDependencies, installedIds);
      if (missing.length > 0) {
        console.warn(
          `[PluginHost] Plugin "${manifest.id}" depends on: ${missing.join(', ')}, ` + `which are not installed.`,
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

      // Extract frontend.js and deploy script if present in ZIP
      const zip = await JSZip.loadAsync(zipBuffer);
      const frontendFile = zip.file('frontend.js');
      if (frontendFile) {
        const frontendCode = await frontendFile.async('string');
        fs.writeFileSync(path.join(pluginDir, 'frontend.js'), frontendCode, 'utf-8');
      }
      // Extract deploy script declared in manifest
      if (manifest.deploy?.script) {
        const rawScript = manifest.deploy.script.replace(/\\/g, '/');
        const resolvedScript = path.resolve(pluginDir, rawScript);
        if (rawScript.includes('..') || !resolvedScript.startsWith(pluginDir + path.sep)) {
          throw new Error(`Security Violation: Zip Slip detected in deploy script path "${manifest.deploy.script}"`);
        }
        const deployFile = zip.file(manifest.deploy.script);
        if (deployFile) {
          const deployCode = await deployFile.async('string');
          fs.writeFileSync(resolvedScript, deployCode, 'utf-8');
        }
      }

      this.emitProgress(manifest.id, 'extracting', 'Extracting assets...');
      // Extract storage/ directory if present in ZIP (for static assets bundled with plugin)
      const storageEntries = Object.keys(zip.files).filter(
        (name) => name.startsWith('storage/') && !zip.files[name].dir,
      );
      if (storageEntries.length > 0) {
        console.log(
          `[PluginHost] Extracting ${storageEntries.length} static asset files for plugin "${manifest.id}"...`,
        );
        // SEC-ZIPSLIP: 严密校验所有条目路径，防止通过 .. 实施 Zip Slip 穿越写任意文件
        const dirs = new Set<string>();
        for (const rawName of storageEntries) {
          const normalized = rawName.replace(/\\/g, '/');
          const destPath = path.resolve(pluginDir, normalized);
          if (normalized.includes('..') || !destPath.startsWith(pluginDir + path.sep)) {
            throw new Error(`Security Violation: Zip Slip detected in asset path "${rawName}"`);
          }
          dirs.add(path.dirname(destPath));
        }
        for (const dir of dirs) {
          fs.mkdirSync(dir, { recursive: true });
        }
        // Write files in parallel batches (10 at a time) to balance speed and memory
        const BATCH_SIZE = 10;
        for (let i = 0; i < storageEntries.length; i += BATCH_SIZE) {
          const batch = storageEntries.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(async (name) => {
              const normalized = name.replace(/\\/g, '/');
              const destPath = path.resolve(pluginDir, normalized);
              if (normalized.includes('..') || !destPath.startsWith(pluginDir + path.sep)) {
                throw new Error(`Security Violation: Zip Slip detected in asset path "${name}"`);
              }
              const file = zip.file(name);
              if (file) {
                const content = await file.async('nodebuffer');
                fs.writeFileSync(destPath, content);
              }
            }),
          );
        }
        console.log(`[PluginHost] Static assets extracted for plugin "${manifest.id}"`);
      }

      // 4b. Auto-install declared dependencies if present
      //
      // H-4：**刻意不吞异常**。原实现是 `catch { console.error(...) }` 后继续执行 ——
      // 部署脚本、贡献注册、DB 落库、状态机全都照常跑完，插件最终是 ACTIVE 的，
      // 只是 node_modules 残缺。故障会以「插件运行时 MODULE_NOT_FOUND」的形式
      // 在很久之后、别的上下文里出现。现在依赖装不上就让整个安装事务回滚。
      //
      // 参数拼装与 --ignore-scripts 统一在 dependency-install.ts，两条路径不再可能漂移。
      if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
        console.log(`[PluginHost] Installing dependencies for plugin "${manifest.id}" in ${pluginDir}...`);
        installPluginDependencies(pluginDir, {
          pluginId: manifest.id,
          // dependencies 不在 manifestSchema 里 → 类型 unknown，运行时窄化而非断言
          dependencies: parsePluginDependencies(manifest.dependencies, manifest.id),
          operation: 'install',
        });
        console.log(`[PluginHost] Dependencies successfully installed for plugin "${manifest.id}"`);
      }

      // 4c. Execute deploy script if declared in manifest
      if (manifest.deploy?.script) {
        // SEC-RCE-02: 默认禁止执行外部 deploy 脚本，需显式设置 ALLOW_UNSAFE_PLUGIN_SCRIPTS=true 环境变量
        if (process.env.ALLOW_UNSAFE_PLUGIN_SCRIPTS !== 'true') {
          console.warn(
            `[SECURITY WARNING] Deploy script "${manifest.deploy.script}" for plugin "${manifest.id}" blocked by default security policy. Set ALLOW_UNSAFE_PLUGIN_SCRIPTS=true to enable.`,
          );
        } else {
          // Try running from plugin dir; fall back to v2_plugins source dir
          let deployScriptPath = path.join(pluginDir, manifest.deploy.script);
          if (!fs.existsSync(deployScriptPath)) {
            const altPath = path.join(process.cwd(), 'v2_plugins', 'scratch-editor-deploy', manifest.deploy.script);
            if (fs.existsSync(altPath)) deployScriptPath = altPath;
          }
          if (fs.existsSync(deployScriptPath)) {
            console.log(`[PluginHost] Running deploy script: node ${deployScriptPath}`);
            try {
              const { execSync } = await import('node:child_process');
              execSync(`node "${deployScriptPath}" "${process.cwd()}"`, { timeout: 120000 });
              console.log(`[PluginHost] Deploy script completed for plugin "${manifest.id}"`);
            } catch (deployErr: any) {
              console.error(`[PluginHost] Deploy script failed for plugin "${manifest.id}":`, deployErr.message);
              throw new Error(`Deploy script "${manifest.deploy.script}" failed: ${deployErr.message}`);
            }
          } else {
            console.warn(
              `[PluginHost] Deploy script "${manifest.deploy.script}" not found for plugin "${manifest.id}"`,
            );
          }
        }
      }
      // 4d. Register static route if declared in manifest
      if (manifest.deploy?.staticRoute && manifest.deploy?.staticDir && this.expressApp) {
        const route = manifest.deploy.staticRoute.trim();
        // SEC-ROUTE-01: 静态路由必须以 '/' 开头且不能包含 '..'
        if (!route.startsWith('/') || route.includes('..')) {
          throw new Error(
            `[PluginHost] Invalid staticRoute "${route}" for plugin "${manifest.id}": must start with "/" and cannot contain ".."`,
          );
        }
        // SEC-ROUTE-02: 禁止注册系统核心保留前缀
        const normalized = PluginHostCore.normalizeStaticRoute(route);
        const SYSTEM_RESERVED_ROUTES = ['/api', '/socket.io', '/runtime', '/docs', '/admin', '/health'];
        if (
          route === '/' ||
          SYSTEM_RESERVED_ROUTES.some((res) => normalized === res || normalized.startsWith(res + '/'))
        ) {
          throw new Error(
            `[PluginHost] Security Violation: Plugin "${manifest.id}" cannot register reserved system route "${route}"`,
          );
        }
        // SEC-ROUTE-03: 检查已有插件路由冲突
        //
        // 两侧都归一化：`_registeredRoutes` 存的是归一化形式（见下面的 set），
        // 但仍再归一化一次 —— 该 Map 也可能被 setExpressApp 的恢复路径写入，
        // 双保险避免将来某条写入路径存了原始形式就静默失效。
        for (const [ownerId, existingRoute] of this._registeredRoutes.entries()) {
          if (ownerId !== manifest.id && PluginHostCore.normalizeStaticRoute(existingRoute) === normalized) {
            throw new Error(
              `[PluginHost] Static route conflict: "${route}" (normalized: "${normalized}") ` +
                `is already registered by plugin "${ownerId}" as "${existingRoute}"`,
            );
          }
        }
        const absDir = path.join(pluginDir, manifest.deploy.staticDir);
        if (fs.existsSync(absDir)) {
          this.expressApp.use(route, ...createPluginStaticMiddleware(absDir));
          // 存归一化形式，使后续比较不必依赖调用方记得归一
          this._registeredRoutes.set(manifest.id, normalized);
          console.log(`[PluginHost] Registered static route "${route}" for plugin "${manifest.id}"`);
        } else {
          console.warn(
            `[PluginHost] Static directory "${manifest.deploy.staticDir}" for route "${route}" not found for plugin "${manifest.id}"`,
          );
        }
      }
      this.emitProgress(manifest.id, 'registering', 'Registering routes and saving...');
      // 5. INSERT 到 DB（源码和 ZIP 已迁移到文件系统，DB 仅存元数据）
      // Read executionMode from manifest (default: 'inline'), override if administrator specifies
      //
      // F-5：manifest.executionMode 曾是 `=== 'worker' ? 'worker' : 'inline'` 两值
      // 映射 —— 作者在 manifest 里写 'process' 会被静默装成 inline，而
      // types.ts 的注释声称「mode 有三个来源（参数/DB/manifest）」。
      // 统一走 normalizeExecutionMode：非法值退化为 inline（可预测），
      // 'process' 被正确识别。override 优先。
      const executionMode: PluginExecutionMode =
        overrideExecutionMode ?? normalizeExecutionMode((manifest as { executionMode?: unknown }).executionMode);
      // version 列说明同 installPlugin（H-3）：加速索引，真源是 manifest JSON
      const stmt = this.db.prepare(
        'INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        executionMode,
        manifest.version,
      );

      // 6. 设置状态（同上：INSERT 已落 DB，这里只同步内存）
      this.setPluginState(pluginId, PluginState.INSTALLED);

      console.log(`[PluginHost] Plugin "${manifest.id}" installed from ZIP to ${filePath} (${pluginId})`);
      this.emitProgress(manifest.id, 'complete', 'Installation complete');
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
   * Replace an already-installed plugin package in place (same DB UUID).
   *
   * - Blocks system plugins (@openlearn/* / preloaded)
   * - Requires matching manifest.id
   * - Version policy: new >= old unless allowDowngrade
   * - Preserves config tables / plugin_migrations / business data
   * - ACTIVE → hot reload (or deactivate+activate if execution mode changes)
   * - inactive → replace files only, keep disabled
   */
  async updatePluginFromZip(
    zipBuffer: Buffer,
    options: {
      targetPluginId?: string;
      executionMode?: PluginExecutionMode;
      allowDowngrade?: boolean;
    } = {},
  ): Promise<{
    pluginId: string;
    manifest: Manifest;
    oldVersion: string;
    newVersion: string;
    previousStatus: string;
    wasActive: boolean;
  }> {
    if (!this.esmLoader) {
      throw new Error('Cannot update ZIP plugin: no esmLoader injected');
    }

    const { manifest, bundledCode } = await validateAndBundleZip(zipBuffer);
    this.emitProgress(manifest.id, 'validating', 'Plugin validated, preparing update...');

    // Resolve existing install
    let pluginId: string;
    if (options.targetPluginId) {
      pluginId = this.resolvePluginUuid(options.targetPluginId);
      const row = this.db.prepare('SELECT id, manifest, status FROM plugins WHERE id = ?').get(pluginId) as
        { id: string; manifest: string; status: string } | undefined;
      if (!row) {
        throw new Error(`Plugin "${options.targetPluginId}" is not installed`);
      }
      let existingManifest: Manifest;
      try {
        existingManifest = JSON.parse(row.manifest) as Manifest;
      } catch {
        throw new Error(`Plugin "${pluginId}" has a corrupt manifest`);
      }
      if (existingManifest.id !== manifest.id) {
        throw new Error(`Manifest id mismatch: card/target is "${existingManifest.id}", ZIP declares "${manifest.id}"`);
      }
    } else {
      const found = this.findByManifestId(manifest.id);
      if (!found) {
        throw new Error(`Plugin "${manifest.id}" is not installed; use install instead of update`);
      }
      pluginId = found.pluginId;
    }

    if (this.isSystemPluginRecord(pluginId, manifest.id)) {
      throw new Error(`Cannot update system plugin: ${manifest.id}`);
    }

    // version 在 SELECT 里：更新失败回滚时需要拿**旧** version 写回，
    // 否则会留下「索引列比 manifest 新」的不一致（比 NULL 更难排查）。
    const existingRow = this.db
      .prepare('SELECT id, name, status, manifest, execution_mode, version FROM plugins WHERE id = ?')
      .get(pluginId) as {
      id: string;
      name: string;
      status: string;
      manifest: string;
      execution_mode: string;
      version: string | null;
    };

    const oldManifest = JSON.parse(existingRow.manifest) as Manifest;
    const oldVersion = oldManifest.version ?? '0.0.0';
    const newVersion = manifest.version ?? '0.0.0';
    const oldCoerced = semver.coerce(oldVersion)?.version ?? '0.0.0';
    const newCoerced = semver.coerce(newVersion)?.version ?? '0.0.0';
    if (semver.lt(newCoerced, oldCoerced) && !options.allowDowngrade) {
      throw new Error(
        `Refusing downgrade of "${manifest.id}" from v${oldVersion} to v${newVersion}. Pass allowDowngrade to force.`,
      );
    }

    // engines.openlearn check
    if (manifest.engines?.openlearn) {
      if (!semver.satisfies(OPENLEARN_VERSION, manifest.engines.openlearn)) {
        throw new Error(
          `[PluginHost] Plugin "${manifest.id}" requires OpenLearn ${manifest.engines.openlearn}, ` +
            `but host is running ${OPENLEARN_VERSION}.`,
        );
      }
    }

    const previousStatus = existingRow.status;
    const currentState = this.pluginStates.get(pluginId) ?? PluginState.INSTALLED;
    const wasActive = currentState === PluginState.ACTIVE ? true : previousStatus === 'active';
    const oldMode = normalizeExecutionMode(this.getExecutionMode(pluginId));
    // F-5：manifest.executionMode 三个取值都识别（原来是只认 'worker' 的两值映射）。
    const manifestMode = normalizeExecutionMode((manifest as { executionMode?: unknown }).executionMode);
    const executionMode = options.executionMode ?? (manifestMode !== 'inline' ? manifestMode : oldMode || 'inline');

    const pluginDir = this.getPluginDir(pluginId);
    const filePath = this.getPluginFilePath(pluginId);
    const manifestPath = this.getPluginManifestPath(pluginId);
    const zipFilePath = path.join(pluginDir, 'package.zip');

    // Snapshot old files for crude rollback on inactive path failures
    const backupDir = path.join(pluginDir, '.update-backup');
    try {
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      fs.mkdirSync(backupDir, { recursive: true });
      for (const name of ['index.js', 'manifest.json', 'package.zip', 'frontend.js']) {
        const src = path.join(pluginDir, name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(backupDir, name));
      }
    } catch {
      // backup is best-effort
    }

    try {
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(filePath, bundledCode, 'utf-8');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(zipFilePath, zipBuffer);

      const zip = await JSZip.loadAsync(zipBuffer);
      const frontendFile = zip.file('frontend.js');
      const frontendPath = path.join(pluginDir, 'frontend.js');
      if (frontendFile) {
        fs.writeFileSync(frontendPath, await frontendFile.async('string'), 'utf-8');
      } else if (fs.existsSync(frontendPath)) {
        fs.rmSync(frontendPath, { force: true });
      }

      if (manifest.deploy?.script) {
        const deployFile = zip.file(manifest.deploy.script);
        if (deployFile) {
          fs.writeFileSync(path.join(pluginDir, manifest.deploy.script), await deployFile.async('string'), 'utf-8');
        }
      }

      this.emitProgress(manifest.id, 'extracting', 'Extracting assets...');
      const storageDir = path.join(pluginDir, 'storage');
      const storageEntries = Object.keys(zip.files).filter(
        (name) => name.startsWith('storage/') && !zip.files[name].dir,
      );
      if (storageEntries.length > 0) {
        if (fs.existsSync(storageDir)) fs.rmSync(storageDir, { recursive: true, force: true });
        const dirs = new Set<string>();
        for (const name of storageEntries) dirs.add(path.dirname(name));
        for (const dir of dirs) fs.mkdirSync(path.join(pluginDir, dir), { recursive: true });
        const BATCH_SIZE = 10;
        for (let i = 0; i < storageEntries.length; i += BATCH_SIZE) {
          const batch = storageEntries.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(async (name) => {
              const file = zip.file(name);
              if (file) fs.writeFileSync(path.join(pluginDir, name), await file.async('nodebuffer'));
            }),
          );
        }
      }

      // Optional dependency install
      if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
        try {
          // H-4：与安装路径共用同一实现。原先此处**缺 --ignore-scripts**（SEC-RCE-01），
          // 等于「装一次安全、从市场更新一次就能跑 postinstall」—— 而更新是第三方插件
          // 最常见的安装途径。现已由 dependency-install.ts 统一，不可能再漂移。
          installPluginDependencies(pluginDir, {
            pluginId: manifest.id,
            dependencies: parsePluginDependencies(manifest.dependencies, manifest.id),
            operation: 'update',
          });
        } catch (installErr) {
          // 依赖装不上 ⇒ 更新失败 ⇒ 回滚到旧版本并向上传播，让 DB 不落到「新版已装」的假象。
          // 原实现只 console.error 就继续，把新 manifest 写进了 DB。
          console.error(`[PluginHost] Failed to install dependencies during update of "${manifest.id}":`, installErr);
          throw installErr;
        }
      }

      // Contribution registry refresh (manifest.id keyed)
      if (manifest.contributes) {
        this.contributionRegistry.register(manifest.id, manifest.contributes);
      } else if (manifest.classroomTools && manifest.classroomTools.length > 0) {
        this.contributionRegistry.registerClassroomTools(manifest.id, manifest.classroomTools as ClassroomToolConfig[]);
      } else {
        this.contributionRegistry.unregister(manifest.id);
      }

      // Persist metadata — keep UUID; do not touch config/migrations tables
      this.db
        .prepare(
          `UPDATE plugins SET name = ?, manifest = ?, file_path = ?, execution_mode = ?, loader_version = 'esm', updated_at = ?, version = ? WHERE id = ?`,
        )
        .run(
          manifest.name,
          JSON.stringify(manifest),
          filePath,
          executionMode,
          Date.now(),
          // version 是 H-3 的加速索引列：更新 manifest 的同时必须同步，否则版本停留在旧值
          manifest.version,
          pluginId,
        );

      this.emitProgress(manifest.id, 'registering', 'Applying runtime update...');

      if (wasActive) {
        if (oldMode !== executionMode) {
          // Mode switch: full deactivate + activate under new mode
          try {
            // 判据用 requiresIsolatedExecution（审计 F-1）：oldMode 为 'process' 时
            // 也必须走 deactivateWorker 停掉子进程，否则 createWorker 会撞
            // "Worker already exists"，新模式永远激活不了。
            if (requiresIsolatedExecution(oldMode)) await this.deactivateWorker(pluginId);
            else await this.deactivatePlugin(pluginId);
          } catch (e) {
            console.warn(`[PluginHost] deactivate before mode-switch update failed for "${pluginId}":`, e);
          }
          await this.activatePlugin(pluginId);
        } else {
          // Same mode: atomic hot reload
          await this.reloadPlugin(pluginId, bundledCode);
        }
      } else {
        // Keep disabled — ensure state is not ACTIVE
        if (currentState === PluginState.ACTIVE) {
          // inconsistent DB/memory — force deactivate path already handled above
        } else {
          // 兜底回收可能残留的 worker 线程（审计 C-4）。
          //
          // 修复前的成因判断有误（原以为是「mode 从 DB 二次读导致走错分支」）——
          // `worker-manager.terminate()` 的 finally 块是**无条件**回收的，与 execution_mode 无关。
          // 真实泄漏场景在这里：插件处于 ERROR / INACTIVE 态时执行更新，
          // `wasActive` 为 false → 上面的 deactivate 分支整段被跳过 → 若此前崩溃或
          // 其它路径留下了活跃 worker，其引用与 serviceHost 注册的命令转发无人回收；
          // 之后再以 worker 模式激活会被 "Worker already exists" 拒绝。
          //
          // 此处无条件兜底（幂等）：无论当前是否真的有 worker，都调用一次。
          try {
            if (this.workerManager) {
              await this.workerManager.terminateWorker(pluginId);
            }
          } catch (e) {
            console.warn(`[PluginHost] Best-effort worker reclaim during update of "${pluginId}" failed:`, e);
          }

          this.setPluginState(
            pluginId,
            currentState === PluginState.UNINSTALLED ? PluginState.INSTALLED : currentState,
            { persistDb: true },
          );
        }
      }

      // Cleanup backup
      try {
        if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }

      console.log(
        `[PluginHost] Plugin "${manifest.id}" updated ${oldVersion} → ${newVersion} (${pluginId}), wasActive=${wasActive}`,
      );
      this.emitProgress(manifest.id, 'complete', 'Update complete');
      return {
        pluginId,
        manifest,
        oldVersion,
        newVersion,
        previousStatus,
        wasActive,
      };
    } catch (err) {
      // Best-effort restore of key files for inactive updates; active reload has its own rollback
      try {
        if (fs.existsSync(backupDir)) {
          for (const name of ['index.js', 'manifest.json', 'package.zip', 'frontend.js']) {
            const b = path.join(backupDir, name);
            if (fs.existsSync(b)) fs.copyFileSync(b, path.join(pluginDir, name));
          }
          // 回滚路径：写回的是旧 manifest，version 必须取**旧行**的值。
          // 若这里填新 manifest 的 version，会造成「索引列比真源新」的不一致 ——
          // 那比 version 列为 NULL 更难排查（NULL 语义明确是「未知」）。
          this.db
            .prepare(`UPDATE plugins SET name = ?, manifest = ?, execution_mode = ?, version = ? WHERE id = ?`)
            .run(existingRow.name, existingRow.manifest, existingRow.execution_mode, existingRow.version, pluginId);
        }
      } catch (restoreErr) {
        console.error(`[PluginHost] Failed to restore backup after update error:`, restoreErr);
      }
      try {
        if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
}
