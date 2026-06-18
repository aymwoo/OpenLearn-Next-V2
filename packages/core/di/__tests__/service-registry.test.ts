/**
 * Unit tests for ServiceRegistry — DI container core.
 *
 * TDD RED phase: minimal test file that exercises the core register / resolve
 * flow.  The ServiceRegistry class does NOT exist yet, so this test file is
 * expected to fail on the first run (import error).
 *
 * Covers:
 * - Basic register and resolve (SC-2)
 * - Duplicate registration rejection (D-08)
 * - Missing dependency rejection (D-06)
 * - Unregister (SC-5, basic)
 * - registerOrReplace (D-08)
 * - Circular dependency detection (SC-4)
 * - Chained dependency resolution (SC-3)
 * - Introspection API: list / has / dependencies (D-10)
 * - HasDependentError on unregister (D-09)
 * - optional dependencies (D-14)
 */
import { describe, it, expect } from 'vitest';
import { Token } from '../token.js';
import { ServiceRegistry } from '../service-registry.js';
import {
  DuplicateRegistrationError,
  MissingDependencyError,
  CircularDependencyError,
  HasDependentError,
} from '../errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IServiceA {
  name: string;
}

interface IServiceB {
  name: string;
}

interface IServiceC {
  name: string;
}

function makeService(name: string) {
  return { name };
}

// ---------------------------------------------------------------------------
// 1. Basic register and resolve
// ---------------------------------------------------------------------------

