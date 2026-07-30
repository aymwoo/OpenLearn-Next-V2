/**
 * OpenLearn Platform Kernel - Unified Plugin Capability Gateway (EU-01)
 * Single entry point for discovering, resolving, and routing platform capability invocations.
 * Delegates 100% to CapabilityRegistry without duplicating business logic.
 */

import type { CapabilityRegistry } from '../ai-capability/registry/capability-registry.js';
import type { IAICapability } from '../ai-capability/types/index.js';
import type {
  IntegrationHealthStatus,
  IntegrationDescriptor,
} from '../bootstrap/integration/integration-types.js';

export interface CapabilityMetadata {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly version: string;
  readonly description: string;
  readonly provider?: string;
  readonly stability?: 'experimental' | 'stable' | 'deprecated';
}

export interface IPluginCapabilityGateway {
  readonly capabilityRegistry: CapabilityRegistry;
  listCapabilities(): ReadonlyArray<CapabilityMetadata>;
  hasCapability(capabilityId: string): boolean;
  resolveCapability<T extends IAICapability = IAICapability>(capabilityId: string): T;
  executeCapability<T = unknown>(
    capabilityId: string,
    methodName: string,
    ...args: unknown[]
  ): Promise<T>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}

export class PluginCapabilityGateway implements IPluginCapabilityGateway {
  public readonly id = 'srv_plugin_capability_gateway';
  public readonly name = 'PluginCapabilityGateway';
  public readonly version = '0.2.3';

  constructor(public readonly capabilityRegistry: CapabilityRegistry) {}

  public listCapabilities(): ReadonlyArray<CapabilityMetadata> {
    const rawCaps = this.capabilityRegistry.listCapabilities();
    return rawCaps.map((cap) => ({
      id: cap.meta.id,
      name: cap.meta.name,
      type: cap.meta.type,
      version: cap.meta.version,
      description: cap.meta.description,
      stability: 'stable',
    }));
  }

  public hasCapability(capabilityId: string): boolean {
    return this.capabilityRegistry.hasCapability(capabilityId);
  }

  public resolveCapability<T extends IAICapability = IAICapability>(capabilityId: string): T {
    return this.capabilityRegistry.resolveCapability<T>(capabilityId);
  }

  public async executeCapability<T = unknown>(
    capabilityId: string,
    methodName: string,
    ...args: unknown[]
  ): Promise<T> {
    const cap = this.resolveCapability(capabilityId);
    const fn = (cap as unknown as Record<string, unknown>)[methodName];

    if (typeof fn !== 'function') {
      throw new Error(
        `Capability "${capabilityId}" does not export method "${methodName}"`,
      );
    }

    return (fn as (...a: unknown[]) => Promise<T>).apply(cap, args);
  }

  public health(): IntegrationHealthStatus {
    const caps = this.capabilityRegistry.listCapabilities();

    return {
      isHealthy: true,
      details: {
        registeredCapabilitiesCount: caps.length,
        capabilityIds: caps.map((c) => c.meta.id),
      },
    };
  }

  public metadata(): IntegrationDescriptor {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: 'Unified Plugin Capability Gateway for OpenLearn V2',
    };
  }
}
