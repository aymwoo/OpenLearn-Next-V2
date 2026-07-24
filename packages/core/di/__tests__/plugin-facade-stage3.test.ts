/**
 * P7-A2 Stage 3 — Plugin facade delegation tests.
 *
 * Verifies that PluginLifecycleManager / PluginDistributionManager are faithful
 * 1:1 delegators over the real PluginHost (including executionMode forwarding),
 * so rerouting server.ts / builtin.ts consumers onto the facades is behavior-preserving.
 *
 * NOTE: DI wiring (Kernel registering facades into serviceRegistry) is asserted in
 * interfaces.test.ts, which already constructs Kernel and tolerates the async
 * bootstrap noise of `new Kernel()` in this environment.
 */
import { describe, it, expect, vi } from 'vitest';
import { PluginLifecycleManager } from '../../plugin-host/plugin-lifecycle-manager.js';
import { PluginDistributionManager } from '../../plugin-host/plugin-distribution-manager.js';

describe('P7-A2 Stage 3 — facade 委托行为保持兼容', () => {
  it('PluginLifecycleManager 把 listPlugins / uninstallPlugin 委托给 PluginHost', () => {
    const fakeHost: any = {
      listPlugins: vi.fn(() => [{ id: 'p1', state: 'active' }]),
      uninstallPlugin: vi.fn(async () => undefined),
    };
    const mgr = new PluginLifecycleManager(fakeHost);

    const list = mgr.listPlugins();
    expect(fakeHost.listPlugins).toHaveBeenCalledOnce();
    expect(list).toEqual([{ id: 'p1', state: 'active' }]);

    void mgr.uninstallPlugin('p1');
    expect(fakeHost.uninstallPlugin).toHaveBeenCalledWith('p1');
  });

  it('PluginDistributionManager.installFromZip 转发 executionMode', async () => {
    const fakeHost: any = {
      installPluginFromZip: vi.fn(async (buf: Buffer, mode?: string) => ({ id: 'p1', mode })),
    };
    const mgr = new PluginDistributionManager(fakeHost);

    const res = await mgr.installFromZip(Buffer.from('x'), 'worker');
    expect(fakeHost.installPluginFromZip).toHaveBeenCalledWith(Buffer.from('x'), 'worker');
    expect(res).toEqual({ pluginId: 'p1', manifest: { id: 'p1', mode: 'worker' } });
  });
});
