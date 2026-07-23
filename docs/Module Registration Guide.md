# OpenLearn Module Registration Guide (模块注册指南)

## 1. Executive Summary (概述)

本指南指导平台开发者如何利用 `PlatformModuleRegistry` 显式注册平台顶级基础设施或业务模块元数据。

---

## 2. Registering a Module Descriptor (注册模块描述符)

```typescript
import {
  PlatformModuleRegistry,
  PlatformModuleDescriptor,
} from './packages/core/bootstrap/index.js';

const registry = new PlatformModuleRegistry();

const aiDescriptor: PlatformModuleDescriptor = {
  id: 'mod_ai_runtime',
  name: 'ai-runtime',
  displayName: 'AI Runtime Module',
  version: '1.0.0',
  description: 'Generative AI Kernel Capability Module',
  category: 'AI',
  status: 'Registered',
  health: { isHealthy: true, status: 'Healthy' },
  capabilities: ['text-generation', 'prompt-analysis'],
};

registry.register(aiDescriptor);
```

---

## 3. Querying & Updating Module Status (查询与更新元数据)

```typescript
// Query
const exists = registry.exists('mod_ai_runtime');
const module = registry.find('mod_ai_runtime');
const allModules = registry.list();

// Update Status / Health
registry.updateStatus('mod_ai_runtime', 'Active');
registry.updateHealth('mod_ai_runtime', { isHealthy: true, status: 'Active & Ready' });
```
