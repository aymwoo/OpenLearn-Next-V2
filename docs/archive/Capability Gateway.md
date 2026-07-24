# Capability Gateway

**Module:** `@openlearn/core/plugin-host/plugin-capability-gateway`  
**Service ID:** `srv_plugin_capability_gateway`  

---

## Overview

The **Plugin Capability Gateway** provides a unified, capability-first access layer over platform capabilities (`chat`, `completion`, `tool`, `lesson`, `whiteboard`, `analytics`, `plugin`).

It delegates 100% to the underlying `CapabilityRegistry` without duplicating business logic or modifying existing capability providers.

---

## Key Interfaces & Public API

```typescript
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
```

---

## Composition Root Integration

Registered in `PluginCompositionModule` under service ID `srv_plugin_capability_gateway`.
Can be injected or retrieved via `options.infrastructureRefs.get('capabilityGateway')`.
