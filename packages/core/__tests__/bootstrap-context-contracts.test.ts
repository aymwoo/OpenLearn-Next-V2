import { describe, it, expect } from 'vitest';
import {
  IPlatformContext,
  IBootstrapContext,
  IEnvironmentContext,
  IRuntimeMetadata,
  PlatformStage,
  DEFAULT_BOOTSTRAP_CONFIG,
} from '../bootstrap/types/index.js';

describe('PI-002 Bootstrap Context Contracts Test Suite', () => {
  it('should construct a valid mock IEnvironmentContext', () => {
    const envCtx: IEnvironmentContext = {
      type: 'development',
      isDevelopment: true,
      isProduction: false,
      isTest: false,
      isPluginSandbox: false,
    };

    expect(envCtx.type).toBe('development');
    expect(envCtx.isDevelopment).toBe(true);
    expect(envCtx.isPluginSandbox).toBe(false);
  });

  it('should construct a valid mock IRuntimeMetadata', () => {
    const metadata: IRuntimeMetadata = {
      os: 'linux',
      nodeVersion: 'v20.0.0',
      arch: 'x64',
      processId: 12345,
      memoryUsage: { heapUsed: 100, heapTotal: 200, rss: 300 },
      buildVersion: '2.5.0',
    };

    expect(metadata.os).toBe('linux');
    expect(metadata.processId).toBe(12345);
    expect(metadata.buildVersion).toBe('2.5.0');
  });

  it('should verify structure of IPlatformContext and IBootstrapContext contracts', () => {
    const mockPlatformContext: Partial<IPlatformContext> = {
      platformId: 'plt_123',
      version: '2.5.0',
      namespace: 'openlearn.core',
      mode: 'standalone',
      config: DEFAULT_BOOTSTRAP_CONFIG,
      bootstrapState: 'Uninitialized',
    };

    const mockBootstrapContext: Partial<IBootstrapContext> = {
      startupTimestamp: 1600000000000,
      startupStage: PlatformStage.Created,
      isCancelled: false,
      platformContext: mockPlatformContext as IPlatformContext,
    };

    expect(mockBootstrapContext.startupStage).toBe('Created');
    expect(mockBootstrapContext.isCancelled).toBe(false);
    expect(mockBootstrapContext.platformContext?.platformId).toBe('plt_123');
  });
});
