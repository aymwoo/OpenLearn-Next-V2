# OpenLearn Developer Guide - Platform Integration Layer (开发者指南)

## 1. Executive Summary (概述)

本指南介绍如何在 OpenLearn 平台中实现并注册自定义业务域集成适配器 (`IntegrationAdapter`)。

---

## 2. Implementing a Custom Domain Adapter (实现自定义业务适配器)

```typescript
import {
  IIntegrationAdapter,
  IntegrationContext,
  IntegrationHealthStatus,
  IntegrationDescriptor,
} from './packages/core/bootstrap/index.js';

export class CustomDomainAdapter implements IIntegrationAdapter {
  public readonly id = 'adapter_custom';
  public readonly name = 'Custom Domain Adapter';
  public readonly version = '1.0.0';

  public async initialize(context: IntegrationContext): Promise<void> {
    // Perform initialization
  }

  public async activate(): Promise<void> {}
  public async deactivate(): Promise<void> {}
  public async dispose(): Promise<void> {}

  public async health(): Promise<IntegrationHealthStatus> {
    return { isHealthy: true };
  }

  public metadata(): IntegrationDescriptor {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: 'Custom Domain Integration Adapter',
    };
  }
}
```

---

## 3. Registering Adapters with PlatformIntegration (注册适配器)

```typescript
import { PlatformIntegration } from './packages/core/bootstrap/index.js';

const integration = new PlatformIntegration();
integration.register(new CustomDomainAdapter());
await integration.initializeAll(context);
await integration.activateAll();
```
