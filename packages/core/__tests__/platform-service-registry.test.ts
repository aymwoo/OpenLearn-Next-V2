import { describe, it, expect } from 'vitest';
import {
  PlatformServiceRegistry,
  ServiceDescriptor,
  ServiceScope,
} from '../service-registry/index.js';

describe('Kernel PI-007 Platform Service Registry Test Suite', () => {
  interface ITestService {
    getName(): string;
  }

  class TestServiceImpl implements ITestService {
    getName() { return 'TestService'; }
  }

  const singletonDesc: ServiceDescriptor<ITestService> = {
    id: 'srv_test_singleton',
    lifetime: 'Singleton',
    instance: new TestServiceImpl(),
    description: 'Singleton Test Service',
  };

  const transientDesc: ServiceDescriptor<ITestService> = {
    id: 'srv_test_transient',
    lifetime: 'Transient',
    factory: () => new TestServiceImpl(),
    description: 'Transient Test Service',
  };

  it('should register, resolve, and check existence of singleton services', () => {
    const registry = new PlatformServiceRegistry();
    registry.register(singletonDesc);

    expect(registry.exists('srv_test_singleton')).toBe(true);
    const resolved = registry.resolve<ITestService>('srv_test_singleton');
    expect(resolved.getName()).toBe('TestService');
  });

  it('should prevent duplicate service registrations', () => {
    const registry = new PlatformServiceRegistry();
    registry.register(singletonDesc);

    expect(() => registry.register(singletonDesc)).toThrow('already registered');
  });

  it('should support tryResolve() returning undefined for unregistered services', () => {
    const registry = new PlatformServiceRegistry();
    expect(registry.tryResolve('non_existent_service')).toBeUndefined();
  });

  it('should replace registered service instances', () => {
    const registry = new PlatformServiceRegistry();
    registry.register(singletonDesc);

    const newInstance: ITestService = { getName: () => 'ReplacedService' };
    registry.replace('srv_test_singleton', newInstance);

    const resolved = registry.resolve<ITestService>('srv_test_singleton');
    expect(resolved.getName()).toBe('ReplacedService');
  });

  it('should handle Scoped service instances via ServiceScope', () => {
    const registry = new PlatformServiceRegistry();
    let count = 0;
    const scopedDesc: ServiceDescriptor<ITestService> = {
      id: 'srv_test_scoped',
      lifetime: 'Scoped',
      factory: () => ({ getName: () => `ScopedService_${++count}` }),
    };
    registry.register(scopedDesc);

    const scope1 = new ServiceScope('scope_1');
    const scope2 = new ServiceScope('scope_2');

    const s1_a = registry.resolve<ITestService>('srv_test_scoped', scope1);
    const s1_b = registry.resolve<ITestService>('srv_test_scoped', scope1);
    const s2_a = registry.resolve<ITestService>('srv_test_scoped', scope2);

    expect(s1_a).toBe(s1_b);
    expect(s1_a.getName()).toBe('ScopedService_1');
    expect(s2_a.getName()).toBe('ScopedService_2');
  });

  it('should resolveAll() active registered services', () => {
    const registry = new PlatformServiceRegistry();
    registry.register(singletonDesc);
    registry.register(transientDesc);

    const all = registry.resolveAll();
    expect(all.length).toBe(2);
  });

  it('should validate registered descriptors and detect missing implementations', () => {
    const registry = new PlatformServiceRegistry();
    registry.register({ id: 'srv_invalid', lifetime: 'Singleton' });

    const validation = registry.validate();
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.code === 'MISSING_IMPLEMENTATION')).toBe(true);
  });

  it('should unregister and clear registered services cleanly', () => {
    const registry = new PlatformServiceRegistry();
    registry.register(singletonDesc);
    expect(registry.unregister('srv_test_singleton')).toBe(true);
    expect(registry.exists('srv_test_singleton')).toBe(false);
  });
});
