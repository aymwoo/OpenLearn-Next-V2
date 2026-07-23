/**
 * OpenLearn Platform Kernel - Bootstrap Pipeline Facade (PI-003)
 */

import { IBootstrapStage } from './bootstrap-stage.js';
import { PipelineExecutor } from './pipeline-executor.js';
import { PipelineResult, PipelineDiagnosticListener } from './pipeline-types.js';
import { IBootstrapContext, IBootstrapPipeline } from '../types/index.js';
import {
  StartupStageImpl,
  RegistrationStageImpl,
  InitializationStageImpl,
  ActivationStageImpl,
  ReadyStageImpl,
} from './stages/standard-stages.js';

export class BootstrapPipeline implements IBootstrapPipeline {
  private _stages: IBootstrapStage[] = [];
  public readonly executor: PipelineExecutor;

  constructor(stages?: ReadonlyArray<IBootstrapStage>) {
    this.executor = new PipelineExecutor();
    if (stages && stages.length > 0) {
      this._stages = [...stages];
    } else {
      this._stages = [
        new StartupStageImpl(),
        new RegistrationStageImpl(),
        new InitializationStageImpl(),
        new ActivationStageImpl(),
        new ReadyStageImpl(),
      ];
    }
  }

  public get stages(): ReadonlyArray<IBootstrapStage> {
    return Object.freeze(this._stages);
  }

  public addStage(stage: IBootstrapStage): this {
    this._stages.push(stage);
    return this;
  }

  public addListener(listener: PipelineDiagnosticListener): () => void {
    return this.executor.addListener(listener);
  }

  public async run(context: IBootstrapContext): Promise<void> {
    const result = await this.execute(context);
    if (result.status === 'Failed') {
      throw result.error || new Error(`Bootstrap Pipeline failed at stage: ${result.failedStage}`);
    }
  }

  public async execute(context: IBootstrapContext): Promise<PipelineResult> {
    return this.executor.execute(this._stages, context);
  }
}
