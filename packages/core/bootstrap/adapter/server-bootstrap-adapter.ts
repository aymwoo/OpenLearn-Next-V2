/**
 * OpenLearn Platform Kernel - Server Bootstrap Adapter (PI-005)
 * Adapter pattern bridging server.ts -> PlatformBuilder -> BootstrapPipeline -> Existing Startup Logic.
 */

import { PlatformBuilder } from '../builder/platform-builder.js';
import { PlatformBuilderResult } from '../builder/builder-types.js';
import { StartupAdapterContext, AdapterState } from './adapter-types.js';
import { BootstrapRegistration } from './bootstrap-registration.js';
import { PipelineResult } from '../pipeline/pipeline-types.js';

export class ServerBootstrapAdapter {
  private _state: AdapterState = 'Created';
  private _builder: PlatformBuilder;

  private constructor(options?: StartupAdapterContext) {
    this._state = 'Created';
    this._builder = PlatformBuilder.create();
    if (options) {
      this.configure(options);
    }
  }

  public static create(options?: StartupAdapterContext): ServerBootstrapAdapter {
    return new ServerBootstrapAdapter(options);
  }

  public get state(): AdapterState {
    return this._state;
  }

  public configure(context: StartupAdapterContext): this {
    this._state = 'Configuring';
    BootstrapRegistration.registerConfiguration(this._builder, context);
    BootstrapRegistration.registerLogger(this._builder, context);
    BootstrapRegistration.registerInfrastructure(this._builder, context);
    return this;
  }

  public registerStages(): this {
    BootstrapRegistration.registerExistingBootstrapStages(this._builder);
    this._state = 'PipelineRegistered';
    return this;
  }

  public async runBootstrap(context: StartupAdapterContext): Promise<{ builderResult: PlatformBuilderResult; pipelineResult: PipelineResult }> {
    if (this._state === 'Created') {
      this.configure(context);
    }
    if (this._state === 'Configuring') {
      this.registerStages();
    }

    const builderResult = this._builder.buildResult();
    const pipelineResult = await builderResult.pipeline.execute({
      startupTimestamp: Date.now(),
      startupOptions: {},
      startupStage: builderResult.platformContext.currentStage,
      startupToken: { token: 'srv_adapter_token', isCancelled: false, cancel: () => {} },
      isCancelled: false,
      platformContext: builderResult.platformContext,
      config: builderResult.platformContext.config,
      state: 'Active',
      currentStage: builderResult.platformContext.currentStage,
      startTime: Date.now(),
      getMetadata: () => undefined,
      setStage: () => {},
    });

    if (pipelineResult.status === 'Failed') {
      throw pipelineResult.error || new Error(`ServerBootstrapAdapter pipeline failed at stage: ${pipelineResult.failedStage}`);
    }

    this._state = 'Bootstrapped';
    return { builderResult, pipelineResult };
  }

  public static async bootstrap(context: StartupAdapterContext): Promise<{ builderResult: PlatformBuilderResult; pipelineResult: PipelineResult }> {
    const adapter = ServerBootstrapAdapter.create(context);
    return adapter.runBootstrap(context);
  }
}
