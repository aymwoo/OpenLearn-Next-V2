/**
 * EventForwarder 单元测试。
 *
 * 覆盖 4 个关键行为维度：
 * 1. subscribe/forward -- 订阅 EventBus 并转发事件到 Worker
 * 2. unsubscribe -- 取消订阅后不再转发
 * 3. Cleanup lifecycle -- disposeAll 清理所有订阅
 * 4. Edge cases -- 未知 subId、多 Worker、idempotent
 *
 * 测试策略：使用真实 EventBus 实例 + mock IWorkerTransport。
 * 真实 EventBus 确保 subscribe/unsubscribe 的行为与实际运行一致。
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../../event-bus/index.js';
import { EventForwarder } from '../event-forwarder.js';
import type { IWorkerTransport } from '../types.js';

// -- Mock Transport ---------------------------------------------------------------

interface MockTransport extends IWorkerTransport {
  messages: any[];
}

function createMockTransport(id: string = 'fw-test'): MockTransport {
  let handler: ((msg: any) => void) | null = null;
  const messages: any[] = [];
  return {
    postMessage: vi.fn((msg: any) => {
      messages.push(msg);
    }),
    onMessage: vi.fn((h: (msg: any) => void) => {
      handler = h;
    }),
    terminate: vi.fn(async () => {}),
    id,
    get messages() {
      return messages;
    },
  } as any;
}

// -- Helper: create a PlatformEvent -------------------------------------------------

function createTestEvent(
  type: string,
  payload: unknown = {},
  overrides?: Partial<{
    id: string;
    source: string;
    timestamp: number;
    correlationId: string;
  }>,
) {
  return {
    id: overrides?.id ?? 'evt-001',
    type,
    source: overrides?.source ?? 'test-source',
    payload,
    timestamp: overrides?.timestamp ?? 1000,
    correlationId: overrides?.correlationId,
  };
}

// ================================================================================
// Group 1: EventForwarder subscribe/forward
// ================================================================================

describe('EventForwarder subscribe/forward', () => {
  let eventBus: EventBus;
  let transport: MockTransport;
  let forwarder: EventForwarder;

  beforeEach(() => {
    eventBus = new EventBus();
    transport = createMockTransport();
    forwarder = new EventForwarder(eventBus, transport);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should subscribe to EventBus and forward events', () => {
    // Subscribe to 'lesson.created'
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-1',
      eventType: 'lesson.created',
    });

    // Publish an event on the real EventBus
    const event = createTestEvent('lesson.created', { lessonId: 'L1' });
    eventBus.publish(event);

    // Verify the forwarding handler was triggered and posted an EventMessage
    expect(transport.postMessage).toHaveBeenCalledTimes(1);
    const call = transport.postMessage.mock.calls[0][0];
    expect(call.type).toBe('event');
    expect(call.subId).toBe('sub-1');
    expect(call.event.type).toBe('lesson.created');
    expect(call.event.payload).toEqual({ lessonId: 'L1' });
    expect(call.event.id).toBe('evt-001');
    expect(call.event.source).toBe('test-source');
    expect(call.event.timestamp).toBe(1000);
  });

  it('should forward event with correlationId when present', () => {
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-corr',
      eventType: 'test.event',
    });

    const event = createTestEvent('test.event', { key: 'val' }, {
      correlationId: 'corr-123',
    });
    eventBus.publish(event);

    expect(transport.postMessage).toHaveBeenCalledTimes(1);
    const call = transport.postMessage.mock.calls[0][0];
    expect(call.event.correlationId).toBe('corr-123');
  });

  it('should not forward events after unsubscribe', () => {
    // Subscribe
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-2',
      eventType: 'test.event',
    });

    // Unsubscribe
    forwarder.handleUnsubscribe({
      type: 'unsubscribe',
      subId: 'sub-2',
    });

    // Publish event
    eventBus.publish(createTestEvent('test.event', { msg: 'should-not-forward' }));

    // Should NOT have forwarded
    expect(transport.postMessage).not.toHaveBeenCalled();
  });

  it('should forward only the specific event type subscribed to', () => {
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-type',
      eventType: 'lesson.created',
    });

    // Publish a different event type
    eventBus.publish(createTestEvent('whiteboard.element_drawn', { elemId: 'E1' }));

    // Should NOT forward (not the subscribed type)
    expect(transport.postMessage).not.toHaveBeenCalled();

    // Publish the subscribed type
    eventBus.publish(createTestEvent('lesson.created', { lessonId: 'L2' }));

    // Should forward
    expect(transport.postMessage).toHaveBeenCalledTimes(1);
  });
});

// ================================================================================
// Group 2: Cleanup lifecycle
// ================================================================================

describe('EventForwarder cleanup lifecycle', () => {
  let eventBus: EventBus;
  let transport: MockTransport;
  let forwarder: EventForwarder;

  beforeEach(() => {
    eventBus = new EventBus();
    transport = createMockTransport();
    forwarder = new EventForwarder(eventBus, transport);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should clean up all subscriptions on disposeAll', () => {
    // Subscribe to multiple event types
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-a',
      eventType: 'lesson.created',
    });
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-b',
      eventType: 'whiteboard.element_drawn',
    });

    // Clear all mocks so we only see post-dispose forwards
    transport.postMessage.mockClear();

    // Dispose all
    forwarder.disposeAll();

    // Publish for each type -- should NOT forward
    eventBus.publish(createTestEvent('lesson.created', { lessonId: 'L1' }));
    eventBus.publish(createTestEvent('whiteboard.element_drawn', { elemId: 'E1' }));

    expect(transport.postMessage).not.toHaveBeenCalled();
  });

  it('should be idempotent on disposeAll', () => {
    // Subscribe then dispose
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-i',
      eventType: 'test.event',
    });

    // First dispose
    forwarder.disposeAll();

    // Second dispose should not throw
    expect(() => forwarder.disposeAll()).not.toThrow();
  });

  it('should not forward events after disposeAll then subscribe again', () => {
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-d1',
      eventType: 'test.event',
    });

    forwarder.disposeAll();

    // Publish -- should NOT forward (all handlers removed)
    eventBus.publish(createTestEvent('test.event', { val: 1 }));

    expect(transport.postMessage).not.toHaveBeenCalled();

    // Subscribe again after dispose
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-d2',
      eventType: 'test.event',
    });

    eventBus.publish(createTestEvent('test.event', { val: 2 }));

    // Should forward the new subscription
    expect(transport.postMessage).toHaveBeenCalledTimes(1);
    const call = transport.postMessage.mock.calls[0][0];
    expect(call.subId).toBe('sub-d2');
    expect(call.event.payload).toEqual({ val: 2 });
  });
});

// ================================================================================
// Group 3: Edge cases
// ================================================================================

describe('EventForwarder edge cases', () => {
  let eventBus: EventBus;
  let forwarder: EventForwarder;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle unsubscribe for unknown subId gracefully', () => {
    const transport = createMockTransport();
    forwarder = new EventForwarder(eventBus, transport);

    // Unsubscribe with a subId that was never subscribed
    expect(() => {
      forwarder.handleUnsubscribe({
        type: 'unsubscribe',
        subId: 'nonexistent',
      });
    }).not.toThrow();
  });

  it('should handle subscribe for multiple Workers independently', () => {
    const transport1 = createMockTransport('worker-1');
    const transport2 = createMockTransport('worker-2');
    const forwarder1 = new EventForwarder(eventBus, transport1);
    const forwarder2 = new EventForwarder(eventBus, transport2);

    // Subscribe worker-1 to 'lesson.created', worker-2 to 'test.event'
    forwarder1.handleSubscribe({
      type: 'subscribe',
      subId: 's1',
      eventType: 'lesson.created',
    });
    forwarder2.handleSubscribe({
      type: 'subscribe',
      subId: 's2',
      eventType: 'test.event',
    });

    // Publish 'lesson.created' -- only worker-1 should receive it
    eventBus.publish(createTestEvent('lesson.created', { lessonId: 'L1' }));

    expect(transport1.postMessage).toHaveBeenCalledTimes(1);
    expect(transport2.postMessage).not.toHaveBeenCalled();

    // Verify worker-1 got the correct event
    const msg1 = transport1.postMessage.mock.calls[0][0];
    expect(msg1.subId).toBe('s1');
    expect(msg1.event.type).toBe('lesson.created');

    // Publish 'test.event' -- only worker-2 should receive it
    eventBus.publish(createTestEvent('test.event', { data: 'hello' }));

    expect(transport2.postMessage).toHaveBeenCalledTimes(1);
    const msg2 = transport2.postMessage.mock.calls[0][0];
    expect(msg2.subId).toBe('s2');
    expect(msg2.event.type).toBe('test.event');
  });

  it('should handle subscribe for same event type on two Workers', () => {
    const transport1 = createMockTransport('worker-1');
    const transport2 = createMockTransport('worker-2');
    const forwarder1 = new EventForwarder(eventBus, transport1);
    const forwarder2 = new EventForwarder(eventBus, transport2);

    // Both workers subscribe to same event type
    forwarder1.handleSubscribe({
      type: 'subscribe',
      subId: 's1',
      eventType: 'lesson.created',
    });
    forwarder2.handleSubscribe({
      type: 'subscribe',
      subId: 's2',
      eventType: 'lesson.created',
    });

    // Publish once -- both should receive
    eventBus.publish(createTestEvent('lesson.created', { lessonId: 'shared' }));

    expect(transport1.postMessage).toHaveBeenCalledTimes(1);
    expect(transport2.postMessage).toHaveBeenCalledTimes(1);

    const msg1 = transport1.postMessage.mock.calls[0][0];
    const msg2 = transport2.postMessage.mock.calls[0][0];
    expect(msg1.event.payload).toEqual({ lessonId: 'shared' });
    expect(msg2.event.payload).toEqual({ lessonId: 'shared' });
  });

  it('should handle disposeAll for one Worker without affecting another', () => {
    const transport1 = createMockTransport('worker-1');
    const transport2 = createMockTransport('worker-2');
    const forwarder1 = new EventForwarder(eventBus, transport1);
    const forwarder2 = new EventForwarder(eventBus, transport2);

    forwarder1.handleSubscribe({
      type: 'subscribe',
      subId: 's1',
      eventType: 'lesson.created',
    });
    forwarder2.handleSubscribe({
      type: 'subscribe',
      subId: 's2',
      eventType: 'lesson.created',
    });

    // Dispose worker-1 only
    forwarder1.disposeAll();

    // Publish -- worker-2 should still receive, worker-1 should not
    eventBus.publish(createTestEvent('lesson.created', { lessonId: 'after' }));

    expect(transport1.postMessage).not.toHaveBeenCalled();
    expect(transport2.postMessage).toHaveBeenCalledTimes(1);
  });

  it('should handle postMessage errors gracefully (Worker terminated)', () => {
    // Create a transport whose postMessage throws
    const transport = createMockTransport('crashing-worker');
    transport.postMessage = vi.fn(() => {
      throw new Error('Worker already terminated');
    });
    forwarder = new EventForwarder(eventBus, transport);

    // Subscribe
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-crash',
      eventType: 'test.event',
    });

    // Publish should not throw -- forward handler catches postMessage errors
    expect(() => {
      eventBus.publish(createTestEvent('test.event', { msg: 'crash' }));
    }).not.toThrow();
  });
});
