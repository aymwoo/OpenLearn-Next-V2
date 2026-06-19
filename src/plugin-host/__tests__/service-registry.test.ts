// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { FrontendServiceRegistry } from '../service-registry';

describe('FrontendServiceRegistry', () => {
  it('registers and resolves a service by token', async () => {
    const registry = new FrontendServiceRegistry();
    await registry.register('test-token', { foo: 'bar' });
    const result = await registry.resolve<{ foo: string }>('test-token');
    expect(result.foo).toBe('bar');
  });

  it('throws on duplicate registration (T-09-01)', async () => {
    const registry = new FrontendServiceRegistry();
    await registry.register('test-token', { value: 1 });
    await expect(registry.register('test-token', { value: 2 })).rejects.toThrow(
      'already registered',
    );
  });

  it('throws on resolve of unregistered token', async () => {
    const registry = new FrontendServiceRegistry();
    await expect(registry.resolve('nonexistent')).rejects.toThrow(
      'No provider registered for token: nonexistent',
    );
  });

  it('unregisters a token', async () => {
    const registry = new FrontendServiceRegistry();
    await registry.register('test-token', {});
    expect(registry.has('test-token')).toBe(true);
    await registry.unregister('test-token');
    expect(registry.has('test-token')).toBe(false);
  });

  it('checks if a token exists', async () => {
    const registry = new FrontendServiceRegistry();
    await registry.register('present', {});
    expect(registry.has('present')).toBe(true);
    expect(registry.has('absent')).toBe(false);
  });

  it('lists all registered services with names', async () => {
    const registry = new FrontendServiceRegistry();
    await registry.register('token-a', { x: 1 });
    await registry.register('token-b', { y: 2 });
    const entries = registry.list();
    expect(entries).toHaveLength(2);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['token-a', 'token-b']);
  });

  it('returns empty list when no services registered', async () => {
    const registry = new FrontendServiceRegistry();
    expect(registry.list()).toEqual([]);
  });
});
