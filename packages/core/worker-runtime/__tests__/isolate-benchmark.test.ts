/**
 * 启动成本实测：worker_threads vs child_process。
 *
 * ## 为什么必须实测
 *
 * L-1 提案原文写「子进程启动 ~50ms vs worker ~15ms」。那是**估算**，从未验证。
 * 启动成本直接影响阶段 3 的可行性判断：如果子进程实际是 200ms 而非 50ms，
 * 每次插件激活都要多等那么久，结论会不一样。
 *
 * ## 测量方法
 *
 * 走**真实创建路径**（`WorkerManager.createWorker`），而不是 new Worker / spawn 的裸基准 ——
 * 裸基准只测内核调用，测不到 bootstrap 编译、进程启动、模块加载的实际开销。
 *
 * 每种原语取多轮并报告中位数：单次测量受磁盘缓存与调度抖动影响太大，
 * 而「启动很慢」这种结论一旦错了会直接带偏排期。
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ServiceRegistry } from '../../di/service-registry.js';
import { CapabilityGuard } from '../../capability/index.js';
import { WorkerManager } from '../worker-manager.js';

const PLUGIN = `
export default {
  manifest: { id: 'ext-bench', name: 'Bench', version: '1.0.0', main: 'index.js' },
  async activate() { return 'ok'; },
  async deactivate() {},
};
`;

const MANIFEST = { id: 'ext-bench', name: 'Bench', version: '1.0.0', main: 'index.js' } as never;

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE plugins (
    id TEXT PRIMARY KEY, name TEXT, manifest TEXT, source_code TEXT,
    status TEXT, created_at INTEGER, loader_version TEXT, execution_mode TEXT)`);
  return db;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function bench(kind: 'thread' | 'process', rounds: number): Promise<number[]> {
  process.env.OPENLEARN_WORKER_ISOLATE = kind;
  const db = makeDb();
  const wm = new WorkerManager(new ServiceRegistry(), new CapabilityGuard(), db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `openlearn-bench-${kind}-`));
  const times: number[] = [];
  try {
    // 第 1 轮作为预热（填充模块缓存 / 磁盘缓存），不计入
    for (let i = 0; i <= rounds; i++) {
      const id = `p-${kind}-${i}`;
      const t0 = performance.now();
      await wm.createWorker(id, { ...(MANIFEST as object), id } as never, PLUGIN, [], undefined, dir, undefined, {
        isolateKind: kind,
      });
      const dt = performance.now() - t0;
      if (i > 0) times.push(dt);
      await wm.terminateWorker(id).catch(() => {});
    }
  } finally {
    wm.livenessMonitor.stop();
    await wm.shutdownAll().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
    db.close();
  }
  return times;
}

describe('L-1 P1 阶段 3 · 两种隔离原语的启动成本对比', () => {
  const savedIsolate = process.env.OPENLEARN_WORKER_ISOLATE;

  beforeAll(() => {
    // 探活会与基准抢 CPU，测量期间关掉
    process.env.OPENLEARN_WORKER_LIVENESS = 'off';
  });

  afterAll(() => {
    if (savedIsolate === undefined) delete process.env.OPENLEARN_WORKER_ISOLATE;
    else process.env.OPENLEARN_WORKER_ISOLATE = savedIsolate;
    delete process.env.OPENLEARN_WORKER_LIVENESS;
  });

  it('子进程模式的启动成本可量化，且未被高到不可接受', async () => {
    const thread = await bench('thread', 5);
    const process_ = await bench('process', 5);

    const tMed = median(thread);
    const pMed = median(process_);

    // eslint-disable-next-line no-console
    console.log(
      `[启动成本实测] worker_threads 中位数 ${tMed.toFixed(1)}ms ` +
        `(各轮: ${thread.map((x) => x.toFixed(0)).join(', ')}) | ` +
        `child_process 中位数 ${pMed.toFixed(1)}ms ` +
        `(各轮: ${process_.map((x) => x.toFixed(0)).join(', ')}) | ` +
        `比值 ${(pMed / Math.max(tMed, 0.001)).toFixed(2)}×`,
    );

    // 断言写成「记录事实 + 设一个宽松上限」，而不是断言某个具体比值：
    // 比值依赖机器与并发负载，钉死会让测试在 CI 上偶发失败。
    // 上限取 1.5s —— 超过这个量级说明进程隔离在激活路径上不可用，
    // 那时才需要重新设计（例如常驻进程池）。
    expect(pMed, `子进程启动中位数 ${pMed.toFixed(0)}ms 超过 1500ms 上限，进程隔离在激活路径上不可用`).toBeLessThan(
      1500,
    );
    expect(thread.length).toBe(5);
    expect(process_.length).toBe(5);
  }, 120_000);
});

describe('L-1 P1 阶段 3 · 两种原语在同一进程内共存', () => {
  const savedIsolate = process.env.OPENLEARN_WORKER_ISOLATE;
  let db: Database.Database;
  let wm: WorkerManager;
  let dir: string;

  beforeAll(() => {
    // Manager 级默认用 thread，个别实例用 process —— 共存是阶段 3 的核心能力
    process.env.OPENLEARN_WORKER_ISOLATE = 'thread';
    process.env.OPENLEARN_WORKER_LIVENESS = 'off';
    db = makeDb();
    wm = new WorkerManager(new ServiceRegistry(), new CapabilityGuard(), db);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-coexist-'));
  });

  afterAll(async () => {
    wm.livenessMonitor.stop();
    if (savedIsolate === undefined) delete process.env.OPENLEARN_WORKER_ISOLATE;
    else process.env.OPENLEARN_WORKER_ISOLATE = savedIsolate;
    delete process.env.OPENLEARN_WORKER_LIVENESS;
    await wm.shutdownAll().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
    db.close();
  });

  it('thread 与 process 两种实例可同时存活且各自终止', async () => {
    const PL = (id: string) => `
export default {
  manifest: { id: '${id}', name: '${id}', version: '1.0.0', main: 'index.js' },
  async activate() { return 'ok'; },
  async deactivate() {},
};
`;

    await wm.createWorker(
      'c-thread',
      { id: 'c-thread', name: 't', version: '1.0.0', main: 'index.js' } as never,
      PL('c-thread'),
      [],
      undefined,
      dir,
      undefined,
      { isolateKind: 'thread' },
    );
    await wm.createWorker(
      'c-proc',
      { id: 'c-proc', name: 'p', version: '1.0.0', main: 'index.js' } as never,
      PL('c-proc'),
      [],
      undefined,
      dir,
      undefined,
      { isolateKind: 'process' },
    );

    const t = wm.registry.get('c-thread');
    const p = wm.registry.get('c-proc');
    expect(t?.status, 'thread 实例应 running').toBe('running');
    expect(p?.status, 'process 实例应 running').toBe('running');

    // 两种原语的标识形态不同 —— 这正是「归一到 IWorkerIsolate」之前的差异
    expect(t!.isolate.isolateId).toMatch(/^thread:-?\d+$/);
    expect(p!.isolate.isolateId).toMatch(/^proc:\d+$/);

    // 单独终止其中一个，另一个不受影响
    await wm.terminateWorker('c-proc');
    expect(wm.registry.get('c-proc'), 'process 实例应已移除').toBeUndefined();
    expect(wm.registry.get('c-thread')?.status, 'thread 实例不应被连带终止').toBe('running');
  }, 60_000);
});
