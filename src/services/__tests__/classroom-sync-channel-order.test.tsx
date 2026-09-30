import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

/**
 * `ClassroomSyncChannel` 的 socket 监听是**惰性补挂**的。
 *
 * 背景：socket 由 `useClassroomSocket` 的 effect 注入，而 React 的 passive effect
 * 是**子先于父**执行的。若在构造函数里 `getOptionalSocket()`，任何在子组件 effect
 * 里创建的 channel 拿到的都是 null —— `classroom:sync_message` 监听**永久缺失且不
 * 报错**。而 `postMessage` 每次都重新取 socket，于是症状是「发正常、收静默失效」
 * 这种不对称故障；同机多标签页因 BroadcastChannel 是独立通路而完全看不出来。
 *
 * 修复：不在构造时绑定，改为 `onMessage` / `postMessage` 前调用
 * `ensureSocketBound()` 自愈式补挂（并对「socket 实例被替换」做换绑）。
 *
 * 每个用例都用 `vi.resetModules()` + 动态 import 拿到**全新的模块实例** ——
 * 否则 `_socket` 这个模块级变量会在用例之间泄漏，断言结果取决于执行顺序。
 */

type Handler = (data: unknown) => void;

function makeFakeSocket() {
  const handlers = new Map<string, Handler[]>();
  return {
    on(evt: string, h: Handler) {
      handlers.set(evt, [...(handlers.get(evt) ?? []), h]);
    },
    off(evt: string, h: Handler) {
      handlers.set(
        evt,
        (handlers.get(evt) ?? []).filter((x) => x !== h),
      );
    },
    emit: vi.fn(),
    fire(evt: string, data: unknown) {
      for (const h of handlers.get(evt) ?? []) h(data);
    },
    listenerCount(evt: string) {
      return (handlers.get(evt) ?? []).length;
    },
  };
}

type Mod = typeof import('../classroom-sync-channel');
type Svc = typeof import('../../services/socket-service');

async function load(): Promise<{
  Channel: Mod['ClassroomSyncChannel'];
  svc: Svc;
  socket: ReturnType<typeof makeFakeSocket>;
}> {
  vi.resetModules();
  const mod = await import('../classroom-sync-channel');
  const svc = await import('../../services/socket-service');
  return { Channel: mod.ClassroomSyncChannel, svc, socket: makeFakeSocket() };
}

const COUNTDOWN_MSG = { type: 'TEACHER_BROADCAST_COUNTDOWN', payload: { timeRemaining: 42 } } as const;

describe('ClassroomSyncChannel — 惰性补挂 socket 监听', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('子组件 effect 先跑：构造时无 socket，但 onMessage 会自愈补挂', async () => {
    const { Channel, svc, socket } = await load();
    const received: unknown[] = [];

    function Child() {
      useEffect(() => {
        // 与 StudentCountdownBanner / LiveClassroomView / LessonEditorView 的真实写法同构
        const ch = new Channel('order-1', 'L1', 'C1');
        ch.onMessage((m) => received.push(m));
        return () => ch.destroy();
      }, []);
      return null;
    }
    function Parent() {
      useEffect(() => {
        svc.setSocketInstance(socket as never);
      }, []);
      return <Child />;
    }

    render(<Parent />);

    // 父组件里把 socket effect 声明在前面也一样：React 按「子先于父」执行，
    // 构造瞬间确实没有 socket —— 但 onMessage 触发的补挂让它最终可达。
    expect(socket.listenerCount('classroom:sync_message')).toBe(1);

    act(() => {
      socket.fire('classroom:sync_message', { lessonId: 'L1', message: COUNTDOWN_MSG });
    });
    expect(received).toHaveLength(1);
  });

  it('构造后、注册前才注入 socket：postMessage 也能触发补挂', async () => {
    const { Channel, svc, socket } = await load();
    const received: unknown[] = [];
    const ch = new Channel('order-2', 'L1', 'C1');

    // 构造时没有 socket → 此刻没有监听（正常，不是缺陷）
    expect(socket.listenerCount('classroom:sync_message')).toBe(0);

    ch.onMessage((m) => received.push(m));
    svc.setSocketInstance(socket as never);
    ch.postMessage({ type: 'TEACHER_SYNC_TIMER', payload: { timeRemaining: 10, isRunning: true } });

    expect(socket.listenerCount('classroom:sync_message')).toBe(1);
    act(() => {
      socket.fire('classroom:sync_message', { lessonId: 'L1', message: { type: 'TEACHER_PING_STUDENT' } });
    });
    expect(received).toHaveLength(1);
    ch.destroy();
  });

  it('重复调用不会重复挂载（幂等）', async () => {
    const { Channel, svc, socket } = await load();
    svc.setSocketInstance(socket as never);
    const ch = new Channel('order-3', 'L1', 'C1');

    ch.onMessage(() => {});
    ch.onMessage(() => {});
    ch.postMessage({ type: 'TEACHER_SYNC_TIMER', payload: { timeRemaining: 1, isRunning: true } });
    ch.postMessage({ type: 'TEACHER_SYNC_TIMER', payload: { timeRemaining: 2, isRunning: true } });

    expect(socket.listenerCount('classroom:sync_message')).toBe(1);
    ch.destroy();
  });

  it('socket 实例被替换（重连换实例）时换绑，不残留旧实例的监听', async () => {
    const { Channel, svc, socket } = await load();
    svc.setSocketInstance(socket as never);
    const ch = new Channel('order-4', 'L1', 'C1');
    ch.onMessage(() => {});
    expect(socket.listenerCount('classroom:sync_message')).toBe(1);

    const replacement = makeFakeSocket();
    svc.setSocketInstance(replacement as never);
    ch.postMessage({ type: 'TEACHER_SYNC_TIMER', payload: { timeRemaining: 5, isRunning: true } });

    expect(socket.listenerCount('classroom:sync_message')).toBe(0);
    expect(replacement.listenerCount('classroom:sync_message')).toBe(1);
    ch.destroy();
  });

  it('destroy 后解绑 socket 监听', async () => {
    const { Channel, svc, socket } = await load();
    svc.setSocketInstance(socket as never);
    const ch = new Channel('order-5', 'L1', 'C1');
    ch.onMessage(() => {});
    expect(socket.listenerCount('classroom:sync_message')).toBe(1);

    ch.destroy();
    expect(socket.listenerCount('classroom:sync_message')).toBe(0);
  });

  it('仍按 lessonId 过滤别的课节消息', async () => {
    const { Channel, svc, socket } = await load();
    svc.setSocketInstance(socket as never);
    const received: unknown[] = [];
    const ch = new Channel('order-6', 'L1', 'C1');
    ch.onMessage((m) => received.push(m));

    act(() => {
      socket.fire('classroom:sync_message', { lessonId: 'OTHER', message: COUNTDOWN_MSG });
    });
    expect(received).toHaveLength(0);

    act(() => {
      socket.fire('classroom:sync_message', { lessonId: 'L1', message: COUNTDOWN_MSG });
    });
    expect(received).toHaveLength(1);
    ch.destroy();
  });
});
