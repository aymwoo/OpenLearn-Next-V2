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

---

## PI-009 Addendum — Using the Capability Runtime

`CapabilityRuntime` sits on top of the `PlatformServiceRegistry` (and optionally the
`PlatformContainer` from PI-008). It lets you register capabilities with an `activator`
factory and resolve them by id or by contract.

```typescript
import { PlatformServiceRegistry } from '../service-registry/platform-service-registry.js';
import { PlatformContainer } from '../di/container/index.js';
import { CapabilityRuntime } from '../capability-runtime/index.js';

const registry = new PlatformServiceRegistry();
const container = new PlatformContainer(registry);
const runtime = new CapabilityRuntime(registry, { container });

// Register a capability with an activator
runtime.register({
  id: 'cap.greeter',
  category: 'demo',
  activator: () => ({ greet: (n: string) => `hello ${n}` }),
});

// Resolve it (instance is cached; status becomes Active)
const greeter = runtime.resolve<{ greet: (n: string) => string }>('cap.greeter');
greeter.greet('world'); // 'hello world'

// Multiple providers under one contract, selected by priority
runtime.register({ id: 'cap.fast', contract: 'cap.renderer', priority: 1, activator: () => 'fast' });
runtime.register({ id: 'cap.best', contract: 'cap.renderer', priority: 10, activator: () => 'best' });
runtime.resolve<string>('cap.renderer', { mode: 'Priority' }); // 'best'
runtime.resolveAll<string>('cap.renderer');                   // ['fast', 'best']

// Optional / default fallback
runtime.resolve('cap.missing', { mode: 'Optional' });          // undefined
```

Validation reports missing dependencies and circular capability graphs:

```typescript
const report = runtime.validate();
if (!report.isValid) console.error(report.errors);
```
