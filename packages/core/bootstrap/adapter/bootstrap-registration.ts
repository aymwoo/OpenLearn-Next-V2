/**
 * OpenLearn Platform Kernel - Bootstrap Registration Helper (PI-005)
 * Encapsulates adapter registration methods for PlatformBuilder & Pipeline.
 */

import { PlatformBuilder } from '../builder/platform-builder.js';
import { StartupAdapterContext } from './adapter-types.js';
import {
  StartupStageImpl,
  RegistrationStageImpl,
  InitializationStageImpl,
  ActivationStageImpl,
  ReadyStageImpl,
} from '../pipeline/stages/standard-stages.js';

export class BootstrapRegistration {
  public static registerConfiguration(builder: PlatformBuilder, context: StartupAdapterContext): void {
    if (context.config) {
      builder.withConfiguration(context.config);
    }
    if (context.environment) {
      builder.withEnvironment(context.environment);
    }
  }

  public static registerLogger(builder: PlatformBuilder, context: StartupAdapterContext): void {
    if (context.logger) {
      builder.withLogger(context.logger);
    }
  }

  public static registerInfrastructure(builder: PlatformBuilder, context: StartupAdapterContext): void {
    if (context.existingServices) {
      for (const [id, service] of context.existingServices.entries()) {
        builder.addService(id, service);
      }
    }
    if (context.kernelContainer) {
      builder.addService('kernelContainer', context.kernelContainer);
    }
    if (context.expressApp) {
      builder.addService('expressApp', context.expressApp);
    }
    if (context.httpServer) {
      builder.addService('httpServer', context.httpServer);
    }
  }

  public static registerExistingBootstrapStages(_builder: PlatformBuilder): void {
    // Pipeline in PlatformBuilder is instantiated with default standard stages.
    // Additional custom stages can be registered here if provided in adapter context.
  }

}