describe('ServiceRegistry — basic register and resolve', () => {
  it('should register and resolve a service instance (SC-2)', async () => {
    const registry = new ServiceRegistry();
    const token = new Token<IServiceA>('@openlearn/core:IServiceA');
    const instance = makeService('serviceA');

    await registry.register(token, instance);
    const resolved = await registry.resolve(token);

    expect(resolved).toBe(instance); // same reference
    expect(resolved.name).toBe('serviceA');
  });

  it('should throw "No provider" for unregistered token', async () => {
    const registry = new ServiceRegistry();
    const token = new Token<IServiceA>('@openlearn/core:IServiceA');

    await expect(registry.resolve(token)).rejects.toThrow(
      /No provider registered for token: @openlearn\/core:IServiceA/
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Duplicate registration
// ---------------------------------------------------------------------------

describe('ServiceRegistry — duplicate registration', () => {
  it('should throw DuplicateRegistrationError when registering the same token twice (D-08)', async () => {
    const registry = new ServiceRegistry();
    const token = new Token<IServiceA>('@openlearn/core:IServiceA');
    const instance = makeService('serviceA');

    await registry.register(token, instance);

    await expect(registry.register(token, instance)).rejects.toThrow(
      DuplicateRegistrationError
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Dependency declaration and resolution
// ---------------------------------------------------------------------------

describe('ServiceRegistry — dependency declaration and resolution', () => {
  it('should register a service with requires when dependencies exist (D-06)', async () => {
    const registry = new ServiceRegistry();
    const tokenA = new Token<IServiceA>('@openlearn/core:IServiceA');
    const tokenB = new Token<IServiceB>('@openlearn/core:IServiceB');

    await registry.register(tokenA, makeService('serviceA'));
    await registry.register(tokenB, makeService('serviceB'), {
      requires: [tokenA.name],
    });

    const resolvedA = await registry.resolve(tokenA);
    const resolvedB = await registry.resolve(tokenB);
    expect(resolvedA.name).toBe('serviceA');
    expect(resolvedB.name).toBe('serviceB');
  });

  it('should throw MissingDependencyError when required dep is not registered (D-06)', async () => {
    const registry = new ServiceRegistry();
    const tokenB = new Token<IServiceB>('@openlearn/core:IServiceB');
    const missingName = '@openlearn/core:IServiceA';

    try {
      await registry.register(tokenB, makeService('serviceB'), {
        requires: [missingName],
      });
      expect.unreachable('Expected MissingDependencyError');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingDependencyError);
      if (err instanceof MissingDependencyError) {
        expect(err.tokenName).toBe(tokenB.name);
        expect(err.missingDeps).toContain(missingName);
      }
    }
  });

  it('should resolve a chain A→B→C registered in dependency order (SC-3)', async () => {
    const registry = new ServiceRegistry();
    const tokenA = new Token<IServiceA>('@openlearn/core:IServiceA');
    const tokenB = new Token<IServiceB>('@openlearn/core:IServiceB');
    const tokenC = new Token<IServiceC>('@openlearn/core:IServiceC');

    // Register in dependency order: C first (no deps), then B (depends on C), then A (depends on B)
    await registry.register(tokenC, makeService('serviceC'));
    await registry.register(tokenB, makeService('serviceB'), {
      requires: [tokenC.name],
    });
    await registry.register(tokenA, makeService('serviceA'), {
      requires: [tokenB.name],
    });

    const resolvedA = await registry.resolve(tokenA);
    const resolvedB = await registry.resolve(tokenB);
    const resolvedC = await registry.resolve(tokenC);

    expect(resolvedA.name).toBe('serviceA');
    expect(resolvedB.name).toBe('serviceB');
    expect(resolvedC.name).toBe('serviceC');
  });
});

// ---------------------------------------------------------------------------
// 4. Circular dependency detection
// ---------------------------------------------------------------------------

describe('ServiceRegistry — circular dependency detection', () => {
  it('should detect direct cycle A↔B (SC-4)', () => {
    const registry = new ServiceRegistry();
    const tokenA = new Token<IServiceA>('@openlearn/core:IServiceA');
    const tokenB = new Token<IServiceB>('@openlearn/core:IServiceB');

    // Register in a way that creates a cycle
    // A requires B, B requires A — but we can't register both via register()
    // because register-time checks require deps to exist.  We need
    // registerOrReplace to break the chicken-and-egg problem first,
    // THEN topo check should catch it.
    //
    // Strategy: register A without deps, then registerOrReplace A with B dep.
    registry.register(tokenA, makeService('serviceA'));
    registry.register(tokenB, makeService('serviceB'), {
      requires: [tokenA.name],
    });
    // Now replace A to depend on B, creating A↔B cycle
    registry.registerOrReplace(tokenA, makeService('serviceA'), {
      requires: [tokenB.name],
    });

    // The topological order check should detect the cycle.
    try {
      (registry as any).topologicalOrder([tokenA.name, tokenB.name]);
      // Should not reach here
      expect.unreachable('Expected CircularDependencyError');
    } catch (err) {
      expect(err).toBeInstanceOf(CircularDependencyError);
      if (err instanceof CircularDependencyError) {
        // SC-4: error message must include participating token names
        expect(err.cycleTokens).toContain(tokenA.name);
        expect(err.cycleTokens).toContain(tokenB.name);
      }
    }
  });

  it('should detect indirect cycle A→B→C→A (SC-4)', () => {
    const registry = new ServiceRegistry();
    const tokenA = new Token<IServiceA>('@openlearn/core:IServiceA');
    const tokenB = new Token<IServiceB>('@openlearn/core:IServiceB');
    const tokenC = new Token<IServiceC>('@openlearn/core:IServiceC');

    // Register A first
    registry.register(tokenA, makeService('serviceA'));
    // Register B depends on A
    registry.register(tokenB, makeService('serviceB'), {
      requires: [tokenA.name],
    });
    // Register C depends on B
    registry.register(tokenC, makeService('serviceC'), {
      requires: [tokenB.name],
    });
    // Replace A to depend on C, creating A→B→C→A cycle
    registry.registerOrReplace(tokenA, makeService('serviceA'), {
      requires: [tokenC.name],
    });

    expect(() => {
      (registry as any).topologicalOrder([
        tokenA.name,
        tokenB.name,
        tokenC.name,
      ]);
    }).toThrow(CircularDependencyError);
  });
});

// ---------------------------------------------------------------------------
// 5. registerOrReplace
// ---------------------------------------------------------------------------

describe('ServiceRegistry — registerOrReplace', () => {
  it('should replace old instance and return new one on resolve', async () => {
    const registry = new ServiceRegistry();
    const token = new Token<IServiceA>('@openlearn/core:IServiceA');

    await registry.register(token, makeService('serviceA-v1'));
    await registry.registerOrReplace(token, makeService('serviceA-v2'));

    const resolved = await registry.resolve(token);
    expect(resolved.name).toBe('serviceA-v2');
  });

  it('should clear old dependency edges after replace', async () => {
    const registry = new ServiceRegistry();
    const tokenA = new Token<IServiceA>('@openlearn/core:IServiceA');
    const tokenB = new Token<IServiceB>('@openlearn/core:IServiceB');

    // A depends on B
    await registry.register(tokenB, makeService('serviceB'));
    await registry.register(tokenA, makeService('serviceA'), {
      requires: [tokenB.name],
    });

    // Replace A with no dependencies
    await registry.registerOrReplace(tokenA, makeService('serviceA-v2'));

    const deps = registry.dependencies(tokenA.name);
    expect(deps?.requires).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Unregister
// ---------------------------------------------------------------------------

describe('ServiceRegistry — unregister', () => {
  it('should unregister and resolve should throw (SC-5)', async () => {
    const registry = new ServiceRegistry();
    const token = new Token<IServiceA>('@openlearn/core:IServiceA');

    await registry.register(token, makeService('serviceA'));
    await registry.unregister(token);

    await expect(registry.resolve(token)).rejects.toThrow(
      /No provider registered for token: @openlearn\/core:IServiceA/
    );
  });

  it('should throw HasDependentError when unregistering a service with dependents (D-09)', async () => {
    const registry = new ServiceRegistry();
    const tokenA = new Token<IServiceA>('@openlearn/core:IServiceA');
    const tokenB = new Token<IServiceB>('@openlearn/core:IServiceB');

    await registry.register(tokenB, makeService('serviceB'));
    await registry.register(tokenA, makeService('serviceA'), {
      requires: [tokenB.name],
    });

    try {
      await registry.unregister(tokenB);
      expect.unreachable('Expected HasDependentError');
    } catch (err) {
      expect(err).toBeInstanceOf(HasDependentError);
      if (err instanceof HasDependentError) {
        // D-09: error message must include dependent name
        expect(err.dependents).toContain(tokenA.name);
        expect(err.tokenName).toBe(tokenB.name);
      }
    }
  });

  it('should clean up dependents reference when unregistering the dependent', async () => {
    const registry = new ServiceRegistry();
    const tokenA = new Token<IServiceA>('@openlearn/core:IServiceA');
    const tokenB = new Token<IServiceB>('@openlearn/core:IServiceB');

    await registry.register(tokenB, makeService('serviceB'));
    await registry.register(tokenA, makeService('serviceA'), {
      requires: [tokenB.name],
    });

    // Unregister A (the dependent) — should succeed
    await registry.unregister(tokenA);

    // B's dependents should no longer include A
    const deps = registry.dependencies(tokenB.name);
    expect(deps?.dependents).not.toContain(tokenA.name);
    expect(registry.has(tokenA)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Introspection API
// ---------------------------------------------------------------------------

describe('ServiceRegistry — introspection API', () => {
  it('should list all registered tokens (D-10)', async () => {
    const registry = new ServiceRegistry();
    const tokenA = new Token<IServiceA>('@openlearn/core:IServiceA');
    const tokenB = new Token<IServiceB>('@openlearn/core:IServiceB');

    await registry.register(tokenA, makeService('serviceA'));
    await registry.register(tokenB, makeService('serviceB'));

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.name).sort()).toEqual([
      '@openlearn/core:IServiceA',
      '@openlearn/core:IServiceB',
    ]);
  });

  it('should return correct has() status', async () => {
    const registry = new ServiceRegistry();
    const token = new Token<IServiceA>('@openlearn/core:IServiceA');

    expect(registry.has(token)).toBe(false);

    await registry.register(token, makeService('serviceA'));
    expect(registry.has(token)).toBe(true);

    await registry.unregister(token);
    expect(registry.has(token)).toBe(false);
  });

  it('should return correct dependencies sub-graph', async () => {
    const registry = new ServiceRegistry();
    const tokenA = new Token<IServiceA>('@openlearn/core:IServiceA');
    const tokenB = new Token<IServiceB>('@openlearn/core:IServiceB');

    await registry.register(tokenB, makeService('serviceB'));
    await registry.register(tokenA, makeService('serviceA'), {
      requires: [tokenB.name],
    });

    const depsA = registry.dependencies(tokenA.name);
    expect(depsA?.requires).toEqual(['@openlearn/core:IServiceB']);
    expect(depsA?.dependents).toEqual([]);

    const depsB = registry.dependencies(tokenB.name);
    expect(depsB?.requires).toEqual([]);
    expect(depsB?.dependents).toEqual(['@openlearn/core:IServiceA']);
  });
});

// ---------------------------------------------------------------------------
// 8. Optional dependencies
// ---------------------------------------------------------------------------

describe('ServiceRegistry — optional dependencies', () => {
  it('should NOT prevent registration when optional dep is missing (D-14)', async () => {
    const registry = new ServiceRegistry();
    const token = new Token<IServiceA>('@openlearn/core:IServiceA');

    await expect(
      registry.register(token, makeService('serviceA'), {
        optional: ['@openlearn/core:INotRegistered'],
      })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. Phase 6: Version tracking + resolveByName
// ---------------------------------------------------------------------------

describe('ServiceRegistry — version tracking + resolveByName (Phase 6)', () => {
  it('should store version from Token on register', async () => {
    const registry = new ServiceRegistry();
    const token = new Token<IServiceA>('@openlearn/core:IServiceVersioned', '2.0.0');
    await registry.register(token, makeService('v2'));

    expect(registry.getVersion('@openlearn/core:IServiceVersioned')).toBe('2.0.0');
  });

  it('should store default version (1.0.0) when Token has no explicit version', async () => {
    const registry = new ServiceRegistry();
    const token = new Token<IServiceA>('@openlearn/core:IServiceDefault');
    await registry.register(token, makeService('default'));

    expect(registry.getVersion('@openlearn/core:IServiceDefault')).toBe('1.0.0');
  });

  it('should return undefined for unregistered token name', () => {
    const registry = new ServiceRegistry();
    expect(registry.getVersion('@openlearn/core:IDoesNotExist')).toBeUndefined();
  });

  it('should resolve service by string name (Token Registry pattern)', async () => {
    const registry = new ServiceRegistry();
    const token = new Token<IServiceA>('@openlearn/core:IServiceByName');
    const instance = makeService('byName');
    await registry.register(token, instance);

    const resolved = await registry.resolveByName('@openlearn/core:IServiceByName');
    expect(resolved).toBe(instance);
  });

  it('should throw "No provider" for resolveByName with unregistered name', async () => {
    const registry = new ServiceRegistry();
    await expect(
      registry.resolveByName('@openlearn/core:INonExistent')
    ).rejects.toThrow(/No provider registered for token name/);
  });
});
