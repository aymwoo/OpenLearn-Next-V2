import { describe, it, expect, vi } from 'vitest';
import { PlatformBuilder } from '../bootstrap/builder/index.js';
import { IBootstrapStage } from '../bootstrap/pipeline/index.js';
import { ConfigurationError } from '../bootstrap/types/index.js';

describe('PI-004 PlatformBuilder Test Suite', () => {
  it('should instantiate via PlatformBuilder.create() in Created state', () => {
    const builder = PlatformBuilder.create();
    expect(builder.state).toBe('Created');
  });

  it('should support fluent APIs and state transitions', () => {
    const builder = PlatformBuilder.create()
      .withEnvironment('test')
      .withConfiguration({ port: 9005 })
      .withMetadata('owner', 'openlearn-team');

    expect(builder.state).toBe('Configuring');
  });

  it('should validate configuration and detect duplicate stage registration', () => {
    const stage1: IBootstrapStage = {
      id: 'duplicate_id',
      name: 'Stage 1',
      description: 'First stage',
      execute: async () => {},
    };

    const stage2: IBootstrapStage = {
      id: 'duplicate_id',
      name: 'Stage 2',
      description: 'Second stage with duplicate ID',
      execute: async () => {},
    };

    const builder = PlatformBuilder.create()
      .addBootstrapStage(stage1)
      .addBootstrapStage(stage2);

    expect(() => builder.buildResult()).toThrow(ConfigurationError);
  });

  it('should validate port range and throw ConfigurationError on invalid port', () => {
    const builder = PlatformBuilder.create().withConfiguration({ port: -1 });
    expect(() => builder.buildResult()).toThrow(ConfigurationError);
  });

  it('should construct PlatformBuilderResult without automatically starting platform execution', () => {
    const executeSpy = vi.fn();
    const mockStage: IBootstrapStage = {
      id: 'custom_stage',
      name: 'CustomStage',
      description: 'Custom test stage',
      execute: executeSpy,
    };

    const builder = PlatformBuilder.create()
      .withEnvironment('development')
      .withConfiguration({ port: 9000 })
      .addBootstrapStage(mockStage);

    const result = builder.buildResult();

    expect(result.builderVersion).toBe('0.2.5');
    expect(result.validation.isValid).toBe(true);
    expect(result.platformContext.environment.type).toBe('development');
    expect(result.pipeline.stages.some((s) => s.id === 'custom_stage')).toBe(true);
    expect(builder.state).toBe('Built');

    // Confirm that buildResult() constructed the objects WITHOUT executing the stage!
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('should prevent invalid state transitions after being disposed', () => {
    const builder = PlatformBuilder.create();
    builder.dispose();
    expect(builder.state).toBe('Disposed');

    expect(() => builder.withEnvironment('test')).toThrow('disposed');
  });
});
