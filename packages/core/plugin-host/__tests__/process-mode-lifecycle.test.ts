/**
 * F-1 行为契约：`executionMode: 'process'` 的插件必须走隔离路径的**全生命周期**。
 *
 * 源码级护栏在 `execution-mode.test.ts`（五处分流用 requiresIsolatedExecution）；
 * 本文件防的是**运行时行为**——用 mock WorkerManager 观察调用序列：
 *
 *   activate      → createWorker 收到 { isolateKind: 'process' }
 *   deactivate    → terminateWorker 被调用（修复前被整段跳过 ⇒ 子进程泄漏）
 *   reload        → 不落入 inline 的 esmLoader.load（修复前进程隔离被静默降级）
 *
 * 不真实 spawn 子进程：原语层由 child-process-isolation.integration.test.ts
 * 覆盖，本测试只关心 PluginHost 的分派决策。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginState } from '../types.js';
import { createDb, makeHost, makeTmpDir, removeTmpDir, insertPluginRow, baseReq } from './helpers/audit-host.js';

/**
 * 形 enough 的 WorkerManager mock：只暴露 PluginHost 会调用的方法。
 *
 * 每次 createWorker 返回**新的** serviceHost，并用递增的 seq 标记归属 ——
 * 重载后派发必须落到新实例上（旧实例的 serviceHost 已被 terminate）。
 */
function createWorkerManagerMock() {
  let seq = 0;
  return {
    createWorker: vi.fn().mockImplementation(async () => {
      seq += 1;
      const current = seq;
      return {
        transport: {},
        serviceHost: {
          dispatchHttpRequest: vi.fn(async () => ({ status: 200, body: { seq: current } })),
        },
      };
    }),
    terminateWorker: vi.fn().mockResolvedValue(undefined),
  };
}

describe('F-1 · process 模式全生命周期走隔离路径', () => {
  let db: ReturnType<typeof createDb>;
  let pluginsDir: string;
  let host: Awaited<ReturnType<typeof makeHost>>;
  let wm: ReturnType<typeof createWorkerManagerMock>;

  beforeEach(async () => {
    db = createDb();
    pluginsDir = makeTmpDir('audit-f1-');
    wm = createWorkerManagerMock();
    host = await makeHost(db, pluginsDir);
  });

  afterEach(() => {
    removeTmpDir(pluginsDir);
    db.close();
  });

  const install = (executionMode: string, pluginId: string, manifestId: string) => {
    const manifest = { id: manifestId, name: manifestId, version: '1.0.0', main: 'index.js' };
    insertPluginRow(db, { id: pluginId, manifest, executionMode });
    host.setWorkerManager(wm as never);
    return manifest;
  };

  it('activate(process) → createWorker 收到 isolateKind: "process"', async () => {
    install('process', 'p1', 'ext-proc-1');
    await host.activatePlugin('p1');
    expect(host.getPluginState('p1')).toBe(PluginState.ACTIVE);
    expect(wm.createWorker).toHaveBeenCalledTimes(1);
    expect(wm.createWorker.mock.calls[0][7]).toEqual({ isolateKind: 'process' });
  });

  it('deactivate(process) → terminateWorker 被调用（修复前整段跳过）', async () => {
    install('process', 'p2', 'ext-proc-2');
    await host.activatePlugin('p2');
    await host.deactivatePlugin('p2');

    expect(host.getPluginState('p2')).toBe(PluginState.INACTIVE);
    // 修复前此断言为 0 —— 子进程在插件停用后仍运行
    expect(wm.terminateWorker).toHaveBeenCalledWith('p2');
  });

  it('uninstall(process) → 走 deactivateWorker，子进程在 DB 行删除前被回收', async () => {
    install('process', 'p3', 'ext-proc-3');
    await host.activatePlugin('p3');
    await host.uninstallPlugin('p3');

    expect(wm.terminateWorker).toHaveBeenCalledWith('p3');
    const row = db.prepare('SELECT id FROM plugins WHERE id = ?').get('p3');
    expect(row).toBeUndefined();
  });

  it('reload(process) → 不落入 inline 的 esmLoader.load，且重建用 process 原语', async () => {
    const manifest = install('process', 'p4', 'ext-proc-4');
    await host.activatePlugin('p4');

    // reloadPlugin 要求 ACTIVE；新源码须能 extract 出同 id 的 manifest。
    // TestLoader.load 会抛错 —— 若 reload 误入 inline 路径，此处必然暴露。
    const newSource = `export const manifest = ${JSON.stringify(manifest)};`;
    await host.reloadPlugin('p4', newSource).catch(() => {
      /* extractManifest 之后的重建细节不影响本断言的目的 */
    });

    expect(wm.createWorker.mock.calls.length).toBeGreaterThanOrEqual(2);
    const lastCall = wm.createWorker.mock.calls[wm.createWorker.mock.calls.length - 1];
    expect(lastCall[7]).toEqual({ isolateKind: 'process' });
  });

  it('reload(process) 成功后重新登记实例并回到 ACTIVE（否则更新后全部 API 503）', async () => {
    const manifest = install('process', 'p6', 'ext-proc-6');
    await host.activatePlugin('p6');

    const newSource = `export const manifest = ${JSON.stringify({ ...manifest, version: '1.1.0' })};`;
    await host.reloadPlugin('p6', newSource);

    // 修复前：terminateWorker 已杀掉旧子进程，但 pluginInstances 未重新登记，
    // 宿主状态也未恢复 —— 下发请求返回 503 "currently inactive"，历史数据页面全空。
    expect(host.getPluginState('p6')).toBe(PluginState.ACTIVE);
    const row = db.prepare('SELECT status FROM plugins WHERE id = ?').get('p6') as { status: string };
    expect(row.status).toBe('active');

    const res = await host.dispatchHttpRequest('p6', baseReq('/live') as never);
    expect(res.status).toBe(200);
    // 必须派发到**重建后**的实例（seq=2），而不是已 terminate 的旧实例
    expect((res.body as { seq: number }).seq).toBe(2);
  });

  it('对照：inline 模式不触碰 WorkerManager', async () => {
    const manifest = { id: 'ext-inline-1', name: 'Inline', version: '1.0.0', main: 'index.js' };
    insertPluginRow(db, { id: 'p5', manifest, executionMode: 'inline' });
    host.setWorkerManager(wm as never);
    host.registerPreloadedPlugin('p5', { manifest, activate: async () => {}, deactivate: async () => {} });

    await host.activatePlugin('p5');
    expect(host.getPluginState('p5')).toBe(PluginState.ACTIVE);
    expect(wm.createWorker).not.toHaveBeenCalled();
    expect(wm.terminateWorker).not.toHaveBeenCalled();
  });
});
