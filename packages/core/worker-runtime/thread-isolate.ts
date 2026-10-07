/**
 * `IWorkerIsolate` 的 worker_threads 实现（P1 · 阶段 1）。
 *
 * 这一层存在的唯一意义是**把 `node:worker_threads` 的专有形状关起来**：
 * `threadId`、`'exit'`/`'error'` 字符串事件名、`terminate()` 的返回类型
 * （`Promise<number>`）都止步于此。上层（`WorkerRegistry`）只看到
 * `IWorkerIsolate` 的四个成员。
 *
 * P1 阶段 2 会新增一个 `ChildProcessIsolate`，届时两者可互换 ——
 * 而 `WorkerRegistry` 一行都不用改。这正是阶段 1 要买到的东西。
 */

import type { Worker } from 'node:worker_threads';
import type { IWorkerIsolate } from './worker-isolate.js';

/** 把 `node:worker_threads.Worker` 适配为 `IWorkerIsolate` */
export class ThreadIsolate implements IWorkerIsolate {
  constructor(private readonly worker: Worker) {}

  /**
   * 不用 `worker.threadId` —— 它在 worker 终止后会变成 `-1`，
   * 拿它当标识会与「下一个 worker 恰好也是 -1」撞车。
   * `worker.threadId` 是唯一稳定的运行时内标识，但仍只用于日志/诊断。
   */
  get isolateId(): string {
    return `thread:${this.worker.threadId}`;
  }

  onExit(handler: (code: number | null) => void): void {
    this.worker.on('exit', (code) => handler(code));
  }

  onError(handler: (err: Error) => void): void {
    this.worker.on('error', (err) => handler(err as Error));
  }

  async terminate(): Promise<unknown> {
    // 返回 Promise<number>（退出码）；上界统一为 unknown，各实现自选
    return await this.worker.terminate();
  }
}