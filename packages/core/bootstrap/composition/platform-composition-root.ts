/**
 * OpenLearn Platform Kernel - Platform Composition Root (PI-006)
 * Single place responsible for assembling platform infrastructure dependencies.
 */

import {
  CompositionState,
  CompositionContextOptions,
  CompositionResult,
  CompositionModule,
} from './composition-types.js';
import { CompositionValidator } from './composition-validator.js';
import { PlatformBuilder } from '../builder/platform-builder.js';
import { ConfigurationError } from '../types/index.js';

export class PlatformCompositionRoot {
  private _state: CompositionState = 'Created';
  private _modules: CompositionModule[] = [];

  private constructor() {
    this._state = 'Created';
  }

  public static create(): PlatformCompositionRoot {
    return new PlatformCompositionRoot();
  }

  public get state(): CompositionState {
    return this._state;
  }

  public registerModule(module: CompositionModule): this {
    if (this._state === 'Disposed' || this._state === 'Composed') {
      throw new Error(`Cannot register composition module in state: ${this._state}`);
    }
    this._modules.push(module);
    return this;
  }

  public compose(options?: CompositionContextOptions): CompositionResult {
    const startTime = Date.now();
    this._state = 'Validating';

    const opts: CompositionContextOptions = options || {};
    const builder = PlatformBuilder.create();

    if (opts.config) builder.withConfiguration(opts.config);
    if (opts.logger) builder.withLogger(opts.logger);
    if (opts.environment) builder.withEnvironment(opts.environment);

    const builderResult = builder.buildResult();
    const validation = CompositionValidator.validate(opts, builderResult.pipeline, this._modules);

    if (!validation.isValid) {
      throw new ConfigurationError(
        `CompositionRoot validation failed: ${validation.errors.map((e) => e.message).join('; ')}`
      );
    }

    this._state = 'Composing';
    for (const mod of this._modules) {
      mod.compose(opts);
    }

    const durationMs = Date.now() - startTime;
    this._state = 'Composed';

    return {
      context: builderResult.platformContext,
      pipeline: builderResult.pipeline,
      durationMs,
      validation,
    };
  }

  public dispose(): void {
    this._state = 'Disposed';
    this._modules = [];
  }
}
