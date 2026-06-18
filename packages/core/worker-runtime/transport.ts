/**
 * IWorkerTransport 运输层实现。
 *
 * 提供跨运行时（Node.js Worker Thread / Browser Web Worker）的
 * Worker 通信封装。遵循 packages/core/esm-loader/node-loader.ts +
 * browser-loader.ts 的抽象+平台实现模式。
 *
 * ## 实现类
 *
 * - **NodeWorkerTransport** — 包装 node:worker_threads.Worker 的消息通道。
 *   使用 Worker.postMessage() / Worker.on('message') 进行通信。
 *   添加 onExit / onError 便利方法用于 Worker 生命周期管理。
 *
 * - **BrowserWorkerTransport** — Phase 5 仅含桩实现（stub），
 *   所有方法调用抛出 WorkerNotSupportedError。完全实现在 Phase 9。
 *
 * @module
 */

import type { IWorkerTransport } from './types.js';
import { WorkerTransportError, WorkerNotSupportedError } from './errors.js';

export type { IWorkerTransport } from './types.js';

// ── NodeWorkerTransport ──────────────────────────────────────────────────────

/**
 * NodeWorkerTransport — Node.js Worker Thread 运输层实现。
 *
 * 使用 node:worker_threads.Worker 实例进行双向消息通信。
 * 所有消息通过 structured clone 序列化。
 *
 * ## 错误处理
 * - postMessage 在 Worker 已终止时抛出 WorkerTransportError
 * - onMessage 注册单监听者（后续调用 replace 上次注册的 handler）
 * - terminate 委托给 worker.terminate() 返回的 Promise
 *
 * ## 便利方法
 * - onExit: 监听 Worker 退出事件（code: number）
 * - onError: 监听 Worker 错误事件（err: Error）
 */
export class NodeWorkerTransport implements IWorkerTransport {
  private messageHandler: ((msg: any) => void) | null = null;

  constructor(private readonly worker: import('node:worker_threads').Worker) {
    // 绑定 Worker 消息事件到已注册的 handler
    this.worker.on('message', (msg: unknown) => {
      if (this.messageHandler) {
        this.messageHandler(msg);
      }
    });
  }

  /**
   * 通过 Worker.postMessage() 发送消息到 Worker。
   * 消息必须为 structured clone 兼容类型。
   */
  postMessage(msg: unknown): void {
    try {
      this.worker.postMessage(msg);
    } catch (err) {
      throw new WorkerTransportError(
        `Failed to postMessage: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }

  /**
   * 注册消息处理器接收来自 Worker 的消息。
   * 单监听者模式：每次调用 replace 上次注册的 handler。
   */
  onMessage(handler: (msg: any) => void): void {
    this.messageHandler = handler;
  }

  /**
   * 终止 Worker。
   * 委托给 Worker.terminate() 并返回 Promise<void>。
   */
  async terminate(): Promise<void> {
    await this.worker.terminate();
  }

  /**
   * Worker 唯一标识符。
   * 格式: "worker:<threadId>"
   */
  get id(): string {
    return `worker:${this.worker.threadId}`;
  }

  /**
   * 监听 Worker 退出事件。
   * @param handler 接收退出码的回调函数（0 = 正常退出）
   */
  onExit(handler: (code: number) => void): void {
    this.worker.on('exit', handler);
  }

  /**
   * 监听 Worker 错误事件。
   * @param handler 接收 Error 的回调函数
   */
  onError(handler: (err: Error) => void): void {
    this.worker.on('error', handler);
  }
}

// ── BrowserWorkerTransport ────────────────────────────────────────────────────

/**
 * BrowserWorkerTransport — 浏览器端 Web Worker 运输层桩实现。
 *
 * Phase 5 中，浏览器 Web Worker 支持暂为 stub 状态。
 * 所有方法调用抛出 WorkerNotSupportedError。
 * 完全实现在 Phase 9（前端集成阶段）。
 */
export class BrowserWorkerTransport implements IWorkerTransport {
  constructor(private readonly _worker: unknown) {}

  postMessage(_msg: unknown): void {
    throw new WorkerNotSupportedError('BrowserWorkerTransport.postMessage');
  }

  onMessage(_handler: (msg: any) => void): void {
    throw new WorkerNotSupportedError('BrowserWorkerTransport.onMessage');
  }

  terminate(): Promise<void> {
    throw new WorkerNotSupportedError('BrowserWorkerTransport.terminate');
  }

  get id(): string {
    return 'browser-worker:stub';
  }
}
