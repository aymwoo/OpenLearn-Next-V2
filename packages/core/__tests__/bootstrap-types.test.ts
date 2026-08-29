import { describe, it, expect } from 'vitest';
import {
  PlatformStage,
  BOOTSTRAP_STAGE_NAMES,
  DEFAULT_BOOTSTRAP_CONFIG,
  PLATFORM_VERSION,
  PLATFORM_KERNEL_NAME,
  BOOTSTRAP_TIMEOUT,
  DEFAULT_SCOPE,
  DEFAULT_NAMESPACE,
  EVENT_NAMESPACE,
  PlatformBootstrapError,
  ConfigurationError,
  DependencyError,
  RegistrationError,
  LifecycleError,
  StartupTimeoutError,
} from '../bootstrap/types/index.js';

describe('EU-01 Platform Bootstrap Types & Contracts Test Suite', () => {
  describe('1. PlatformStage Enum & Stage Constants', () => {
    it('should define PlatformStage enum members', () => {
      expect(PlatformStage.Created).toBe('Created');
      expect(PlatformStage.Configuring).toBe('Configuring');
      expect(PlatformStage.Registering).toBe('Registering');
      expect(PlatformStage.Initializing).toBe('Initializing');
      expect(PlatformStage.Activating).toBe('Activating');
      expect(PlatformStage.Ready).toBe('Ready');
      expect(PlatformStage.ShuttingDown).toBe('ShuttingDown');
      expect(PlatformStage.Disposed).toBe('Disposed');
    });

    it('should maintain immutable BOOTSTRAP_STAGE_NAMES constant in exact 8-stage sequence', () => {
      expect(BOOTSTRAP_STAGE_NAMES).toEqual([
        PlatformStage.Created,
        PlatformStage.Configuring,
        PlatformStage.Registering,
        PlatformStage.Initializing,
        PlatformStage.Activating,
        PlatformStage.Ready,
        PlatformStage.ShuttingDown,
        PlatformStage.Disposed,
      ]);
      expect(Object.isFrozen(BOOTSTRAP_STAGE_NAMES)).toBe(true);
    });
  });

  describe('2. Error Hierarchy', () => {
    it('should format PlatformBootstrapError and maintain cause', () => {
      const cause = new Error('Root cause');
      const err = new PlatformBootstrapError('Failed to start', PlatformStage.Initializing, cause);
      expect(err.message).toBe('[PlatformBootstrapError:Initializing] Failed to start');
      expect(err.stage).toBe(PlatformStage.Initializing);
      expect(err.cause).toBe(cause);
      expect(err.name).toBe('PlatformBootstrapError');
    });

    it('should instantiate specialized PlatformBootstrapError subclasses', () => {
      const cfgErr = new ConfigurationError('Invalid port');
      expect(cfgErr instanceof PlatformBootstrapError).toBe(true);
      expect(cfgErr.stage).toBe(PlatformStage.Configuring);

      const depErr = new DependencyError('Unresolved DB service');
      expect(depErr instanceof PlatformBootstrapError).toBe(true);
      expect(depErr.stage).toBe(PlatformStage.Registering);

      const regErr = new RegistrationError('Duplicate capability ID');
      expect(regErr instanceof PlatformBootstrapError).toBe(true);
      expect(regErr.stage).toBe(PlatformStage.Registering);

      const lcErr = new LifecycleError('Cannot transition from Disposed to Ready');
      expect(lcErr instanceof PlatformBootstrapError).toBe(true);

      const timeoutErr = new StartupTimeoutError('Activation stage timed out');
      expect(timeoutErr instanceof PlatformBootstrapError).toBe(true);
    });
  });

  describe('3. Platform Constants', () => {
    it('should export valid platform constants', () => {
      expect(PLATFORM_VERSION).toBe('0.2.3');
      expect(PLATFORM_KERNEL_NAME).toBe('OpenLearn Platform Kernel');
      expect(BOOTSTRAP_TIMEOUT).toBe(30000);
      expect(DEFAULT_SCOPE).toBe('Singleton');
      expect(DEFAULT_NAMESPACE).toBe('openlearn.core');
      expect(EVENT_NAMESPACE).toBe('openlearn.event');
    });

    it('should maintain default bootstrap config immutability', () => {
      expect(DEFAULT_BOOTSTRAP_CONFIG.port).toBe(9000);
      expect(DEFAULT_BOOTSTRAP_CONFIG.environment).toBe('development');
      expect(DEFAULT_BOOTSTRAP_CONFIG.mode).toBe('standalone');
      expect(Object.isFrozen(DEFAULT_BOOTSTRAP_CONFIG)).toBe(true);
    });
  });
});
