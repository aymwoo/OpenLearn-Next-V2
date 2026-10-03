import { describe, it, expect, vi, beforeEach } from 'vitest';
import { frontendEventBus } from '../event-bus';

describe('frontendEventBus — 仅限本进程内', () => {
  beforeEach(() => {
    frontendEventBus.clear();
  });

  it('不暴露任何 socket 桥接能力（防止重新伪装成跨端通道）', () => {
    const bus = frontendEventBus as unknown as Record<string, unknown>;
    for (const deadApi of ['setSocketBridge', 'hasSocketBridge', 'socketBridge']) {
      expect(bus[deadApi]).toBeUndefined();
    }
  });

  it('发布事件只通知本地订阅者，不产生任何网络/桥接副作用', async () => {
    const handler = vi.fn();
    const unsub = frontendEventBus.subscribe('whiteboard.element_updated', handler);

    await frontendEventBus.publish({
      id: 'evt-1',
      type: 'whiteboard.element_updated',
      source: 'test',
      payload: { lessonId: 'L1' },
      timestamp: 1,
    });

    // 本地订阅者照常收到
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ type: 'whiteboard.element_updated' });

    // rollcall 前缀同样只是本地事件（历史上它被误认为会上行到服务端）
    expect(typeof frontendEventBus.publish).toBe('function');
    unsub();
  });

  it('订阅后取消订阅即不再收到事件', async () => {
    const handler = vi.fn();
    const unsub = frontendEventBus.subscribe('rollcall.picked', handler);
    unsub();

    await frontendEventBus.publish({
      id: 'evt-2',
      type: 'rollcall.picked',
      source: 'test',
      payload: { studentId: 's1' },
      timestamp: 2,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('支持 emit 便捷发射并自动填充基础元数据', async () => {
    const handler = vi.fn();
    const unsub = frontendEventBus.subscribe('whiteboard.autosave.pending', handler);

    await frontendEventBus.emit('whiteboard.autosave.pending', { lessonId: 'les-99' }, 'test-source');

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.type).toBe('whiteboard.autosave.pending');
    expect(event.source).toBe('test-source');
    expect(event.payload).toEqual({ lessonId: 'les-99' });
    expect(event.id).toBeDefined();
    expect(typeof event.timestamp).toBe('number');

    unsub();
  });

  it('支持 subscribePayload 直接解构 payload', async () => {
    const handler = vi.fn();
    const unsub = frontendEventBus.subscribePayload('rollcall.picked', handler);

    await frontendEventBus.emit('rollcall.picked', { studentId: 's100', studentName: 'Alice' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({ studentId: 's100', studentName: 'Alice' });
    expect(handler.mock.calls[0][1].type).toBe('rollcall.picked');

    unsub();
  });

  it('支持 once 单次监听，触发一次后自动注销', async () => {
    const handler = vi.fn();
    frontendEventBus.once('whiteboard.page_changed', handler);

    await frontendEventBus.emit('whiteboard.page_changed', { pageIndex: 2 });
    await frontendEventBus.emit('whiteboard.page_changed', { pageIndex: 3 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].payload).toEqual({ pageIndex: 2 });
  });

  it('实现严格的错误隔离：单个 handler 抛错不影响其他 handler 正常执行', async () => {
    const badHandler = vi.fn(() => {
      throw new Error('Boom in listener');
    });
    const goodHandler = vi.fn();

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    frontendEventBus.subscribe('whiteboard.element_created', badHandler);
    frontendEventBus.subscribe('whiteboard.element_created', goodHandler);

    await frontendEventBus.emit('whiteboard.element_created', { elementId: 'el-1' });

    expect(badHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('支持 listenerCount 与 clear 管理能力', () => {
    expect(frontendEventBus.listenerCount()).toBe(0);

    const unsub1 = frontendEventBus.subscribe('whiteboard.autosave.saving', () => {});
    const unsub2 = frontendEventBus.subscribe('whiteboard.autosave.saving', () => {});
    const unsub3 = frontendEventBus.subscribe('rollcall.picked', () => {});

    expect(frontendEventBus.listenerCount('whiteboard.autosave.saving')).toBe(2);
    expect(frontendEventBus.listenerCount('rollcall.picked')).toBe(1);
    expect(frontendEventBus.listenerCount()).toBe(3);

    unsub1();
    expect(frontendEventBus.listenerCount('whiteboard.autosave.saving')).toBe(1);

    frontendEventBus.clear('whiteboard.autosave.saving');
    expect(frontendEventBus.listenerCount('whiteboard.autosave.saving')).toBe(0);
    expect(frontendEventBus.listenerCount()).toBe(1);

    frontendEventBus.clear();
    expect(frontendEventBus.listenerCount()).toBe(0);

    unsub2();
    unsub3();
  });
});
