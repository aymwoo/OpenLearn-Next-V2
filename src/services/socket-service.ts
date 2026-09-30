/**
 * SocketService — Socket.IO client wrapper.
 *
 * Wraps an existing socket.io-client instance (from App.tsx's existing `io()`
 * connection). Per RESEARCH.md OQ#2, this does NOT create a new connection;
 * instead it wraps the existing socket instance so plugins can emit/listen
 * without interfering with App.tsx's own event handlers.
 *
 * All methods are thin delegations to the underlying socket.
 */

import type { Socket } from 'socket.io-client';
import type { ISocketService } from '../plugin-host/types';

/** 模块级 Socket 单例引用，由 App.tsx 在创建 Socket 后设置 */
let _socket: Socket | null = null;

/** 等待 socket 就绪的订阅者。用于「消费者比 socket 更早诞生」的场景。 */
const _socketReadyListeners = new Set<(socket: Socket) => void>();

export function setSocketInstance(socket: Socket): void {
  _socket = socket;
  for (const listener of _socketReadyListeners) {
    try {
      listener(socket);
    } catch (e) {
      console.error('[socket-service] socket-ready listener error:', e);
    }
  }
}

/**
 * 订阅「socket 就绪」；若已就绪则**立即同步调用一次**。
 *
 * 为什么需要它：socket 在 `useClassroomSocket` 的 effect 里才注入，而 React 的
 * passive effect 是**子先于父**执行的 —— 任何在子组件 effect 里想挂 socket 监听的
 * 代码，拿到的都是 null 且**不会报错**。历史上 `ClassroomSyncChannel` 就栽在这里：
 * 「发」正常、「收」永久静默失效。
 *
 * 正确用法：
 * ```ts
 * useEffect(() => {
 *   let detach: (() => void) | null = null;
 *   const off = onSocketInstance((socket) => {
 *     detach?.();
 *     const handler = (d) => console.log(d);
 *     socket.on('some-event', handler);
 *     detach = () => socket.off('some-event', handler);
 *   });
 *   return () => { off(); detach?.(); };
 * }, []);
 * ```
 *
 * @returns 取消订阅函数（已就绪时的立即回调也会被它一并回滚，见上例）。
 */
export function onSocketInstance(listener: (socket: Socket) => void): () => void {
  if (_socket) {
    listener(_socket);
    return () => {};
  }
  _socketReadyListeners.add(listener);
  return () => {
    _socketReadyListeners.delete(listener);
  };
}

export function getSocketInstance(): Socket {
  if (!_socket) {
    throw new Error('Socket instance not initialized. Call setSocketInstance() first.');
  }
  return _socket;
}

export function getOptionalSocket(): Socket | null {
  return _socket;
}

export class SocketService implements ISocketService {
  private socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;
    setSocketInstance(socket);
  }

  emit(event: string, ...args: any[]): void {
    this.socket.emit(event, ...args);
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this.socket.on(event, handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    this.socket.off(event, handler);
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
