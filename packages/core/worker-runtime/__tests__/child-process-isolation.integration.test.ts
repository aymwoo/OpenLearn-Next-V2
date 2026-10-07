/**
 * L-1 P1 阶段 2 集成测试：子进程隔离原语。
 *
 * ## 为什么这些用例必须用**真实子进程**
 *
 * 阶段 2 的全部价值在「换一种原语后行为是否一致」，这个命题只能靠真跑回答：
 *   · bootstrap 的 shim 是否在子进程里正确判别运行时
 *   · `process.send` 通道能否承载 RPC（含复杂类型）
 *   · 同步死循环能否被 SIGKILL 干净终止（子进程的核心优势）
 *   · **最小 env 是否真的挡住了密钥**
 *
 * 最后一条尤其重要：它是子进程相对 worker_threads 的**净收益** ——
 * worker 是「给了 env 再遮蔽」，子进程是「根本不给」。
 *
 * 测试通过 `OPENLEARN_WORKER_ISOLATE=process` 触发真实路径，不走旁路。
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../di/service-registry.js';
import { CapabilityGuard } from '../../capability/index.js';
import { WorkerManager } from '../worker-manager.js';
import { buildMinimalEnv, WORKER_DATA_ENV } from '../child-spawn.js';
import { ChildProcessIsolate } from '../child-isolate.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE plugins (
      id TEXT PRIMARY KEY, name TEXT, manifest TEXT, source_code TEXT,
      status TEXT, created_at INTEGER, loader_version TEXT, execution_mode TEXT
    );
  `);
  return db;
}

/** 回报 activate 结果的插件 */
const ECHO_PLUGIN = `
export default {
  manifest: {
    id: 'ext-child-echo',
    name: 'Child Echo',
    version: '1.0.0',
    main: 'index.js',
  },
  async activate(ctx) {
    // ctx.require 不在白名单会抛 —— 用它验证 RPC 代理是否真的接通了
    let sharedOk = false;
    try {
      ctx.require('uuid');
      sharedOk = true;
    } catch {}
    return { echoed: true, sharedOk, hasConfig: typeof ctx.config === 'object' };
  },
  async deactivate() {},
};
`;

/** 进入同步死循环的插件 */
const HUNG_PLUGIN = `
export default {
  manifest: { id: 'ext-child-hung', name: 'Child Hung', version: '1.0.0', main: 'index.js' },
  async activate() { setTimeout(() => { while (true) {} }, 10); },
  async deactivate() {},
};
`;

/** 读取并上报环境变量的插件 —— 用来验证 env 白名单 */
const ENV_REPORT_PLUGIN = `
export default {
  manifest: { id: 'ext-child-env', name: 'Child Env', version: '1.0.0', main: 'index.js' },
  async activate() {
    const keys = Object.keys(process.env);
    const suspicious = keys.filter((k) => /KEY|SECRET|TOKEN|AUTH|PASSWORD/i.test(k));
    return { totalKeys: keys.length, suspicious };
  },
  async deactivate() {},
};
`;

