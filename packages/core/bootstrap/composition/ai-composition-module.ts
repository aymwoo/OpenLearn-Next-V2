/**
 * OpenLearn Platform Kernel - AI Runtime Composition Module (Sprint A1 Step 2)
 * Integrates existing AI Runtime into Platform CompositionRoot without altering AI business logic.
 */

import { CompositionModule, CompositionContextOptions } from './composition-types.js';
import { PlatformServiceRegistry } from '../../service-registry/index.js';
import { AIRuntimeKernel } from '../../ai/index.js';
import { AICapabilityKernel } from '../../ai-capability/index.js';
import { EventBus } from '../../event-bus/index.js';

export class AICompositionModule implements CompositionModule {
  public readonly id = 'mod_ai_composition';
  public readonly name = 'AICompositionModule';

  public compose(options: CompositionContextOptions): void {
    const serviceRegistry = new PlatformServiceRegistry();
    const eventBus = new EventBus();

    // 1. Instantiate Core AI Runtime Kernel & Capability Kernel
    const aiRuntimeKernel = new AIRuntimeKernel();
    const aiCapabilityKernel = new AICapabilityKernel(aiRuntimeKernel);

    // 2. Register AI Services into PlatformServiceRegistry
    serviceRegistry.register({
      id: 'srv_ai_runtime',
      lifetime: 'Singleton',
      description: 'OpenLearn AI Runtime Service Engine',
      instance: aiRuntimeKernel,
    });

    serviceRegistry.register({
      id: 'srv_ai_capability_kernel',
      lifetime: 'Singleton',
      description: 'OpenLearn AI Capability Master Orchestrator',
      instance: aiCapabilityKernel,
    });

    // 3. Publish AI Infrastructure Events
    eventBus.publish({
      id: `evt_${globalThis.crypto.randomUUID()}`,
      type: 'AIInitialized',
      source: 'AICompositionModule',
      payload: { timestamp: Date.now(), capabilitiesRegistered: aiCapabilityKernel.registry.listCapabilities().length },
      timestamp: Date.now(),
    });

    eventBus.publish({
      id: `evt_${globalThis.crypto.randomUUID()}`,
      type: 'ProviderLoaded',
      source: 'AICompositionModule',
      payload: { timestamp: Date.now(), providers: ['GoogleGenAI', 'OpenAICompatible'] },
      timestamp: Date.now(),
    });

    eventBus.publish({
      id: `evt_${globalThis.crypto.randomUUID()}`,
      type: 'RuntimeStarted',
      source: 'AICompositionModule',
      payload: { timestamp: Date.now(), status: 'Active' },
      timestamp: Date.now(),
    });
  }
}
