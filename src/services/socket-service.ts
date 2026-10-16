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

export function setSocketInstance(socket: Socket | null): void {
  _socket = socket;
  if (!socket) return;
  for (const listener of _socketReadyListeners) {
    try {
      listener(socket);
    } catch (e) {
      console.error('[socket-service] socket-ready listener error:', e);
    }
  }
}

/**
 * 订阅「socket 就绪与换绑」；若当前已有可用 socket 实例，则立即同步调用一次。
 * 当后续发生 socket 重连、切换实例时，将自动通知所有活跃订阅者进行解绑与换绑。
 *
 * @returns 取消订阅函数。
 */
export function onSocketInstance(listener: (socket: Socket) => void): () => void {
  _socketReadyListeners.add(listener);
  if (_socket) {
    try {
      listener(_socket);
    } catch (e) {
      console.error('[socket-service] socket listener error:', e);
    }
  }
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
