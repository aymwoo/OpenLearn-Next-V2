import { describe, it, expect, beforeEach, vi } from 'vitest';
import { onSocketInstance, setSocketInstance, getOptionalSocket, getSocketInstance } from '../socket-service';
import type { Socket } from 'socket.io-client';

describe('SocketService & onSocketInstance 生命周期与换绑测试 (HIGH-05)', () => {
  beforeEach(() => {
    setSocketInstance(null);
  });

  it('在 socket 为 null 时注册监听器，当 setSocketInstance 被调用时收到通知', () => {
    const fakeSocket = { id: 's1' } as unknown as Socket;
    const calls: Socket[] = [];

    const unsubscribe = onSocketInstance((s) => {
      calls.push(s);
    });

    expect(calls.length).toBe(0);

    setSocketInstance(fakeSocket);
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(fakeSocket);

    unsubscribe();
  });

  it('在 socket 已存在时注册监听器，立即同步触发，且在实例替换时仍能收到新实例通知', () => {
    const fakeSocket1 = { id: 's1' } as unknown as Socket;
    const fakeSocket2 = { id: 's2' } as unknown as Socket;
    setSocketInstance(fakeSocket1);

    const calls: Socket[] = [];
    const unsubscribe = onSocketInstance((s) => {
      calls.push(s);
    });

    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(fakeSocket1);

    // 模拟断线重连或切换身份产生的换绑
    setSocketInstance(fakeSocket2);
    expect(calls.length).toBe(2);
    expect(calls[1]).toBe(fakeSocket2);

    unsubscribe();

    // 取消订阅后不再接收
    const fakeSocket3 = { id: 's3' } as unknown as Socket;
    setSocketInstance(fakeSocket3);
    expect(calls.length).toBe(2);
  });

  it('setSocketInstance(null) 时不报错也不向活跃监听器派发', () => {
    const calls: Socket[] = [];
    const unsubscribe = onSocketInstance((s) => {
      calls.push(s);
    });

    setSocketInstance(null);
    expect(calls.length).toBe(0);

    unsubscribe();
  });
});
