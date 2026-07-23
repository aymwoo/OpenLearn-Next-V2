/**
 * Unit tests for the Platform Dependency Injection Container (PI-008).
 *
 * Covers: constructor injection, factory injection, Singleton / Scoped /
 * Transient lifetimes, lazy resolution, circular & missing dependency
 * detection, scope disposal, contract (multiple) resolution, validation, and
 * a regression check that the Platform Service Registry remains the source
 * of truth.
 */

import { describe, it, expect } from 'vitest';
import { PlatformContainer } from '../container/PlatformContainer.js';
import { PlatformServiceRegistry } from '../../service-registry/platform-service-registry.js';
import type { InjectionContext } from '../container/InjectionContext.js';

function makeContainer(): PlatformContainer {
  return new PlatformContainer(new PlatformServiceRegistry());
}

describe('PlatformContainer — registration & constructor injection', () => {
  it('registers an instance and resolves it', () => {
    const c = makeContainer();
    const svc = { hello: () => 'world' };
    c.registerInstance('svc', svc);
    expect(c.resolve('svc')).toBe(svc);
  });

  it('performs constructor injection of declared dependencies', () => {
    const c = makeContainer();
    c.registerInstance('dep', { value: 42 });
    class Consumer {
      constructor(public dep: { value: number }) {}
    }
    c.register('consumer', Consumer, { dependencies: ['dep'] });
    const resolved = c.resolve<Consumer>('consumer');
    expect(resolved.dep.value).toBe(42);
  });

  it('throws a clear error for an invalid descriptor', () => {
    const c = makeContainer();
    // Implementation, factory, and instance are all absent.
    expect(() => c.register('bad', undefined as never)).toThrow();
  });
});

describe('PlatformContainer — factory injection', () => {
  it('invokes the factory and resolves nested dependencies', () => {
    const c = makeContainer();
    c.registerInstance('cfg', { port: 8080 });
    c.registerFactory('built', (_ctx: InjectionContext) => ({
      port: (c.resolve<{ port: number }>('cfg')).port,
    }));
    expect(c.resolve<{ port: number }>('built').port).toBe(8080);
  });
});

describe('PlatformContainer — lifetimes', () => {
  it('returns the same instance for Singleton', () => {
    const c = makeContainer();
    let count = 0;
    class Svc {
      constructor() {
        count += 1;
      }
    }
    c.register('s', Svc, { lifetime: 'Singleton' });
    expect(c.resolve('s')).toBe(c.resolve('s'));
    expect(count).toBe(1);
  });

  it('returns a new instance for Transient', () => {
    const c = makeContainer();
    let count = 0;
    class Svc {
      constructor() {
        count += 1;
      }
    }
    c.register('t', Svc, { lifetime: 'Transient' });
    expect(c.resolve('t')).not.toBe(c.resolve('t'));
    expect(count).toBe(2);
  });

  it('scopes instances per InjectionScope', () => {
    const c = makeContainer();
    class Svc {
      public disposed = false;
      dispose(): void {
        this.disposed = true;
      }
    }
    c.register('sc', Svc, { lifetime: 'Scoped' });
    const s1 = c.createScope('Request', 's1');
    const s2 = c.createScope('Request', 's2');
    const a = c.resolve<Svc>('sc', s1);
    const b = c.resolve<Svc>('sc', s1);
    const d = c.resolve<Svc>('sc', s2);
    expect(a).toBe(b);
    expect(a).not.toBe(d);
    c.disposeScope(s1);
    expect(a.disposed).toBe(true);
    expect(d.disposed).toBe(false);
  });
});

describe('PlatformContainer — lazy & optional', () => {
  it('supports lazy resolution (deferred construction)', () => {
    const c = makeContainer();
    let built = 0;
    class Heavy {
      constructor() {
        built += 1;
      }
    }
    c.register('heavy', Heavy);
    c.register(
      'lazyConsumer',
      class {
        constructor(public dep: unknown) {}
      },
      { dependencies: ['heavy'], lazy: true },
    );
    const consumer = c.resolve<{ dep: { isResolved: boolean; value: Heavy } }>('lazyConsumer');
    expect(built).toBe(0);
    expect(consumer.dep.isResolved).toBe(false);
    consumer.dep.value;
    expect(built).toBe(1);
  });

  it('injects undefined for a missing optional dependency', () => {
    const c = makeContainer();
    class A {
      constructor(public b: unknown) {}
    }
    c.register('A', A, { dependencies: ['opt'], optional: ['opt'] });
    const a = c.resolve<A>('A');
    expect(a.b).toBeUndefined();
  });

  it('throws for a missing required dependency', () => {
    const c = makeContainer();
    class A {
      constructor(public b: unknown) {}
    }
    c.register('A', A, { dependencies: ['MISSING'] });
    expect(() => c.resolve('A')).toThrow(/Missing dependency/);
  });
});

describe('PlatformContainer — circular dependency detection', () => {
  it('detects cycles at resolution time', () => {
    const c = makeContainer();
    class A {
      constructor(public b: unknown) {}
    }
    class B {
      constructor(public a: unknown) {}
    }
    c.register('A', A, { dependencies: ['B'] });
    c.register('B', B, { dependencies: ['A'] });
    expect(() => c.resolve('A')).toThrow(/Circular dependency/);
  });
});

describe('PlatformContainer — multiple & named', () => {
  it('resolves multiple implementations via a contract', () => {
    const c = makeContainer();
    c.registerInstance('multi:1', { id: 1 }, { contract: 'multi' });
    c.registerInstance('multi:2', { id: 2 }, { contract: 'multi' });
    const all = c.resolveAll('multi') as Array<{ id: number }>;
    expect(all.map((x) => x.id).sort()).toEqual([1, 2]);
  });

  it('resolves a named registration by name', () => {
    const c = makeContainer();
    c.registerNamed('primary', 'svc:primary', { name: 'primary' });
    c.registerNamed('secondary', 'svc:secondary', { name: 'secondary' });
    expect(c.resolve<{ name: string }>('svc:primary', undefined, 'primary').name).toBe('primary');
    expect(c.resolve<{ name: string }>('svc:secondary', undefined, 'secondary').name).toBe('secondary');
  });
});

describe('PlatformContainer — validation & regression', () => {
  it('validate() reports missing dependencies in the graph', () => {
    const c = makeContainer();
    class A {
      constructor(public b: unknown) {}
    }
    c.register('A', A, { dependencies: ['B'] });
    const report = c.validate();
    expect(report.isValid).toBe(false);
    expect(report.errors.some((e) => e.code === 'MISSING_DEPENDENCY')).toBe(true);
  });

  it('mirrors registrations into the Platform Service Registry (regression)', () => {
    const c = makeContainer();
    c.registerInstance('svc', { ok: true });
    expect(c.serviceRegistry.exists('svc')).toBe(true);
    expect(c.serviceRegistry.resolve('svc')).toEqual({ ok: true });
  });
});
