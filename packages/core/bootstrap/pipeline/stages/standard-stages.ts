/**
 * OpenLearn Platform Kernel - 5 Standard Wrapper Stages (PI-003)
 */

import { IBootstrapStage } from '../bootstrap-stage.js';
import { IBootstrapContext, PlatformStage } from '../../types/index.js';

export class StartupStageImpl implements IBootstrapStage {
  public readonly id = 'stage_startup';
  public readonly name = PlatformStage.Created;
  public readonly description = 'Environment & configuration validation';

  async execute(context: IBootstrapContext): Promise<void> {
    context.setStage(PlatformStage.Configuring);
  }
}

export class RegistrationStageImpl implements IBootstrapStage {
  public readonly id = 'stage_registration';
  public readonly name = PlatformStage.Registering;
  public readonly description = 'Core Service Contracts & DI Tokens registration';

  async execute(context: IBootstrapContext): Promise<void> {
    context.setStage(PlatformStage.Registering);
  }
}

export class InitializationStageImpl implements IBootstrapStage {
  public readonly id = 'stage_initialization';
  public readonly name = PlatformStage.Initializing;
  public readonly description = 'Subsystem Kernels initialization';

  async execute(context: IBootstrapContext): Promise<void> {
    context.setStage(PlatformStage.Initializing);
  }
}

export class ActivationStageImpl implements IBootstrapStage {
  public readonly id = 'stage_activation';
  public readonly name = PlatformStage.Activating;
  public readonly description = 'Plugin Host discovery & ESM plugins activation';

  async execute(context: IBootstrapContext): Promise<void> {
    context.setStage(PlatformStage.Activating);
  }
}

export class ReadyStageImpl implements IBootstrapStage {
  public readonly id = 'stage_ready';
  public readonly name = PlatformStage.Ready;
  public readonly description = 'HTTP & Socket.IO server readiness';

  async execute(context: IBootstrapContext): Promise<void> {
    context.setStage(PlatformStage.Ready);
  }
}
