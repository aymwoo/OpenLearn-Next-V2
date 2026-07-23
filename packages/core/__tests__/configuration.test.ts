/**
 * Unit tests for the Platform Configuration System (PI-011).
 *
 * Covers: configuration loading, validation (required/type/range/enum/default),
 * reload, snapshot (immutable read view), provider registration, missing
 * configuration, environment source, and regression checks for integration
 * with the ServiceRegistry / DI container / EventBus / PlatformBuilder.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlatformConfiguration } from '../configuration/PlatformConfiguration.js';
import { ConfigurationError } from '../configuration/ConfigurationError.js';

const logger = { info() {}, warn() {}, error() {} } as unknown as import('../../bootstrap/types/index.js').IPlatformLogger;

function makeConfig(options?: Record<string, unknown>): PlatformConfiguration {
  return new PlatformConfiguration({ logger, ...options });
}

describe('Platform Configuration — loading', () => {
  it('loads memory values (including nested) and exposes them by path', async () => {
    const cfg = makeConfig();
    cfg.registerMemory({ appName: 'OpenLearn', nested: { max: 5 } });
    const result = await cfg.load();
    expect(cfg.get('appName')).toBe('OpenLearn');
    expect(cfg.get('nested.max')).toBe(5);
    expect(result.report.isValid).toBe(true);
  });

  it('seeds kernel defaults from DEFAULT_BOOTSTRAP_CONFIG', async () => {
    const cfg = makeConfig();
    await cfg.load();
    expect(cfg.get('port')).toBe(9000);
    expect(cfg.get('environment')).toBe('development');
  });

  it('merges multiple providers with priority (higher wins)', async () => {
    const cfg = makeConfig();
    cfg.registerMemory({ value: 'low' }, { id: 'low', priority: 1 });
    cfg.registerMemory({ value: 'high' }, { id: 'high', priority: 100 });
    await cfg.load();
    expect(cfg.get('value')).toBe('high');
  });
});

describe('Platform Configuration — provider registration', () => {
  it('rejects duplicate provider ids', () => {
    const cfg = makeConfig();
    cfg.registerMemory({ a: 1 }, { id: 'dup' });
    expect(() => cfg.registerMemory({ a: 2 }, { id: 'dup' })).toThrow(ConfigurationError);
  });

  it('removes a provider', async () => {
    const cfg = makeConfig();
    cfg.registerMemory({ a: 1 }, { id: 'p' });
    expect(cfg.removeProvider('p')).toBe(true);
    expect(cfg.removeProvider('p')).toBe(false);
    await cfg.load();
    expect(cfg.exists('a')).toBe(false);
  });
});

describe('Platform Configuration — validation', () => {
  const descriptors = [
    { path: 'kernel.port', scope: 'Kernel' as const, type: 'number' as const, required: true, min: 1, max: 65535 },
    { path: 'kernel.mode', scope: 'Kernel' as const, type: 'string' as const, enum: ['standalone', 'cluster'] },
  ];

  it('passes validation for valid values', async () => {
    const cfg = makeConfig();
    cfg.registerMemory({ kernel: { port: 8080, mode: 'cluster' } }, { id: 'k', scope: 'Kernel', descriptors });
    const { report } = await cfg.load();
    expect(report.isValid).toBe(true);
  });

  it('reports REQUIRED for a missing required key', async () => {
    const cfg = makeConfig();
    cfg.registerMemory({ kernel: { mode: 'cluster' } }, { id: 'k', scope: 'Kernel', descriptors });
    const { report } = await cfg.load();
    expect(report.isValid).toBe(false);
    expect(report.errors.some((e) => e.code === 'REQUIRED' && e.path === 'kernel.port')).toBe(true);
  });

  it('reports TYPE, RANGE and ENUM violations', async () => {
    const cfg = makeConfig();
    cfg.registerMemory(
      { kernel: { port: 'not-a-number', mode: 'invalid' } },
      { id: 'k', scope: 'Kernel', descriptors },
    );
    // port out of range too: but type fails first -> still flagged
    const { report } = await cfg.load();
    expect(report.errors.some((e) => e.code === 'TYPE')).toBe(true);
    expect(report.errors.some((e) => e.code === 'ENUM')).toBe(true);

    const cfg2 = makeConfig();
    cfg2.registerMemory({ kernel: { port: 99999, mode: 'cluster' } }, { id: 'k', scope: 'Kernel', descriptors });
    const r2 = await cfg2.load();
    expect(r2.report.errors.some((e) => e.code === 'RANGE_MAX')).toBe(true);
  });

  it('applies descriptor default values for missing keys', async () => {
    const cfg = makeConfig();
    cfg.registerMemory({}, {
      id: 'd',
      descriptors: [{ path: 'feature.flag', scope: 'Platform' as const, type: 'boolean' as const, default: true }],
    });
    await cfg.load();
    expect(cfg.get('feature.flag')).toBe(true);
  });
});

describe('Platform Configuration — reload', () => {
  it('reflects provider changes after reload', async () => {
    const cfg = makeConfig();
    cfg.registerMemory({ token: 'v1' }, { id: 'p' });
    await cfg.load();
    expect(cfg.get('token')).toBe('v1');
    cfg.removeProvider('p');
    cfg.registerMemory({ token: 'v2' }, { id: 'p' });
    await cfg.reload();
    expect(cfg.get('token')).toBe('v2');
  });
});

describe('Platform Configuration — snapshot', () => {
  it('produces an immutable read view', async () => {
    const cfg = makeConfig();
    cfg.registerMemory({ appName: 'OpenLearn' });
    await cfg.load();
    const snap = cfg.snapshot();
    expect(snap.get('appName')).toBe('OpenLearn');
    expect(snap.tryGet('missing', 'fallback')).toBe('fallback');
    expect(snap.exists('appName')).toBe(true);
    // immutable: toObject returns a clone, frozen at root
    const obj = snap.toObject();
    expect(obj.appName).toBe('OpenLearn');
    expect(Array.isArray(snap.list())).toBe(true);
  });
});

describe('Platform Configuration — missing configuration', () => {
  it('returns fallback via tryGet and throws via get', async () => {
    const cfg = makeConfig();
    cfg.registerMemory({ present: 1 });
    await cfg.load();
    expect(cfg.tryGet('absent', 'def')).toBe('def');
    expect(() => cfg.get('absent')).toThrow(ConfigurationError);
  });
});

describe('Platform Configuration — environment source', () => {
  it('loads and coerces environment variables', async () => {
    const cfg = makeConfig();
    cfg.registerEnvironment({
      id: 'env',
      prefix: 'APP_',
      env: { APP_KERNEL_PORT: '9001', APP_DEBUG: 'true', APP_NAME: 'hello' },
    });
    await cfg.load();
    expect(cfg.get('kernel.port')).toBe(9001);
    expect(cfg.get('debug')).toBe(true);
    expect(cfg.get('name')).toBe('hello');
  });
});

describe('Platform Configuration — scope', () => {
  it('honors scope filtering when a descriptor exists', async () => {
    const cfg = makeConfig();
    cfg.registerMemory({ x: 1 }, {
      id: 'kp',
      scope: 'Kernel',
      descriptors: [{ path: 'x', scope: 'Kernel' as const, type: 'number' as const }],
    });
    await cfg.load();
    expect(cfg.get<number>('x', 'Kernel')).toBe(1);
    expect(cfg.get('x', 'Infrastructure')).toBeUndefined();
  });
});

describe('Platform Configuration — regression: integration', () => {
  it('registers itself as a service in the ServiceRegistry and DI container', async () => {
    const registered: Array<{ id: string }> = [];
    const instances: Array<{ id: string }> = [];
    const svc = {
      register: (d: { id: string }) => registered.push(d),
      exists: (id: string) => registered.some((r) => r.id === id),
      unregister: () => true,
    };
    const container = { registerInstance: (id: string) => instances.push({ id }) };

    const cfg = makeConfig({ serviceRegistry: svc, container });
    await cfg.load();
    expect(registered.some((r) => r.id === 'kernel.configuration')).toBe(true);
    expect(instances.some((i) => i.id === 'kernel.configuration')).toBe(true);
  });

  it('publishes a ConfigurationLoaded event on the EventBus', async () => {
    let published: unknown;
    const bus = { publishConfigurationLoaded: (config?: Record<string, unknown>) => { published = config; } };
    const cfg = makeConfig({ eventBus: bus });
    await cfg.load();
    expect(published).toBeDefined();
  });

  it('integrates with a PlatformBuilder source', async () => {
    const cfg = makeConfig();
    cfg.attachBuilder({ getConfiguration: () => ({ builderKey: 'fromBuilder' }) });
    expect(cfg.isBuilderAware()).toBe(true);
    await cfg.load();
    expect(cfg.get('builderKey')).toBe('fromBuilder');
  });

  it('loads from a JSON file source', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ fileKey: 'fileValue', nested: { n: 7 } }));
    try {
      const cfg = makeConfig();
      cfg.registerJsonFile(file);
      await cfg.load();
      expect(cfg.get('fileKey')).toBe('fileValue');
      expect(cfg.get('nested.n')).toBe(7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
