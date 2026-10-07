/**
 * P1 阶段 1 回归测试：`WorkerRegistry` 不再依赖 `node:worker_threads`。
 *
 * ## 这个测试在证明什么
 *
 * 阶段 1 把 `WorkerInstance.worker`（`node:worker_threads.Worker`）换成
 * `isolate`（`IWorkerIsolate`）。此前注册表直接摸 `worker.threadId` /
 * `worker.on('exit')` / `worker.terminate()`，与 worker_threads **焊死** ——
 * 于是「P1 用子进程替代 worker_thread」在注册表这一层根本接不进来。
 *
 * 本测试的核心用例给注册表喂一个**完全不含 `threadId`、不含任何 worker_threads 痕迹**
 * 的对象，验证崩溃检测与终止仍然工作。
 * 这不是「新实现也能跑」，而是「注册表已经不知道 worker_threads 的存在」——
 * 若将来有人又把 `instance.isolate` 换回 `instance.worker`，本用例会立刻红。
 *
 * ## 附带的第二条回归：只写不读的 threadId Map
 *
 * 原先的 `workerByThreadId` 标注「用于崩溃检测」，但全仓只 `set` / `delete`，
 * 零读取点。它是「注册表依赖 threadId」的唯一来源，已随本次抽象删除。
 * 用下面的源码断言守住这个删除 —— 防止有人以「以后也许有用」为由加回来。
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { ThreadIsolate } from '../thread-isolate.js';
import { WorkerRegistry } from '../worker-manager.js';
import type { IWorkerIsolate } from '../worker-isolate.js';

const MGR_SRC = fs.readFileSync(path.resolve(process.cwd(), 'packages/core/worker-runtime/worker-manager.ts'), 'utf-8');

/**
 * 剥离注释后再做源码断言。
 *
 * 必要性：`cleanup()` 的文档注释里就写着 `workerByThreadId` 这个名字
 * （解释为何删除它）。直接对源码做 `includes` 会把注释当成代码 ——
 * 本轮已因此让「未加回来」那条用例误红过一次。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 构造一个**不含任何 worker_threads 形状**的 WorkerInstance。
 *
 * 刻意不提供 `threadId`、不提供 `on`、不提供 `worker` 字段 ——
 * 如果注册表还依赖它们，这里会直接抛错或行为异常。
 */
function makeForeignInstance(pluginId: string) {
  const ee = new EventEmitter();
  const terminate = vi.fn().mockResolvedValue(0);

  const isolate: IWorkerIsolate = {
    isolateId: `foreign:${pluginId}`,
    onExit: (handler) => ee.on('exit', handler),
    onError: (handler) => ee.on('error', handler),
    terminate,
  };

  const serviceHost = {
    handleMessage: vi.fn().mockResolvedValue(undefined),
    actorId: `plugin:${pluginId}`,
    dispose: vi.fn().mockResolvedValue(undefined),
  };

  return {
    instance: {
      pluginId,
      isolate,
      createdAt: Date.now(),
      status: 'running' as const,
      transport: {
        postMessage: vi.fn(),
        onMessage: vi.fn(),
        terminate: vi.fn().mockResolvedValue(undefined),
        id: `foreign:${pluginId}`,
      },
      serviceHost,
    } as never,
    ee,
    terminate,
  };
}

