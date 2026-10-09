/**
 * 审计修复 R-1 回归：inline 模式 HTTP / SSE 派发的超时熔断。
 *
 * 修复前 `dispatchHttpRequest(pluginId, req, timeoutMs)` 的 inline 分支直接
 * `httpRouter.handle(req)` —— 网关传入的 5s timeoutMs 被静默丢弃；SSE 的
 * maxLifetimeMs（5min）同样不生效。插件一个不 resolve 的 handler 会永久
 * 占住 Express 连接与 socket。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginState } from '../types.js';
import { createDb, makeHost, makeTmpDir, removeTmpDir, insertPluginRow, baseReq, sleep } from './helpers/audit-host.js';

describe('R-1 · inline 派发超时熔断', () => {
  let db: ReturnType<typeof createDb>;
  let pluginsDir: string;
  let host: Awaited<ReturnType<typeof makeHost>>;

  beforeEach(() => {
    db = createDb();
    pluginsDir = makeTmpDir('audit-r1-');
  });

  afterEach(() => {
    removeTmpDir(pluginsDir);
    db.close();
  });

  const installSlowPlugin = async (delayMs: number, mode: 'http' | 'stream'): Promise<string> => {
    const pluginId = `slow-${Date.now()}`;
    const manifest = { id: 'ext-audit-slow', name: 'Slow', version: '1.0.0', main: 'index.js' };
    insertPluginRow(db, { id: pluginId, manifest });

    host = await makeHost(db, pluginsDir);
    host.registerPreloadedPlugin(pluginId, {
      manifest,
      activate: async (ctx: any) => {
        if (mode === 'http') {
          ctx.http.get('/slow', async () => {
            await sleep(delayMs);
            return { body: { ok: true } };
          });
        } else {
          ctx.http.stream('/slow-stream', async (_req: any, stream: any) => {
            await sleep(delayMs);
            stream.write({ done: true });
            stream.end();
          });
        }
      },
      deactivate: async () => {},
    });
    await host.activatePlugin(pluginId);
    expect(host.getPluginState(pluginId)).toBe(PluginState.ACTIVE);
    return pluginId;
  };

  it('dispatchHttpRequest：inline handler 超时后 reject（而非永久挂起）', async () => {
    const pluginId = await installSlowPlugin(500, 'http');
    await expect(host.dispatchHttpRequest(pluginId, baseReq('/slow') as never, 50)).rejects.toThrow(
      /timed out after 50ms/,
    );
  });

  it('dispatchHttpRequest：未超时时正常返回', async () => {
    const pluginId = await installSlowPlugin(10, 'http');
    const res = await host.dispatchHttpRequest(pluginId, baseReq('/slow') as never, 2000);
    expect(res.body).toEqual({ ok: true });
  });

  it('dispatchHttpStream：inline 流超过 maxLifetimeMs 后被关闭并收到 error', async () => {
    const pluginId = await installSlowPlugin(500, 'stream');
    const error = vi.fn();
    const stream = { isClosed: false, write: () => true, end: vi.fn(), error, onClose: () => {} };

    await host.dispatchHttpStream(pluginId, baseReq('/slow-stream') as never, stream as never, 50);

    expect(error).toHaveBeenCalledTimes(1);
    expect((error.mock.calls[0][0] as Error).message).toMatch(/timed out after 50ms/);
  });
});
