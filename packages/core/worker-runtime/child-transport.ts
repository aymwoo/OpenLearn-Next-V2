/**
 * `IWorkerTransport` 的 child_process 实现（L-1 P1 阶段 2）。
 *
 * 与 `NodeWorkerTransport` 的差异集中在两处，都是实测得出的：
 *
 * ## ① 必须显式 `serialization: 'advanced'`
 *
 * `process.send` 默认用 JSON，会把 bootstrap 送出的消息**静默降级**：
 * Date→string、Map/Set/RegExp/Error→`{}`、undefined 字段被丢、NaN/Infinity→null，
 * BigInt 与循环引用直接抛错。实测 13 个探针里 10 个不一致。
 *
 * `advanced`（v8.serialize）与 worker_threads 的 structuredClone **完全一致**（0/13）。
 * 该结论由 `ipc-serialization-parity.test.ts` 守着 —— 去掉这个选项测试会立刻红，
 * 而失效后果是运行期静默数据损坏。
 *
 * ## ② IPC 通道是 `'ipc'`，且只能有一个监听者
 *
 * 与 `postMessage` 通道一样，`onMessage` 是**单监听者**语义（每次注册替换上一次）。
 * 这与 `IWorkerTransport` 的契约一致，故不额外处理。
 */

import type { ChildProcess } from 'node:child_process';
import type { IWorkerTransport } from './types.js';

export class ChildProcessTransport implements IWorkerTransport {
  private handler: ((msg: any) => void) | null = null;
  private disposed = false;

  constructor(private readonly child: ChildProcess) {
    this.child.on('message', (msg) => {
      // 单监听者模式：未注册 handler 时直接丢弃（与 postMessage 通道的
      // 「消息在 handler 注册前到达会丢失」语义一致，不排队）。
      this.handler?.(msg);
    });
  }

  get id(): string {
    return `child:${this.child.pid ?? 'unknown'}`;
  }

  postMessage(msg: unknown): void {
    if (this.disposed) {
      throw new Error('ChildProcessTransport is disposed');
    }
    // channel 已由 spawn 时的 ipc 建立；这里不重复指定 serialization ——
    // 它是 **spawn 选项**，对双向都生效，无法在单条消息上覆盖。
    //
    // 签名不匹配（unknown → Serializable）是**接口契约**与 Node 类型定义的差异，
    // 不是可以靠断言消掉的类型错误：IWorkerTransport 要求接受 unknown，
    // 而 child.send 只接受可序列化值。真正的运行时约束是「序列化失败会抛」，
    // 那正是我们要的行为（早期失败优于静默丢数据），故在此显式转换。
    this.child.send(msg as Parameters<ChildProcess['send']>[0]);
  }

  onMessage(handler: (msg: any) => void): void {
    this.handler = handler;
  }

  async terminate(): Promise<void> {
    this.disposed = true;
    this.handler = null;
    // 终止由 IWorkerIsolate 负责（需要 SIGKILL 语义）；
    // transport 只解除自己的引用与监听。
    if (!this.child.killed) this.child.kill('SIGKILL');
  }
}