# OpenLearn Developer Guide - Platform Service Registry (开发者指南)

## 1. Executive Summary (概述)

本指南介绍如何在 OpenLearn 平台内核中使用 `PlatformServiceRegistry` 注册、查询与解析服务。

---

## 2. Registering and Resolving Services (注册与解析服务)

```typescript
import {
  PlatformServiceRegistry,
  ServiceDescriptor,
  ServiceScope,
} from './packages/core/service-registry/index.js';

const registry = new PlatformServiceRegistry();

// 1. Singleton Instance Registration
registry.register({
  id: 'srv_logger',
  lifetime: 'Singleton',
  instance: myLoggerInstance,
  description: 'Platform Central Logger',
});

// 2. Resolve Service
const logger = registry.resolve('srv_logger');

// 3. Scoped Service Registration
registry.register({
  id: 'srv_scoped_context',
  lifetime: 'Scoped',
  factory: (scope) => ({ scopeId: (scope as ServiceScope)?.scopeId }),
});

const scope = new ServiceScope();
const scopedService = registry.resolve('srv_scoped_context', scope);
```
