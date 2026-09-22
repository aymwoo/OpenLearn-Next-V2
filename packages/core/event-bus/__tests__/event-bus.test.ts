import { describe, it, expect } from 'vitest';
import { EventBus, type PlatformEvent } from '../index.js';

function evt(type: string, payload: unknown = {}, overrides: Partial<PlatformEvent> = {}): PlatformEvent {
  return { id: `evt_${type}_${Math.random()}`, type, source: 'test', payload, timestamp: Date.now(), ...overrides };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('EventBus', () => {
  it('starts subscribers in registration order', async () => {
    const bus = new EventBus();
    const order: string[] = [];

    bus.subscribe('classroom.test', () => {
      order.push('first');
    });
    bus.subscribe('classroom.test', () => {
      order.push('second');
    });

    await bus.publish(evt('classroom.test'));
    expect(order).toEqual(['first', 'second']);
  });

  it('invokes every synchronous subscriber before publish() returns', () => {
    // Regression guard: `worker-runtime` forwards one event to N workers by
    // registering N subscribers and publishes without awaiting. If only the
    // first subscriber ran synchronously, the remaining workers would miss the
    // event in that call pattern.
    const bus = new EventBus();
    const calls: string[] = [];

    bus.subscribe('classroom.test', () => {
      calls.push('a');
    });
    bus.subscribe('classroom.test', () => {
      calls.push('b');
    });

    void bus.publish(evt('classroom.test'));
    expect(calls).toEqual(['a', 'b']);
  });

  it('fills in a missing id and timestamp', async () => {
    const bus = new EventBus();
    let seen: PlatformEvent | undefined;

    bus.subscribe('classroom.test', (event) => {
      seen = event;
    });

    await bus.publish({ type: 'classroom.test', source: 'test', payload: {} } as PlatformEvent);

    expect(seen!.id).toBeTruthy();
    expect(seen!.timestamp).toBeGreaterThan(0);
  });

  it('isolates a throwing subscriber and continues the chain', async () => {
    const failures: unknown[] = [];
    const bus = new EventBus({ onSubscriberError: (info) => failures.push(info.error) });
    const reached: string[] = [];

    bus.subscribe('classroom.test', () => {
      throw new Error('boom');
    });
    bus.subscribe('classroom.test', () => {
      reached.push('second');
    });

    await bus.publish(evt('classroom.test'));

    expect(reached).toEqual(['second']);
    expect(failures).toHaveLength(1);
    expect(String(failures[0])).toContain('boom');
  });

  it('does not let a hanging subscriber stall the remaining ones', async () => {
    const bus = new EventBus({ handlerTimeoutMs: 30 });
    const reached: string[] = [];

    bus.subscribe('classroom.test', async () => {
      await sleep(500);
    });
    bus.subscribe('classroom.test', () => {
      reached.push('second');
    });

    const result = await bus.publishDetailed(evt('classroom.test'));

    expect(reached).toEqual(['second']);
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0].ok).toBe(false);
    expect(result.outcomes[0].timedOut).toBe(true);
    expect(result.outcomes[1].ok).toBe(true);
  });

  it('drops re-entrant publishes of the same type past the depth limit', async () => {
    const dropped: string[] = [];
    const bus = new EventBus({
      maxSameTypeDepth: 2,
      onRecursionDropped: (info) => dropped.push(info.event.type),
    });

    let handlerCalls = 0;
    bus.subscribe('courseware.attempt_updated', async () => {
      handlerCalls += 1;
      await bus.publish(evt('courseware.attempt_updated'));
    });

    const result = await bus.publishDetailed(evt('courseware.attempt_updated'));

    // depth 0 → handler, depth 1 → handler, depth 2 → dropped
    expect(handlerCalls).toBe(2);
    expect(dropped).toEqual(['courseware.attempt_updated']);
    expect(result.outcomes).toHaveLength(1);
  });

  it('treats concurrent publishes of the same type as independent, not recursive', async () => {
    // Regression guard: with maxSameTypeDepth = 1 a *nested* publish is dropped
    // immediately, but three concurrent publishes must all still be dispatched.
    // An instance-level counter would wrongly drop two of them.
    const bus = new EventBus({ maxSameTypeDepth: 1 });
    let calls = 0;

    bus.subscribe('classroom.test', () => {
      calls += 1;
    });

    await Promise.all([bus.publish(evt('classroom.test')), bus.publish(evt('classroom.test')), bus.publish(evt('classroom.test'))]);

    expect(calls).toBe(3);
  });

  it('runs a handler registered on both the concrete type and "*" only once', async () => {
    const bus = new EventBus();
    let calls = 0;
    const handler = () => {
      calls += 1;
    };

    bus.subscribe('classroom.test', handler);
    bus.subscribe('*', handler);

    const result = await bus.publishDetailed(evt('classroom.test'));

    expect(calls).toBe(1);
    expect(result.subscriberCount).toBe(1);
  });

  it('reports whether unsubscribe removed a registered subscriber', () => {
    const bus = new EventBus();
    const handler = () => {};

    bus.subscribe('classroom.test', handler);
    expect(bus.subscriberCount('classroom.test')).toBe(1);
    bus.unsubscribe('classroom.test', handler);
    expect(bus.subscriberCount('classroom.test')).toBe(0);
    // Unsubscribing twice is a no-op rather than an error.
    bus.unsubscribe('classroom.test', handler);
    expect(bus.subscriberCount('classroom.test')).toBe(0);
  });
});
