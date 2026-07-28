/**
 * Unit tests for the Platform Event Bus (PI-010).
 *
 * Covers: publish/subscribe, multiple subscribers, priority ordering, async
 * events, cancellation, handler failure isolation, filtered handlers, timeout,
 * subscribeOnce, publishSync, and regression checks that the bus integrates
 * with the ServiceRegistry (ServiceEventBus) and BootstrapPipeline.
 */

import { describe, it, expect } from 'vitest';
import { EventBus } from '../event-bus-runtime/EventBus.js';
import { ServiceEventBus } from '../service-registry/index.js';

function makeBus(): EventBus {
  return new EventBus({ logger: { debug() {}, info() {}, warn() {}, error() {} } });
}

describe('Platform Event Bus — publish & subscribe', () => {
  it('delivers a published event to a subscriber with full context', async () => {
    const bus = makeBus();
    let received: unknown;
    bus.subscribe('Test.Event', (ctx) => {
      received = ctx.payload;
    });
    const result = await bus.publish(bus.createEvent({ type: 'Test.Event', source: 'test', payload: { n: 1 } }));
    expect(received).toEqual({ n: 1 });
    expect(result.dispatched).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('delivers to multiple subscribers', async () => {
    const bus = makeBus();
    const hits: string[] = [];
    bus.subscribe('Test.Multi', () => { hits.push('a'); });
    bus.subscribe('Test.Multi', () => { hits.push('b'); });
    bus.subscribe('Test.Multi', () => { hits.push('c'); });
    await bus.publish(bus.createEvent({ type: 'Test.Multi', source: 'test', payload: {} }));
    expect(hits.sort()).toEqual(['a', 'b', 'c']);
  });

  it('supports wildcard subscriptions', async () => {
    const bus = makeBus();
    let count = 0;
    bus.subscribe('*', () => { count++; });
    await bus.publish(bus.createEvent({ type: 'Any.Type', source: 'test', payload: {} }));
    expect(count).toBe(1);
  });
});

describe('Platform Event Bus — priority & ordering', () => {
  it('dispatches higher-priority handlers first (deterministic via publishSync)', () => {
    const bus = makeBus();
    const order: string[] = [];
    bus.subscribe('Test.Prio', () => { order.push('low'); }, { priority: 1 });
    bus.subscribe('Test.Prio', () => { order.push('high'); }, { priority: 10 });
    bus.subscribe('Test.Prio', () => { order.push('mid'); }, { priority: 5 });
    bus.publishSync(bus.createEvent({ type: 'Test.Prio', source: 'test', payload: {} }));
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('uses `order` as a tie-breaker at equal priority', () => {
    const bus = makeBus();
    const order: string[] = [];
    bus.subscribe('Test.Tie', () => { order.push('second'); }, { priority: 0, order: 2 });
    bus.subscribe('Test.Tie', () => { order.push('first'); }, { priority: 0, order: 1 });
    bus.publishSync(bus.createEvent({ type: 'Test.Tie', source: 'test', payload: {} }));
    expect(order).toEqual(['first', 'second']);
  });
});

describe('Platform Event Bus — async events', () => {
  it('awaits an async handler before resolving publish', async () => {
    const bus = makeBus();
    let resolved = false;
    bus.subscribe('Test.Async', async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
    });
    await bus.publish(bus.createEvent({ type: 'Test.Async', source: 'test', payload: {} }));
    expect(resolved).toBe(true);
  });
});

describe('Platform Event Bus — cancellation', () => {
  it('stops subsequent handlers once a handler cancels', () => {
    const bus = makeBus();
    const ran: string[] = [];
    bus.subscribe('Test.Cancel', (ctx) => { ctx.cancel(); ran.push('first'); });
    bus.subscribe('Test.Cancel', () => { ran.push('second'); });
    const result = bus.publishSync(bus.createEvent({ type: 'Test.Cancel', source: 'test', payload: {} }));
    expect(ran).toEqual(['first']);
    expect(result.results.some((r) => r.status === 'cancelled')).toBe(true);
    expect(result.cancelled).toBe(true);
  });
});

describe('Platform Event Bus — error isolation', () => {
  it('a failing handler does not terminate the platform', async () => {
    const bus = makeBus();
    const ran: string[] = [];
    bus.subscribe('Test.Fail', () => { throw new Error('boom'); });
    bus.subscribe('Test.Fail', () => { ran.push('survived'); });
    const result = await bus.publish(bus.createEvent({ type: 'Test.Fail', source: 'test', payload: {} }));
    expect(ran).toEqual(['survived']);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
  });

  it('enforces a per-handler timeout', async () => {
    const bus = makeBus();
    bus.subscribe(
      'Test.Timeout',
      () => new Promise((resolve) => setTimeout(resolve, 60)),
      { timeoutMs: 5 },
    );
    const result = await bus.publish(bus.createEvent({ type: 'Test.Timeout', source: 'test', payload: {} }));
    expect(result.results[0].status).toBe('timeout');
  });
});

describe('Platform Event Bus — filtered & once handlers', () => {
  it('skips handlers whose filter returns false', async () => {
    const bus = makeBus();
    let ran = false;
    bus.subscribe('Test.Filter', () => { ran = true; }, {
      filter: (ctx) => (ctx.payload as { allow?: boolean }).allow === true,
    });
    await bus.publish(bus.createEvent({ type: 'Test.Filter', source: 'test', payload: { allow: false } }));
    expect(ran).toBe(false);
    await bus.publish(bus.createEvent({ type: 'Test.Filter', source: 'test', payload: { allow: true } }));
    expect(ran).toBe(true);
  });

  it('removes a once handler after first invocation', async () => {
    const bus = makeBus();
    let count = 0;
    bus.subscribeOnce('Test.Once', () => { count++; });
    await bus.publish(bus.createEvent({ type: 'Test.Once', source: 'test', payload: {} }));
    await bus.publish(bus.createEvent({ type: 'Test.Once', source: 'test', payload: {} }));
    expect(count).toBe(1);
    expect(bus.subscriptionCount).toBe(0);
  });
});

describe('Platform Event Bus — subscription lifecycle', () => {
  it('unsubscribes via the returned subscriber', async () => {
    const bus = makeBus();
    let count = 0;
    const sub = bus.subscribe('Test.Unsub', () => { count++; });
    await bus.publish(bus.createEvent({ type: 'Test.Unsub', source: 'test', payload: {} }));
    sub.unsubscribe();
    await bus.publish(bus.createEvent({ type: 'Test.Unsub', source: 'test', payload: {} }));
    expect(count).toBe(1);
  });
});

describe('Platform Event Bus — regression: ServiceRegistry integration', () => {
  it('forwards ServiceEventBus events as platform events', async () => {
    const bus = makeBus();
    const svcBus = new ServiceEventBus();
    bus.bridgeServiceEventBus(svcBus);

    const seen: Array<{ type: string; serviceId: string }> = [];
    bus.subscribe('ServiceRegistered', (ctx) => {
      seen.push({ type: ctx.type, serviceId: (ctx.payload as { serviceId: string }).serviceId });
    });

    svcBus.publish('ServiceRegistered', { serviceId: 'svc_x', namespace: 'test' });
    // Allow the bridged (async) publish to complete.
    await new Promise((r) => setTimeout(r, 10));

    expect(seen.length).toBe(1);
    expect(seen[0].type).toBe('ServiceRegistered');
    expect(seen[0].serviceId).toBe('svc_x');
  });
});

describe('Platform Event Bus — regression: BootstrapPipeline integration', () => {
  it('maps pipeline stage diagnostics to platform events', () => {
    const bus = makeBus();
    // Minimal structural fake of BootstrapPipeline exposing addListener.
    const fakePipeline = {
      addListener(listener: (e: { type: string; stageName?: string; stageId?: string; durationMs?: number }) => void) {
        listener({ type: 'StageStarted', stageName: 'Registration', stageId: 'reg' });
        listener({ type: 'StageCompleted', stageName: 'Registration', stageId: 'reg', durationMs: 5 });
        return () => {};
      },
    } as unknown as import('../bootstrap/pipeline/bootstrap-pipeline.js').BootstrapPipeline;

    const seen: string[] = [];
    bus.subscribe('BootstrapStageStarted', (ctx) => { seen.push(ctx.type); });
    bus.subscribe('BootstrapStageCompleted', (ctx) => { seen.push(ctx.type); });
    bus.bridgeBootstrapPipeline(fakePipeline);

    expect(seen).toEqual(['BootstrapStageStarted', 'BootstrapStageCompleted']);
  });
});

describe('Platform Event Bus — regression: capability-runtime seam', () => {
  it('forwards capability events from a CapabilityEventSource', () => {
    const bus = makeBus();
    const seen: string[] = [];
    bus.subscribe('CapabilityRegistered', (ctx) => { seen.push((ctx.payload as { capabilityId: string }).capabilityId); });
    bus.subscribe('CapabilityResolved', (ctx) => { seen.push((ctx.payload as { capabilityId: string }).capabilityId); });

    const fakeCap = {
      onCapabilityRegistered: (cb: (id: string) => void) => { cb('cap.a'); return () => {}; },
      onCapabilityResolved: (cb: (id: string) => void) => { cb('cap.b'); return () => {}; },
    };
    bus.bridgeCapabilityRuntime(fakeCap);

    expect(seen).toEqual(['cap.a', 'cap.b']);
  });
});
