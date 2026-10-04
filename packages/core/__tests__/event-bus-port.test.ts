/**
 * Phase B4: EventBus（packages/core/event-bus/index.ts）订阅取消与泄漏告警。
 *
 * 覆盖 index.ts 的轻量生产实现（退订函数与内存泄漏告警）。
 */
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../event-bus/index.js';

describe('Phase B4 — EventBus.subscribe 返回取消订阅函数', () => {
  it('subscribe 返回的函数可取消订阅，之后 publish 不再触达', async () => {
    const bus = new EventBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe('mem.test', (e) => {
      received.push(String((e.payload as any).v));
    });
    expect(typeof unsubscribe).toBe('function');

    await bus.publish({ id: '', type: 'mem.test', source: 'test', timestamp: Date.now(), payload: { v: 1 } });
    expect(received).toEqual(['1']);

    unsubscribe();
    await bus.publish({ id: '', type: 'mem.test', source: 'test', timestamp: Date.now(), payload: { v: 2 } });
    expect(received).toEqual(['1']);
    expect(bus.subscriberCount('mem.test')).toBe(0);
  });

  it('同一事件类型订阅超过 50 个时告警（防监听器泄漏）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bus = new EventBus();
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < 51; i++) {
      unsubs.push(bus.subscribe('mem.flood', () => {}));
    }
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Possible listener leak'));
    unsubs.forEach((u) => u());
    expect(bus.subscriberCount('mem.flood')).toBe(0);
    warnSpy.mockRestore();
  });
});
