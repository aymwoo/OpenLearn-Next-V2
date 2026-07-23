import { describe, it, expect, vi } from 'vitest';
import {
  PlatformCompositionRoot,
  CompositionModule,
} from '../bootstrap/composition/index.js';
import { ConfigurationError } from '../bootstrap/types/index.js';

describe('PI-006 Platform Composition Root Test Suite', () => {
  it('should instantiate PlatformCompositionRoot in Created state', () => {
    const root = PlatformCompositionRoot.create();
    expect(root.state).toBe('Created');
  });

  it('should register composition modules and compose infrastructure dependencies cleanly', () => {
    const composeSpy = vi.fn();
    const module1: CompositionModule = {
      id: 'mod_infra_log',
      name: 'InfraLoggerModule',
      compose: composeSpy,
    };

    const root = PlatformCompositionRoot.create();
    root.registerModule(module1);

    const result = root.compose({ environment: 'development' });

    expect(composeSpy).toHaveBeenCalledTimes(1);
    expect(result.validation.isValid).toBe(true);
    expect(result.context.environment.type).toBe('development');
    expect(root.state).toBe('Composed');
  });

  it('should validate composition and detect duplicate module IDs', () => {
    const mod1: CompositionModule = { id: 'dup_mod', name: 'Module 1', compose: () => {} };
    const mod2: CompositionModule = { id: 'dup_mod', name: 'Module 2', compose: () => {} };

    const root = PlatformCompositionRoot.create()
      .registerModule(mod1)
      .registerModule(mod2);

    expect(() => root.compose()).toThrow(ConfigurationError);
  });

  it('should prevent module registration after composition or disposal', () => {
    const root = PlatformCompositionRoot.create();
    root.compose();

    const newMod: CompositionModule = { id: 'new_mod', name: 'New Mod', compose: () => {} };
    expect(() => root.registerModule(newMod)).toThrow('Cannot register composition module');

    root.dispose();
    expect(root.state).toBe('Disposed');
  });
});
