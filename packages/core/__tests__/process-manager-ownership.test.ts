/**
 * B-5 加固：ProcessManager 的进程归属（ownerHint 优先于 currentOwner）。
 *
 * ## 修复的问题
 *
 * `setPluginOwner` 写入的 `currentOwner` 是**全局单值**，只在「插件激活期内」
 * 准确。插件运行期（HTTP handler / 定时器回调）spawn 的任务会错记到
 * 「最后激活的插件」名下：
 *   · 自己 kill 自己的任务 → 归属校验拒绝（功能故障）；
 *   · 他人 kill 本插件的任务 → 校验通过（越权）。
 *
 * 修复：`spawn` / `registerInterval` 增加可选 `ownerHint` 参数，
 * `wrapProcessManager` 的 per-plugin 包装层显式传入调用方插件 id。
 * 不传时回落 `currentOwner`（内核自身调用 / 旧调用方行为不变）。
 *
 * 另外补齐 ESM 安装路径的激活期归属声明（此前仅 preloaded 路径有）。
 */
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ProcessManager } from '../process-manager/index.js';

function createManager() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE processes (
      id TEXT PRIMARY KEY, name TEXT, status TEXT, task_type TEXT, payload TEXT,
      state TEXT, logs TEXT, created_at INTEGER, updated_at INTEGER, plugin_id TEXT
    );
  `);
  const eventBus = { publish: vi.fn() };
  const manager = new ProcessManager({ db, eventBus } as never);
  return { db, manager, eventBus };
}

describe('B-5 · ProcessManager 归属：ownerHint 优先', () => {
  it('ownerHint 显式传入时写入 processes.plugin_id', () => {
    const { db, manager } = createManager();
    const pid = manager.spawn('job', 'ext-a::task', { x: 1 }, 'plugin-a');

    const row = db.prepare('SELECT plugin_id FROM processes WHERE id = ?').get(pid) as { plugin_id: string };
    expect(row.plugin_id).toBe('plugin-a');
    expect(manager.getProcessOwner(pid)).toBe('plugin-a');
  });

  it('currentOwner 被其他插件覆盖后，ownerHint 仍归属真实调用方（运行期场景）', () => {
    const { db, manager } = createManager();
    // 插件 A 激活时声明归属，随后插件 B 激活覆盖 currentOwner（既有单值语义）
    manager.setPluginOwner('plugin-a');
    manager.setPluginOwner('plugin-b');

    // A 的运行期（HTTP handler 内）spawn —— 不带 hint 会错记到 B 名下
    const pid = manager.spawn('job', 'ext-a::task', {}, 'plugin-a');
    const row = db.prepare('SELECT plugin_id FROM processes WHERE id = ?').get(pid) as { plugin_id: string };
    expect(row.plugin_id, '运行期 spawn 的归属必须是真实调用方 A，而非最后激活的 B').toBe('plugin-a');
  });

  it('不传 ownerHint 时回落 currentOwner（内核调用 / 旧调用方行为不变）', () => {
    const { db, manager } = createManager();
    manager.setPluginOwner('plugin-b');
    const pid = manager.spawn('job', 'ext-b::task', {});
    const row = db.prepare('SELECT plugin_id FROM processes WHERE id = ?').get(pid) as { plugin_id: string };
    expect(row.plugin_id).toBe('plugin-b');
  });

  it('两者都缺失时 plugin_id 为 NULL（内核自身任务，kill 校验放行）', () => {
    const { db, manager } = createManager();
    const pid = manager.spawn('job', 'kernel-task', {});
    const row = db.prepare('SELECT plugin_id FROM processes WHERE id = ?').get(pid) as { plugin_id: string | null };
    expect(row.plugin_id).toBeNull();
    expect(manager.getProcessOwner(pid)).toBeUndefined();
  });

  it('registerInterval 同样支持 ownerHint', () => {
    const { db, manager } = createManager();
    manager.setPluginOwner('plugin-b');
    const pid = manager.registerInterval('tick', 60_000, () => {}, 'plugin-a');
    const row = db.prepare('SELECT plugin_id FROM processes WHERE id = ?').get(pid) as { plugin_id: string };
    expect(row.plugin_id).toBe('plugin-a');
  });

  it('kill 后归属副本被清除（getProcessOwner 回落 DB 行）', () => {
    const { db, manager } = createManager();
    const pid = manager.spawn('job', 'ext-a::task', {}, 'plugin-a');
    manager.kill(pid);
    // DB 行仍在（status=killed），归属记录保留供审计
    expect(manager.getProcessOwner(pid)).toBe('plugin-a');
  });
});
