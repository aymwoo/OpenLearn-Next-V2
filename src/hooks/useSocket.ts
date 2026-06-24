/**
 * Socket.IO 连接管理 Hook
 *
 * Phase 19 - FE-REFACTOR-02
 * 统一管理 Socket.IO 连接生命周期、事件订阅/取消
 */
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseSocketOptions {
  /** 服务器 URL（默认当前 origin） */
  serverUrl?: string;
  /** 是否自动连接（默认 true） */
  autoConnect?: boolean;
}

interface UseSocketResult {
  socket: Socket | null;
  /** 订阅事件（返回取消函数） */
  on: (event: string, handler: (...args: any[]) => void) => () => void;
  /** 发送事件 */
  emit: (event: string, ...args: any[]) => void;
  /** 是否已连接 */
  connected: boolean;
}

export function useSocket(options: UseSocketOptions = {}): UseSocketResult {
  const { serverUrl, autoConnect = true } = options;
  const socketRef = useRef<Socket | null>(null);
  const connectedRef = useRef(false);
  const subscriptionsRef = useRef<Array<{ event: string; handler: (...args: any[]) => void }>>([]);

  useEffect(() => {
    if (!autoConnect) return;

    const socket = io(serverUrl || window.location.origin, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      connectedRef.current = true;
    });

    socket.on('disconnect', () => {
      connectedRef.current = false;
    });

    return () => {
      // 清理所有订阅
      subscriptionsRef.current.forEach(({ event, handler }) => {
        socket.off(event, handler);
      });
      subscriptionsRef.current = [];
      socket.disconnect();
      socketRef.current = null;
    };
  }, [autoConnect, serverUrl]);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    const socket = socketRef.current;
    if (!socket) return () => {};
    socket.on(event, handler);
    subscriptionsRef.current.push({ event, handler });
    return () => {
      socket.off(event, handler);
      subscriptionsRef.current = subscriptionsRef.current.filter(
        s => s.event !== event || s.handler !== handler,
      );
    };
  }, []);

  const emit = useCallback((event: string, ...args: any[]) => {
    socketRef.current?.emit(event, ...args);
  }, []);

  return {
    socket: socketRef.current,
    on,
    emit,
    connected: connectedRef.current,
  };
}
