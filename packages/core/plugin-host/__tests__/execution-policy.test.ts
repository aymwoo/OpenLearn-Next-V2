/**
 * 审计 H-4：未受信任插件不能留在宿主进程里。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { isTrustedInProcessPlugin, resolvePluginExecutionMode } from '../execution-policy.js';
import { PluginState } from '../types.js';
import { createDb, makeHost, makeTmpDir, removeTmpDir, insertPluginRow } from './helpers/audit-host.js';

const ENV_KEYS = ['VITEST', 'OPENLEARN_ENFORCE_PLUGIN_ISOLATION', 'OPENLEARN_TRUSTED_INLINE_PLUGINS'] as const;

describe('第三方插件执行模式策略', () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function rememberEnv() {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  }

  it('生产语义：只有 @openlearn 或管理员白名单可以进程内运行', () => {
    rememberEnv();
    delete process.env.VITEST;
    delete process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION;
    delete process.env.OPENLEARN_TRUSTED_INLINE_PLUGINS;

    expect(isTrustedInProcessPlugin('@openlearn/plugin-vfs')).toBe(true);
    expect(isTrustedInProcessPlugin('ext-homework-hub')).toBe(false);
    expect(resolvePluginExecutionMode('ext-homework-hub', undefined).mode).toBe('process');
    expect(resolvePluginExecutionMode('ext-homework-hub', 'inline')).toEqual(
      expect.objectContaining({ mode: 'process', coerced: true }),
    );
    expect(resolvePluginExecutionMode('ext-homework-hub', 'worker')).toEqual(
      expect.objectContaining({ mode: 'process', coerced: true }),
    );
    expect(resolvePluginExecutionMode('ext-homework-hub', 'process')).toEqual(
      expect.objectContaining({ mode: 'process', coerced: false }),
    );
    expect(resolvePluginExecutionMode('@openlearn/plugin-vfs', 'inline').mode).toBe('inline');
    expect(resolvePluginExecutionMode('@openlearn/plugin-vfs', 'worker').mode).toBe('worker');

    process.env.OPENLEARN_TRUSTED_INLINE_PLUGINS = ' ext-local , ext-other ';
    expect(resolvePluginExecutionMode('ext-local', 'inline')).toEqual(
      expect.objectContaining({ mode: 'inline', coerced: false }),
    );
    expect(resolvePluginExecutionMode('ext-other', 'worker').mode).toBe('worker');
    expect(resolvePluginExecutionMode('ext-unlisted', 'inline').mode).toBe('process');
  });

  it('Vitest 默认放行夹具，OPENLEARN_ENFORCE_PLUGIN_ISOLATION=1 时恢复生产策略', () => {
    rememberEnv();
    process.env.VITEST = 'true';
    delete process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION;
    expect(resolvePluginExecutionMode('ext-fixture', 'inline').mode).toBe('inline');

    process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION = '1';
    expect(resolvePluginExecutionMode('ext-fixture', 'inline').mode).toBe('process');
    expect(resolvePluginExecutionMode('@openlearn/plugin-builtin', 'inline').mode).toBe('inline');
  });

  it('激活未受信任插件时改写 DB 并走子进程原语', async () => {
    rememberEnv();
    process.env.VITEST = 'true';
    process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION = '1';
    delete process.env.OPENLEARN_TRUSTED_INLINE_PLUGINS;

    const db = createDb();
    const pluginsDir = makeTmpDir('exec-policy-');
    const host = await makeHost(db, pluginsDir);
    const createWorker = viCreateWorker();
    host.setWorkerManager({ createWorker, terminateWorker: async () => undefined } as never);

    const manifest = {
      id: 'ext-community',
      name: 'Community',
      version: '1.0.0',
      main: 'index.js',
      executionMode: 'inline',
    };
    insertPluginRow(db, { id: 'p-community', manifest, executionMode: 'inline' });

    await host.activatePlugin('p-community', { mode: 'inline' });

    expect(host.getPluginState('p-community')).toBe(PluginState.ACTIVE);
    expect(createWorker.calls[0]?.isolateKind).toBe('process');
    const row = db.prepare('SELECT execution_mode FROM plugins WHERE id = ?').get('p-community') as {
      execution_mode: string;
    };
    expect(row.execution_mode).toBe('process');

    removeTmpDir(pluginsDir);
    db.close();
  });

  it('预加载的宿主代码即使 id 不是 @openlearn 也保持进程内', async () => {
    rememberEnv();
    process.env.VITEST = 'true';
    process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION = '1';

    const db = createDb();
    const pluginsDir = makeTmpDir('exec-policy-pre-');
    const host = await makeHost(db, pluginsDir);
    const createWorker = viCreateWorker();
    host.setWorkerManager({ createWorker, terminateWorker: async () => undefined } as never);

    const manifest = { id: 'ext-preloaded', name: 'Pre', version: '1.0.0', main: 'index.js' };
    host.registerPreloadedPlugin('ext-preloaded', { manifest, activate: async () => {}, deactivate: async () => {} });
    await host.activatePlugin('ext-preloaded', { mode: 'inline' });

    expect(host.getPluginState('ext-preloaded')).toBe(PluginState.ACTIVE);
    expect(createWorker.calls).toHaveLength(0);

    removeTmpDir(pluginsDir);
    db.close();
  });

  it('恢复活跃插件时把库里的 inline 第三方改写成 process', async () => {
    rememberEnv();
    process.env.VITEST = 'true';
    process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION = '1';

    const db = createDb();
    const pluginsDir = makeTmpDir('exec-policy-restore-');
    const host = await makeHost(db, pluginsDir);
    host.setWorkerManager({
      createWorker: async () => {
        throw new Error('isolate-start-failed');
      },
      terminateWorker: async () => undefined,
    } as never);

    const manifest = { id: 'ext-old', name: 'Old', version: '1.0.0', main: 'index.js' };
    insertPluginRow(db, { id: 'p-old', manifest, executionMode: 'worker', status: 'active' });

    await host.restoreActivePlugins();

    const row = db.prepare('SELECT execution_mode FROM plugins WHERE id = ?').get('p-old') as {
      execution_mode: string;
    };
    expect(row.execution_mode).toBe('process');

    removeTmpDir(pluginsDir);
    db.close();
  });
});

function viCreateWorker() {
  const calls: Array<{ isolateKind?: string }> = [];
  const createWorker = async (...args: unknown[]) => {
    const opts = args[7] as { isolateKind?: string } | undefined;
    calls.push({ isolateKind: opts?.isolateKind });
    return { transport: {}, serviceHost: {} };
  };
  return Object.assign(createWorker, { calls });
}
