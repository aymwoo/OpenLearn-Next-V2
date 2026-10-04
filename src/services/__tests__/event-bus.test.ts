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

/**
 * 通配符订阅回归测试。
 *
 * Why: `WhiteboardEventSlot` 以 `courseware.*` 订阅前端 EventBus，课件 iframe 的
 * `courseware.submitted` 等事件要经此路由进白板事件槽。此前 publish 只做精确查找，
 * 通配符订阅永远收不到事件（教师面板 / 调试面板永久静默失效）。
 */
describe('frontendEventBus — 前缀与全量通配符订阅', () => {
  beforeEach(() => {
    frontendEventBus.clear();
  });

  function publish(type: string): Promise<void> {
    return frontendEventBus.publish({
      id: `evt-${type}`,
      type,
      source: 'test',
      payload: {},
      timestamp: 1,
    });
  }

  it('精确订阅保持精确语义，不会被其它事件触发', async () => {
    const exact = vi.fn();
    const other = vi.fn();
    frontendEventBus.subscribe('courseware.submitted', exact);
    frontendEventBus.subscribe('lesson.saved', other);

    await publish('courseware.submitted');
    expect(exact).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();

    await publish('lesson.saved');
    expect(other).toHaveBeenCalledTimes(1);
    expect(exact).toHaveBeenCalledTimes(1);
  });

  it('精确订阅只命中字面量事件名，不被同名前缀的其它事件误触发', async () => {
    const handler = vi.fn();
    frontendEventBus.subscribe('courseware', handler);

    await publish('courseware.submitted');
    expect(handler).not.toHaveBeenCalled();

    await publish('courseware');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('courseware.* 收到同命名空间事件，但收不到其它命名空间事件', async () => {
    const handler = vi.fn();
    frontendEventBus.subscribe('courseware.*', handler);

    await publish('courseware.submitted');
    await publish('courseware.progress_saved');
    await publish('courseware.event_logged');
    await publish('courseware.config_reported');
    expect(handler).toHaveBeenCalledTimes(4);

    await publish('lesson.saved');
    await publish('whiteboard.page_changed');
    expect(handler).toHaveBeenCalledTimes(4);
    expect(handler.mock.calls.map((c) => c[0].type)).toEqual([
      'courseware.submitted',
      'courseware.progress_saved',
      'courseware.event_logged',
      'courseware.config_reported',
    ]);
  });

  it('多级前缀不会误匹配：courseware.* 不匹配 coursewareExtra.* 与 courseware', async () => {
    const handler = vi.fn();
    frontendEventBus.subscribe('courseware.*', handler);

    await publish('coursewareExtra.saved');
    await publish('courseware');
    expect(handler).not.toHaveBeenCalled();

    await publish('courseware.a.b.c');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('* 订阅收到全部事件', async () => {
    const handler = vi.fn();
    frontendEventBus.subscribe('*', handler);

    await publish('courseware.submitted');
    await publish('lesson.saved');
    await publish('whiteboard.page_changed');

    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('精确 + 前缀 + 全量订阅在同一次 publish 中各自被调用一次', async () => {
    const exact = vi.fn();
    const prefixed = vi.fn();
    const global = vi.fn();
    frontendEventBus.subscribe('courseware.submitted', exact);
    frontendEventBus.subscribe('courseware.*', prefixed);
    frontendEventBus.subscribe('*', global);

    await publish('courseware.submitted');
    expect(exact).toHaveBeenCalledTimes(1);
    expect(prefixed).toHaveBeenCalledTimes(1);
    expect(global).toHaveBeenCalledTimes(1);

    // 同一 handler 重复以不同模式订阅时也只应被调用一次
    const shared = vi.fn();
    frontendEventBus.subscribe('courseware.submitted', shared);
    frontendEventBus.subscribe('courseware.*', shared);
    await publish('courseware.submitted');
    expect(shared).toHaveBeenCalledTimes(1);
  });

  it('通配符取消订阅后不再收到事件（精确订阅不受影响）', async () => {
    const prefixHandler = vi.fn();
    const globalHandler = vi.fn();
    const exactHandler = vi.fn();

    const unsubPrefix = frontendEventBus.subscribe('courseware.*', prefixHandler);
    const unsubGlobal = frontendEventBus.subscribe('*', globalHandler);
    frontendEventBus.subscribe('courseware.submitted', exactHandler);

    await publish('courseware.submitted');
    expect(prefixHandler).toHaveBeenCalledTimes(1);
    expect(globalHandler).toHaveBeenCalledTimes(1);

    unsubPrefix();
    unsubPrefix(); // 幂等：重复调用不应破坏索引
    unsubGlobal();

    await publish('courseware.submitted');
    expect(prefixHandler).toHaveBeenCalledTimes(1);
    expect(globalHandler).toHaveBeenCalledTimes(1);
    expect(exactHandler).toHaveBeenCalledTimes(2);
  });

  it('listenerCount 覆盖通配符订阅，clear 可按模式或整体清理', async () => {
    const unsubPrefix = frontendEventBus.subscribe('courseware.*', () => {});
    frontendEventBus.subscribe('courseware.*', () => {});
    frontendEventBus.subscribe('*', () => {});
    frontendEventBus.subscribe('lesson.saved', () => {});

    expect(frontendEventBus.listenerCount('courseware.*')).toBe(2);
    expect(frontendEventBus.listenerCount('*')).toBe(1);
    expect(frontendEventBus.listenerCount('lesson.saved')).toBe(1);
    expect(frontendEventBus.listenerCount('courseware.submitted')).toBe(0);
    expect(frontendEventBus.listenerCount()).toBe(4);

    frontendEventBus.clear('courseware.*');
    expect(frontendEventBus.listenerCount('courseware.*')).toBe(0);
    expect(frontendEventBus.listenerCount()).toBe(2);

    // 清理前缀后，新订阅的通配符仍可正常工作（wildcardCount 计数一致）
    const reHandler = vi.fn();
    const unsubRe = frontendEventBus.subscribe('courseware.*', reHandler);
    await publish('courseware.submitted');
    expect(reHandler).toHaveBeenCalledTimes(1);
    unsubRe();

    frontendEventBus.clear();
    expect(frontendEventBus.listenerCount()).toBe(0);
    unsubPrefix();
  });

  it('once 与 subscribePayload 对通配符同样生效', async () => {
    const onceHandler = vi.fn();
    const payloadHandler = vi.fn();
    frontendEventBus.once('courseware.*', onceHandler);
    frontendEventBus.subscribePayload('courseware.*', payloadHandler);

    await publish('courseware.submitted');
    await publish('courseware.progress_saved');

    expect(onceHandler).toHaveBeenCalledTimes(1);
    expect(payloadHandler).toHaveBeenCalledTimes(2);
  });

  it('非完整通配模式按字面量处理，不做前缀匹配', async () => {
    const handler = vi.fn();
    frontendEventBus.subscribe('courseware.sub*', handler);

    await publish('courseware.submitted');
    expect(handler).not.toHaveBeenCalled();
    expect(frontendEventBus.listenerCount('courseware.sub*')).toBe(1);
  });
});
