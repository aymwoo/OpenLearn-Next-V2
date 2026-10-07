/**
 * `IWorkerIsolate` 的 child_process 实现（L-1 P1 阶段 2）。
 *
 * 与 `ThreadIsolate` 的差别不只是「怎么终止」，还有**信号语义**：
 * `ChildProcess` 被 `SIGKILL` 时，`exit` 事件的 `code` 是 `null`（被信号杀死），
 * 而 `threadId` 那个实现永远拿不到信号。所以 `IWorkerIsolate.onExit` 的签名
 * 用 `number | null` —— 不是为了将来扩展，而是**现在就需要**。
 *
 * ## 为什么 `terminate()` 用 SIGKILL 而不是 SIGTERM
 *
 * 插件可能已经卡在同步死循环里，收不到 JS 层的信号处理器；`SIGTERM` 需要进程
 * 有机会处理它。L-1 要治的正是「处理不了」的情形，故默认 SIGKILL。
 *
 * 但 SIGKILL 无法被拦截 —— 包括插件想做的清理（如 flush）。因此提供两段式：
 * 先 `SIGTERM` 给一个宽限期（可配，默认 0 = 立即 SIGKILL），
 * 生产上可按需调宽。**默认立即强杀**是这个模块的保守选择：
 * 一个卡死的进程多活 1 秒，就多占 1 秒 CPU 槽位。
 */

import type { ChildProcess } from 'node:child_process';
import type { IWorkerIsolate } from './worker-isolate.js';

export class ChildProcessIsolate implements IWorkerIsolate {
  constructor(
    private readonly child: ChildProcess,
    /** SIGKILL 之前的 SIGTERM 宽限期（ms）。0 = 立即 SIGKILL（默认） */
    private readonly termGraceMs: number = 0,
  ) {}

  get isolateId(): string {
    // 用 pid 而不是 threadId：子进程没有线程概念
    return `proc:${this.child.pid ?? 'unknown'}`;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  onExit(handler: (code: number | null) => void): void {
    // ChildProcess 的 exit 参数本就是 (code: number|null, signal)，
    // 信号终止时 code 为 null —— 直接透传，不做任何「假装是 0」的处理。
    this.child.on('exit', (code) => handler(code));
  }

  onError(handler: (err: Error) => void): void {
    this.child.on('error', (err) => handler(err as Error));
  }

  async terminate(): Promise<unknown> {
    const pid = this.child.pid;
    if (pid === undefined) {
      // 进程还没起来就 terminate：没有可杀的 pid。
      // 主动 kill() 一次以清理 spawn 过程（Node 会保证不产生游离进程）。
      this.child.kill('SIGKILL');
      return undefined;
    }

    if (this.termGraceMs > 0) {
      this.child.kill('SIGTERM');
      await this.waitForExit(this.termGraceMs);
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        return this.child.exitCode;
      }
      // 宽限期内没退出 —— 它很可能已经卡在无法处理信号的地方
    }

    this.child.kill('SIGKILL');
    await this.waitForExit(2000);
    return this.child.exitCode;
  }

  /** 等待 exit/spawn 事件，最多 ms；超时则静默返回（调用方已强杀过） */
  private waitForExit(ms: number): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.child.off('exit', done);
        this.child.off('close', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      timer.unref?.();
      this.child.once('exit', done);
      this.child.once('close', done);
    });
  }
}