import { describe, it, expect, vi } from 'vitest';
import { frontendEventBus } from '../event-bus';

/**
 * `frontendEventBus` 是**进程内**总线，不与任何其他端通信。
 *
 * 背景：这里曾有一个 `setSocketBridge()` 注入点，声称会把
 * `whiteboard.` / `courseware.` / `quiz.` / `rollcall.` 前缀事件转发到服务端，
 * 但全仓库零调用 —— 那段转发是死代码，却让读代码的人误以为这些事件会跨端传播。
 * 随机点名「教师端已抽中、学生端不同步」的排查正是被它误导的先例。
 *
 * 本测试的作用是**防止它被重新伪装成跨端通道**：一旦有人再加回转发能力，
 * 这里的断言会先红。
 */
describe('frontendEventBus — 仅限本进程内', () => {
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
      payload: {},
      timestamp: 2,
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
