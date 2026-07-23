/**
 * Unit tests for the Capability Runtime (PI-009).
 *
 * Covers: registration, duplicate detection, single/priority/multiple/default/
 * optional resolution, lifecycle management, graph validation (missing deps &
 * cycles), and a regression check that capabilities integrate with the Platform
 * DI Container and Platform Service Registry.
 */

import { describe, it, expect } from 'vitest';
import { CapabilityRuntime } from '../capability-runtime/CapabilityRuntime.js';
import { PlatformServiceRegistry } from '../service-registry/platform-service-registry.js';
import { PlatformContainer } from '../di/container/PlatformContainer.js';
import { CapabilityError } from '../capability-runtime/CapabilityError.js';
import type { CapabilityDescriptorInit } from '../capability-runtime/types.js';

function makeRuntime(useContainer = false): {
  runtime: CapabilityRuntime;
  container?: PlatformContainer;
  registry: PlatformServiceRegistry;
} {
  const registry = new PlatformServiceRegistry();
  const container = useContainer ? new PlatformContainer(registry) : undefined;
  const runtime = new CapabilityRuntime(registry, container ? { container } : undefined);
  return { runtime, container, registry };
}

const simpleCapability: CapabilityDescriptorInit = {
  id: 'cap.greeter',
  name: 'Greeter',
  version: '1.0.0',
  category: 'demo',
  activator: () => ({ greet: (n: string) => `hello ${n}` }),
};

describe('Capability Runtime — registration', () => {
  it('registers a capability and reports existence', () => {
    const { runtime } = makeRuntime();
    runtime.register(simpleCapability);
    expect(runtime.exists('cap.greeter')).toBe(true);
    expect(runtime.find('cap.greeter')?.descriptor.name).toBe('Greeter');
  });

  it('rejects duplicate registration with a named error', () => {
    const { runtime } = makeRuntime();
    runtime.register(simpleCapability);
    expect(() => runtime.register(simpleCapability)).toThrow(CapabilityError);
    expect(() => runtime.register(simpleCapability)).toThrowError(/already registered/i);
  });

  it('replaces an existing capability', () => {
    const { runtime } = makeRuntime();
    runtime.register(simpleCapability);
    const replacement: CapabilityDescriptorInit = {
      ...simpleCapability,
      activator: () => ({ greet: () => 'replaced' }),
    };
    const cap = runtime.replace(replacement);
    expect(cap.descriptor.version).toBe('1.0.0');
    expect((runtime.resolve<{ greet: () => string }>('cap.greeter')).greet()).toBe('replaced');
  });

  it('unregisters a capability', () => {
    const { runtime } = makeRuntime();
    runtime.register(simpleCapability);
    expect(runtime.unregister('cap.greeter')).toBe(true);
    expect(runtime.exists('cap.greeter')).toBe(false);
  });
});

describe('Capability Runtime — resolution', () => {
  it('resolves and activates a capability, caching the instance', () => {
    const { runtime } = makeRuntime();
    runtime.register(simpleCapability);
    const inst = runtime.resolve<{ greet: (n: string) => string }>('cap.greeter');
    expect(inst.greet('world')).toBe('hello world');
    expect(runtime.find('cap.greeter')?.status).toBe('Active');
    // Second resolution returns the same cached instance.
    expect(runtime.resolve('cap.greeter')).toBe(inst);
  });

  it('returns undefined for an optional missing capability', () => {
    const { runtime } = makeRuntime();
    expect(runtime.resolve('cap.missing', { mode: 'Optional' })).toBeUndefined();
    expect(runtime.resolve('cap.missing', { optional: true, fallback: 'fb' })).toBe('fb');
  });

  it('selects the highest-priority provider under a contract', () => {
    const { runtime } = makeRuntime();
    runtime.register({
      id: 'cap.a',
      contract: 'cap.group',
      priority: 1,
      activator: () => 'low',
    });
    runtime.register({
      id: 'cap.b',
      contract: 'cap.group',
      priority: 10,
      activator: () => 'high',
    });
    expect(runtime.resolve<string>('cap.group', { mode: 'Priority' })).toBe('high');
  });

  it('resolves all members of a contract in Multiple mode', () => {
    const { runtime } = makeRuntime();
    runtime.register({ id: 'cap.a', contract: 'cap.group', activator: () => 'a' });
    runtime.register({ id: 'cap.b', contract: 'cap.group', activator: () => 'b' });
    const all = runtime.resolveAll<string>('cap.group');
    expect(all).toContain('a');
    expect(all).toContain('b');
    expect(all.length).toBe(2);
  });

  it('falls back to a default provider when the id is missing', () => {
    const { runtime } = makeRuntime();
    runtime.register({
      id: 'cap.default',
      contract: 'cap.maybe',
      isDefault: true,
      activator: () => 'default-value',
    });
    expect(runtime.resolve<string>('cap.maybe', { mode: 'Default' })).toBe('default-value');
  });
});