describe('P1 阶段 1 · WorkerRegistry 与 node:worker_threads 解耦', () => {
  it('注册表只依赖 IWorkerIsolate：不含 threadId 的实例也能走完崩溃链路', async () => {
    const registry = new WorkerRegistry();
    // 崩溃后要排定看门狗重启，需要 manifest / sourceCode / serviceTokens 三者齐备
    const restarted: string[] = [];
    registry.recreateWorkerCallback = async (pluginId: string) => {
      restarted.push(pluginId);
      return null;
    };

    const { instance, ee, terminate } = makeForeignInstance('ext-foreign');
    // 补齐崩溃重启所需字段（仍是纯数据，不含任何 worker_threads 形状）
    Object.assign(instance, {
      manifest: { id: 'ext-foreign', name: 'Foreign', version: '1.0.0' },
      sourceCode: 'export default {};',
      serviceTokens: [],
    });

    // 关键：这里没有任何 threadId。若注册表仍读 instance.worker.threadId，
    // 会在 register 这一行就炸（instance.worker 为 undefined）。
    registry.register('ext-foreign', instance);

    expect(registry.get('ext-foreign'), '注册应成功').toBeDefined();
    expect(registry.list()).toContain('ext-foreign');

    // 崩溃检测：非零退出码 → 标记 crashed → 清理注册 → 排定看门狗重启
    ee.emit('exit', 1);

    // 注：崩溃路径会 cleanup()，条目从 Map 中移除 —— 所以「检测到崩溃」的可观察
    // 表现不是 get() 返回 status，而是**条目消失 + 重启被排定**。
    // 初版断言 `get()?.status === 'crashed'` 是测错了对象：那行代码在 cleanup 之前
    // 执行，但随后条目就被删了，读不到。
    expect(registry.get('ext-foreign'), '崩溃后应从注册表移除').toBeUndefined();
    expect(registry.list()).not.toContain('ext-foreign');
    // 重启是 setTimeout 排定的（首次退避 1s），必须等 —— 同步断言会永远看到空数组。
    // 初版就是这么写的，表现为「崩溃后应排定看门狗重启: expected [] ...」。
    const deadline = Date.now() + 3000;
    while (restarted.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(restarted, '崩溃后应排定看门狗重启').toEqual(['ext-foreign']);
    // 服务端资源也应被清理（serviceHost.dispose）
    expect(
      (instance as unknown as { serviceHost: { dispose: () => Promise<void> } }).serviceHost.dispose,
    ).toHaveBeenCalled();
    void terminate;
  });

  it('零退出码且非 terminating 时不算崩溃（终止路径不会被误判）', () => {
    const registry = new WorkerRegistry();
    const { instance, ee } = makeForeignInstance('ext-clean');
    registry.register('ext-clean', instance);

    ee.emit('exit', 0);
    expect(registry.get('ext-clean')?.status, '正常退出不应算崩溃').not.toBe('crashed');
  });

  it('terminating 状态下的 exit 不触发崩溃（主动终止不是崩溃）', () => {
    const registry = new WorkerRegistry();
    const { instance, ee } = makeForeignInstance('ext-term');
    registry.register('ext-term', instance);
    (instance as { status: string }).status = 'terminating';

    ee.emit('exit', 0);
    expect((instance as { status: string }).status).toBe('terminating');
  });

  it('cleanup 幂等，且不再需要 threadId 即可移除', () => {
    const registry = new WorkerRegistry();
    const { instance } = makeForeignInstance('ext-cleanup');
    registry.register('ext-cleanup', instance);

    registry.cleanup('ext-cleanup');
    registry.cleanup('ext-cleanup');
    expect(registry.get('ext-cleanup')).toBeUndefined();
  });

  it('源码中注册表不再出现 worker_threads 专有 API', () => {
    // `createWorker` 里出现 `Worker` 是正常的（它是工厂，负责造 worker_threads 实例）。
    // 这里要守的是**注册表内部**不再触碰专有形状。
    const regStart = MGR_SRC.indexOf('export class WorkerRegistry {');
    const regEnd = MGR_SRC.indexOf('// ── Bootstrap code generator');
    expect(regStart).toBeGreaterThan(-1);
    expect(regEnd).toBeGreaterThan(regStart);

    const registrySrc = stripComments(MGR_SRC.slice(regStart, regEnd));
    expect(
      registrySrc.match(/\.threadId/g),
      'WorkerRegistry 仍出现 .threadId —— 说明又耦合回 worker_threads 了',
    ).toBeNull();
    expect(registrySrc.match(/instance\.worker\b/g), 'WorkerRegistry 仍直接访问 instance.worker').toBeNull();
  });

  it('只写不读的 workerByThreadId 未被加回来', () => {
    // 必须**剥离注释后再查**：cleanup() 的文档注释里提到了这个 Map 的名字
    // （解释为何删除），直接 includes 会误报 —— 这正是「断言测错对象」的一种。
    const codeOnly = stripComments(MGR_SRC);
    expect(
      codeOnly.includes('workerByThreadId'),
      'workerByThreadId 已被删除且零读取点 —— 若以「以后也许有用」为由加回来，' +
        '说明注册表又依赖上了 worker_threads 专有的 threadId',
    ).toBe(false);
  });
});

describe('P1 阶段 1 · ThreadIsolate 正确适配真实 Worker', () => {
  it('用真实 worker_threads.Worker 验证 isolateId / onExit / terminate', async () => {
    const w = new Worker("const {parentPort}=require('node:worker_threads');parentPort.postMessage(1);", {
      eval: true,
    });
    const isolate = new ThreadIsolate(w);

    expect(isolate.isolateId, 'isolateId 应基于 threadId 且带类型前缀').toMatch(/^thread:-?\d+$/);

    const exited = new Promise<number | null>((resolve) => isolate.onExit(resolve));
    await new Promise((r) => setTimeout(r, 100));
    await isolate.terminate();
    const code = await exited;

    expect(code, 'terminate 后应收到 exit 回调').not.toBeUndefined();
    expect(typeof isolate.terminate).toBe('function');
  }, 20_000);

  it('onError 不抛异常（注册本身不应因 handler 注册失败而崩）', () => {
    const fakeWorker = {
      threadId: 7,
      on: vi.fn(),
      terminate: vi.fn().mockResolvedValue(0),
    } as unknown as Worker;

    const isolate = new ThreadIsolate(fakeWorker);
    expect(() => isolate.onError(() => {})).not.toThrow();
    expect(() => isolate.onExit(() => {})).not.toThrow();
    expect(isolate.isolateId).toBe('thread:7');
  });
});
