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

export function setSocketInstance(socket: Socket): void {
  _socket = socket;
}

export function getSocketInstance(): Socket {
  if (!_socket) {
    throw new Error('Socket instance not initialized. Call setSocketInstance() first.');
  }
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