describe('Capability Runtime — lifecycle management', () => {
  it('moves through the validated state machine', () => {
    const { runtime } = makeRuntime();
    runtime.register(simpleCapability);
    const cap = runtime.find('cap.greeter')!;
    expect(cap.status).toBe('Registered');

    runtime.activate('cap.greeter');
    expect(cap.status).toBe('Active');

    runtime.deactivate('cap.greeter');
    expect(cap.status).toBe('Inactive');
    expect(cap.instance).toBeUndefined();

    runtime.activate('cap.greeter');
    runtime.disable('cap.greeter');
    expect(cap.status).toBe('Disabled');
    expect(cap.instance).toBeUndefined();

    runtime.enable('cap.greeter');
    expect(cap.status).toBe('Registered');

    runtime.activate('cap.greeter');
    runtime.dispose('cap.greeter');
    expect(cap.status).toBe('Disposed');
  });

  it('rejects an illegal status transition', () => {
    const { runtime } = makeRuntime();
    runtime.register(simpleCapability);
    const cap = runtime.find('cap.greeter')!;
    // Registered -> Active skips Resolved and is not allowed by the FSM.
    expect(() => cap.setStatus('Active')).toThrow(CapabilityError);
  });
});

describe('Capability Runtime — validation', () => {
  it('reports a missing dependency', () => {
    const { runtime } = makeRuntime();
    runtime.register({ id: 'cap.orphan', dependencies: ['cap.none'], activator: () => ({}) });
    const report = runtime.validate();
    expect(report.isValid).toBe(false);
    expect(report.errors.some((e) => e.code === 'MISSING_DEPENDENCY')).toBe(true);
  });

  it('detects a circular dependency', () => {
    const { runtime } = makeRuntime();
    runtime.register({ id: 'cap.x', dependencies: ['cap.y'], activator: () => ({}) });
    runtime.register({ id: 'cap.y', dependencies: ['cap.x'], activator: () => ({}) });
    const report = runtime.validate();
    expect(report.isValid).toBe(false);
    expect(report.errors.some((e) => e.code === 'CIRCULAR_DEPENDENCY')).toBe(true);
  });

  it('passes validation for a well-formed graph', () => {
    const { runtime } = makeRuntime();
    runtime.register({ id: 'cap.base', activator: () => ({}) });
    runtime.register({ id: 'cap.derived', dependencies: ['cap.base'], activator: () => ({}) });
    const report = runtime.validate();
    expect(report.isValid).toBe(true);
  });
});

describe('Capability Runtime — builder integration', () => {
  it('is aware of capabilities declared on an attached builder', () => {
    const { runtime } = makeRuntime();
    runtime.register(simpleCapability);
    const fakeBuilder = {
      capabilityCatalog: {
        hasCapability: (id: string) => id === 'cap.greeter',
        getCapability: () => ({}),
      },
    };
    runtime.attachBuilder(fakeBuilder);
    expect(runtime.isBuilderAware('cap.greeter')).toBe(true);
    expect(runtime.isBuilderAware('cap.other')).toBe(false);
  });
});

describe('Capability Runtime — regression: integration with DI container & registry', () => {
  it('mirrors an activator capability into the container as a DI service', () => {
    const { runtime, container } = makeRuntime(true);
    runtime.register(simpleCapability);
    expect(container).toBeDefined();
    const viaRuntime = runtime.resolve<{ greet: (n: string) => string }>('cap.greeter');
    const viaContainer = container!.resolve<{ greet: (n: string) => string }>('cap.greeter');
    // Same cached instance — the registry remains the single source of truth.
    expect(viaContainer).toBe(viaRuntime);
  });

  it('exposes capabilities through the Platform Service Registry', () => {
    const { runtime, registry } = makeRuntime();
    runtime.register(simpleCapability);
    expect(registry.exists('cap.greeter')).toBe(true);
  });
});