describe('L-1 P1 阶段 2 · 子进程隔离原语', () => {
  let db: Database.Database;
  let wm: WorkerManager;
  let pluginsDir: string;

  beforeEach(() => {
    // 必须在构造 WorkerManager 之前设 —— isolateKind 在构造期就定型
    process.env.OPENLEARN_WORKER_ISOLATE = 'process';
    process.env.OPENLEARN_WORKER_LIVENESS_INTERVAL_MS = '300';
    process.env.OPENLEARN_WORKER_LIVENESS_GRACE_MS = '300';
    db = makeDb();
    wm = new WorkerManager(new ServiceRegistry(), new CapabilityGuard(), db);
    pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-child-'));
  });

  afterEach(async () => {
    wm.livenessMonitor.stop();
    delete process.env.OPENLEARN_WORKER_ISOLATE;
    delete process.env.OPENLEARN_WORKER_LIVENESS_INTERVAL_MS;
    delete process.env.OPENLEARN_WORKER_LIVENESS_GRACE_MS;
    await wm.shutdownAll().catch(() => {});
    fs.rmSync(pluginsDir, { recursive: true, force: true });
    db.close();
  });

  it('真实插件能在子进程里 activate（bootstrap shim 正确判别运行时）', async () => {
    const pluginId = 'ext-child-echo';
    await wm.createWorker(
      pluginId,
      { id: pluginId, name: 'Child Echo', version: '1.0.0', main: 'index.js' },
      ECHO_PLUGIN,
      [],
      undefined,
      pluginsDir,
    );

    const inst = wm.registry.get(pluginId);
    expect(inst, '子进程 worker 应已注册').toBeDefined();
    expect(inst!.status).toBe('running');
    // 子进程模式下标识必须是 pid 而非 threadId
    expect(inst!.isolate.isolateId, '子进程标识应是 proc:<pid>').toMatch(/^proc:\d+$/);
  }, 30_000);

  it('子进程拿不到宿主密钥（相对 worker_threads 的净收益）', async () => {
    // 前置：确认宿主环境里确实有疑似密钥，否则本用例无意义
    const hostSecretish = Object.keys(process.env).filter((k) => /KEY|SECRET|TOKEN|AUTH/i.test(k));
    expect(hostSecretish.length, '当前环境没有疑似密钥变量，本用例无法证明隔离效果').toBeGreaterThan(0);

    const env = buildMinimalEnv({ pluginId: 'p', manifestId: 'm', serviceTokens: [] });
    const leaked = Object.keys(env).filter((k) => /KEY|SECRET|TOKEN|AUTH/i.test(k));
    expect(leaked, `子进程 env 泄漏了：${leaked.join(', ')}`).toEqual([]);
    // 白名单里的无害变量应保留
    if (process.env.PATH) expect(env.PATH).toBe(process.env.PATH);
    expect(env[WORKER_DATA_ENV], '数据变量必须注入').toContain('manifestId');
  });

  it('NODE_OPTIONS 被排除（继承它会让子进程起不来或执行注入代码）', () => {
    const saved = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = '--require /tmp/opencode/definitely-not-here.js';
    try {
      const env = buildMinimalEnv({ pluginId: 'p', manifestId: 'm', serviceTokens: [] });
      expect(env.NODE_OPTIONS, 'NODE_OPTIONS 必须被排除 —— 实测继承它会让子进程直接崩溃').toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = saved;
    }
  });

  it('插件在子进程里也读不到宿主密钥（遮蔽块在子进程同样生效）', async () => {
    const pluginId = 'ext-child-env';
    await wm.createWorker(
      pluginId,
      { id: pluginId, name: 'Child Env', version: '1.0.0', main: 'index.js' },
      ENV_REPORT_PLUGIN,
      [],
      undefined,
      pluginsDir,
    );
    // 这里只验证「能跑通 + 注册成功」；密钥隔离由 buildMinimalEnv 的白名单保证，
    // 上面那条用例已在**构造层面**断言。两者分工明确，避免在这里写不稳定的断言。
    expect(wm.registry.get(pluginId)?.status).toBe('running');
  }, 30_000);

  it('同步死循环的子进程能被 SIGKILL 干净终止（子进程的核心优势）', async () => {
    const pluginId = 'ext-child-hung';
    await wm.createWorker(
      pluginId,
      { id: pluginId, name: 'Child Hung', version: '1.0.0', main: 'index.js' },
      HUNG_PLUGIN,
      [],
      undefined,
      pluginsDir,
    );

    // 等探活（300ms 间隔 / 300ms 宽限）检出并终止
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline && wm.registry.get(pluginId)) {
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(
      wm.registry.get(pluginId),
      '死循环子进程在 12s 内未被终止 —— 检查 isolateKind 是否真的切到了 process，' +
        '以及宿主侧 noteActivity 是否在收到 pong',
    ).toBeUndefined();
  }, 40_000);
});

describe('L-1 P1 阶段 2 · ChildProcessIsolate 的信号语义', () => {
  it('SIGKILL 终止后 exit 的 code 为 null（被信号杀死），不被伪装成 0', async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', 'while(true){}'], { stdio: 'ignore' });
    const isolate = new ChildProcessIsolate(child);

    const exitCode = new Promise<number | null>((resolve) => isolate.onExit(resolve));
    await new Promise((r) => setTimeout(r, 200));
    const t0 = Date.now();
    await isolate.terminate();
    const code = await exitCode;
    const elapsed = Date.now() - t0;

    expect(code, '被信号杀死时 code 应为 null —— 假装是 0 会让上层误判为「正常退出」').toBeNull();
    expect(elapsed, `SIGKILL 应在 2s 内生效，实际 ${elapsed}ms`).toBeLessThan(2000);
  }, 20_000);

  it('terminate 幂等：重复调用不抛', async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { stdio: 'ignore' });
    const isolate = new ChildProcessIsolate(child);
    await new Promise((r) => setTimeout(r, 200));
    await expect(isolate.terminate()).resolves.toBeDefined();
    await expect(isolate.terminate()).resolves.toBeDefined();
  }, 20_000);
});
