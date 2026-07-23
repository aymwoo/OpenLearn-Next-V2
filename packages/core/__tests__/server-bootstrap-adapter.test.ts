import { describe, it, expect, vi } from 'vitest';
import {
  ServerBootstrapAdapter,
  StartupAdapterContext,
} from '../bootstrap/adapter/index.js';

describe('PI-005 Server Bootstrap Adapter Test Suite', () => {
  it('should instantiate ServerBootstrapAdapter in Created state', () => {
    const adapter = ServerBootstrapAdapter.create();
    expect(adapter.state).toBe('Created');
  });

  it('should configure and register stages cleanly', () => {
    const context: StartupAdapterContext = {
      environment: 'test',
      config: { port: 9010 },
    };

    const adapter = ServerBootstrapAdapter.create();
    adapter.configure(context);
    expect(adapter.state).toBe('Configuring');

    adapter.registerStages();
    expect(adapter.state).toBe('PipelineRegistered');
  });

  it('should execute bootstrap pipeline via ServerBootstrapAdapter.bootstrap() and transition state to Bootstrapped', async () => {
    const mockKernel = { db: {}, eventBus: {} };
    const context: StartupAdapterContext = {
      environment: 'development',
      config: { port: 9000 },
      kernelContainer: mockKernel,
    };

    const { builderResult, pipelineResult } = await ServerBootstrapAdapter.bootstrap(context);

    expect(pipelineResult.status).toBe('Success');
    expect(pipelineResult.stageResults.length).toBe(5);
    expect(builderResult.platformContext.environment.type).toBe('development');
  });

  it('should propagate pipeline failure if a stage throws an error', async () => {
    const badContext: StartupAdapterContext = {
      environment: 'invalid_env' as any, // Causes BuilderValidation error
      config: { port: -100 },
    };

    await expect(ServerBootstrapAdapter.bootstrap(badContext)).rejects.toThrow();
  });
});
