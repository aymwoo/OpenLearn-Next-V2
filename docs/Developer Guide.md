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

---

## PI-010 Addendum — Using the Platform Event Bus

`EventBus` (module `packages/core/event-bus-runtime/`) carries **only platform
infrastructure events**. Construct it once and bridge the kernel subsystems to it.

```typescript
import { EventBus, PlatformEventType } from '../event-bus-runtime/index.js';
import { ServiceEventBus } from '../service-registry/index.js';
import { BootstrapPipeline } from '../bootstrap/pipeline/bootstrap-pipeline.js';

const bus = new EventBus();
const svcBus = new ServiceEventBus();
bus.bridgeServiceEventBus(svcBus);          // ServiceRegistered / ServiceRemoved
bus.bridgeBootstrapPipeline(new BootstrapPipeline()); // Bootstrap stage events

// Subscribe (with priority, filter, once, timeout)
bus.subscribe('ServiceRegistered', (ctx) => {
  console.log('service up:', (ctx.payload as { serviceId: string }).serviceId);
}, { priority: 10, filter: (ctx) => ctx.source === 'service-registry' });

// Publish lifecycle events
await bus.publishPlatformStarting();
await bus.publishPlatformStarted();

// Cancellation inside a handler
bus.subscribe('Test', (ctx) => {
  if ((ctx.payload as { stop?: boolean }).stop) ctx.cancel();
});
```

Dispatch guarantees: priority + ordered execution, per-handler error isolation,
cancellation, and timeout. A handler failure never terminates the platform —
failures are reported in `EventResult.results`.

## PI-011 Addendum — Using the Platform Configuration System

The Platform Configuration System is the unified, platform-only configuration
abstraction. Construct it once during bootstrap, register providers, then
`load()`.

```typescript
import { PlatformConfiguration } from './packages/core/configuration/index.js';

const config = new PlatformConfiguration({
  logger,
  serviceRegistry,   // optional seam
  container,         // optional seam
  eventBus,          // optional seam
  builder,           // optional seam
});

// Register providers (priority = higher wins)
config.registerMemory({ appName: 'OpenLearn', nested: { max: 5 } }, { id: 'base' });
config.registerEnvironment({ id: 'env', prefix: 'APP_', env: process.env });
config.registerJsonFile('./config/platform.json', { id: 'file', priority: 50 });

// Optionally with validation descriptors
config.registerMemory({ port: 7000 }, {
  id: 'overrides',
  scope: 'Infrastructure',
  priority: 100,
  descriptors: [
    { path: 'port', type: 'number', required: true, min: 1, max: 65535 },
    { path: 'mode', type: 'string', enum: ['dev', 'prod'], default: 'dev' },
  ],
});

await config.load();

// Read
const port = config.get<number>('port');          // throws if absent
const name = config.tryGet<string>('appName', 'fallback');
const has = config.exists('nested.max');

// Immutability
const snap = config.snapshot();
const frozen = snap.get('port');                   // never mutates the platform
```

### Priority & merge rules

- Providers are merged **ascending by priority** — lower-priority first, so
  higher-priority values override.
- Nested objects deep-merge; scalars and arrays replace.
- Descriptor `default` values fill missing keys **before** validation.

### Validation

`config.getValidationReport()` returns `{ isValid, errors[], warnings[] }`.
Each error carries a `code` (`REQUIRED`, `TYPE`, `RANGE_MIN`, `RANGE_MAX`,
`ENUM`).

### Scopes

`get(path, scope)` returns `undefined` (does **not** throw) when the matching
descriptor belongs to a different scope. Only a truly absent path throws
`ConfigurationError` (`NOT_FOUND`).

### Integration seams

After `load()`, the system registers itself as the `kernel.configuration`
service/instance, publishes `ConfigurationLoaded` on the EventBus, and invokes
`builder.onConfigurationLoaded`. All of these are pass-in/attach seams — no
business module is modified.

### Reserved (NOT implemented in PI-011)

- Live **hot reload** of configuration is a reserved seam. The `reload()` method
  re-runs the full load with the current providers, but no file-watch or
  push-based hot-reload mechanism is wired in this increment.
- `Application` scope is reserved for application bootstrap and is not populated
  by the platform kernel.
