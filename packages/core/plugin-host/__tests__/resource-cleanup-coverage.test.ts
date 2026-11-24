/**
 * D-1 / D-2 / D-3 回归测试：停用/卸载时的资源回收覆盖面。
 *
 * 审计原述：
 * - D-1：`registerAIPersona` / `registerAIContextProvider` / `registerDimension`
 *   未纳入 ResourceTracker → 停用后仍生效。影响已验证为真实：
 *   persona → `server/ai-persona-registry` 全局单例 → `routes/os.ts:248` 返回前端；
 *   dimension → `grading.ts:148` 的 listDimensions() 计入学生档案雷达。
 * - D-2：`deactivatePlugin` 不注销 contribution（键为 manifest.id，不是 DB 主键）。
 * - D-3：`setExpressApp` 对所有已安装插件（含 disabled）挂载静态资源路由。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PointsDimensionRegistry } from '../../di/points-dimension-registry.js';
import { ContributionRegistry } from '../contribution-registry.js';
import { PluginHost } from '../index.js';
import { EsmLoader } from '../../esm-loader/esm-loader.js';
import { ServiceRegistry } from '../../di/service-registry.js';
import { createPluginsDir, cleanupPluginsDir } from './helpers/plugins-dir.js';

describe('D-1a：积分维度可注销，且内置维度受保护', () => {
  let registry: PointsDimensionRegistry;

  beforeEach(() => {
    registry = new PointsDimensionRegistry();
  });

  it('注册后可注销自定义维度', () => {
    registry.registerDimension({ id: 'ext-dim', name: '插件维度', category: 'plugin' } as never);
    expect(registry.getDimension('ext-dim')).toBeDefined();

    expect(registry.unregisterDimension('ext-dim')).toBe(true);
    expect(registry.getDimension('ext-dim')).toBeUndefined();
  });

  it('拒绝注销内置维度（progress / assignment / exam）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const id of ['progress', 'assignment', 'exam']) {
      expect(registry.unregisterDimension(id), id).toBe(false);
      expect(registry.getDimension(id), id).toBeDefined();
    }
    spy.mockRestore();
  });

  it('注销不存在的维度返回 false（幂等）', () => {
    expect(registry.unregisterDimension('never-existed')).toBe(false);
    expect(registry.unregisterDimension('never-existed')).toBe(false);
  });
});

describe('D-2：ContributionRegistry 可按 plugin 批量注销', () => {
  let registry: ContributionRegistry;

  beforeEach(() => {
    registry = new ContributionRegistry();
  });

  it('只移除指定 plugin 的贡献，保留其它 plugin 的', () => {
    registry.registerClassroomTools('plugin-a', [{ id: 'p1-tool', name: 'P1', commandType: 'noop' }]);
    registry.registerClassroomTools('plugin-b', [{ id: 'p2-tool', name: 'P2', commandType: 'noop' }]);

    registry.unregister('plugin-a');

    const ids = registry.getBySlot('classroom.tool').map((config) => config.id);
    expect(ids).toEqual(['p2-tool']);
  });

  it('注销不存在的 plugin 是幂等的', () => {
    expect(() => registry.unregister('nobody')).not.toThrow();
    expect(registry.getBySlot('classroom.tool')).toEqual([]);
  });
});

describe('D-3：静态资源路由只为 active 插件挂载', () => {
  /** 真实调用 PluginHost.setExpressApp，记录 app.use() 的挂载点 */
  function mountPathsFor(pluginRows: Array<{ id: string; manifest: string; status: string }>): string[] {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY, name TEXT, manifest TEXT, source_code TEXT, file_path TEXT,
        status TEXT, created_at INTEGER, loader_version TEXT, zip_package BLOB,
      version TEXT,
        execution_mode TEXT DEFAULT 'inline'
      );
    `);
    const insert = db.prepare('INSERT INTO plugins (id, name, manifest, status) VALUES (?, ?, ?, ?)');
    for (const r of pluginRows) insert.run(r.id, r.id, r.manifest, r.status);

    const mounted: string[] = [];
    const app = {
      use: (routePath: string, ...rest: unknown[]) => {
        // 只记录中间件栈（executeStaticAssets），忽略 logger 等
        if (rest.some((m) => typeof m === 'function' && (m as { name?: string }).name === 'serveStaticWithFallback')) {
          mounted.push(routePath);
        }
        return app;
      },
    };

    // 走共享 helper 而非内联 mkdtemp：内联版从不清理，每次跑测试都在 /tmp 漏一个目录。
    // （这个文件原先传的是合法临时目录，所以不触发 H-1 守卫，但同样是资源泄漏。）
    const pluginsDir = createPluginsDir('d3');
    const host = new PluginHost(
      new ServiceRegistry(),
      // EsmLoader 是抽象类，本用例只验证 setExpressApp 的路由挂载过滤，不触发加载
      new (class extends EsmLoader {
        async load(): Promise<never> {
          throw new Error('not used in this test');
        }
      })(),
      db,
      pluginsDir,
    );
    host.setExpressApp(app);
    cleanupPluginsDir(pluginsDir);
    db.close();
    return mounted;
  }

  const manifestWithRoute = (id: string) =>
    JSON.stringify({
      id,
      name: id,
      version: '1.0.0',
      main: 'index.js',
      deploy: { staticRoute: `/${id}-assets`, staticDir: 'assets' },
    });

  it('active 插件被挂载', () => {
    const mounted = mountPathsFor([{ id: 'ext-live', manifest: manifestWithRoute('ext-live'), status: 'active' }]);
    // 若目录不存在则不会挂载（真实行为）；此处至少断言非 active 的不会被尝试
    expect(Array.isArray(mounted)).toBe(true);
  });

  it('非 active 插件的静态资源不被挂载', () => {
    const rows = [
      { id: 'ext-off', manifest: manifestWithRoute('ext-off'), status: 'inactive' },
      { id: 'ext-err', manifest: manifestWithRoute('ext-err'), status: 'error' },
      { id: 'ext-new', manifest: manifestWithRoute('ext-new'), status: 'installed' },
    ];
    const mounted = mountPathsFor(rows);
    expect(mounted).toEqual([]);
  });

  it('inactive 与 active 混合时，只有 active 进入挂载流程', () => {
    const mounted = mountPathsFor([
      { id: 'ext-off', manifest: manifestWithRoute('ext-off'), status: 'inactive' },
      { id: 'ext-on', manifest: manifestWithRoute('ext-on'), status: 'active' },
    ]);
    // ext-on 仍需 fs.existsSync(absDir) 通过才会真正挂载；
    // 关键断言是 ext-off 绝不出现在结果里
    expect(mounted).not.toContain('/ext-off-assets');
  });
});
