# OpenLearn Platform Events (平台事件目录)

> **Scope:** PI-010. Canonical catalogue of the platform-infrastructure events
> emitted by the Platform Event Bus (`packages/core/event-bus-runtime/`). These
> are NOT business events — they describe kernel/platform lifecycle only.

Event type constants are exported as `PlatformEventType` (values match the
string literals below).

---

## 1. Platform Lifecycle

| Event | Source | Payload | Meaning |
|---|---|---|---|
| `PlatformStarting` | `platform` | `{}` | Platform bootstrap beginning. |
| `PlatformStarted` | `platform` | `{}` | Platform ready to serve. |
| `PlatformStopping` | `platform` | `{}` | Platform shutdown initiated. |
| `PlatformStopped` | `platform` | `{}` | Platform fully shut down. |

---

## 2. Service Registry

| Event | Source | Payload | Meaning |
|---|---|---|---|
| `ServiceRegistered` | `service-registry` | `{ serviceId: string; namespace?: string }` | A service was registered. |
| `ServiceRemoved` | `service-registry` | `{ serviceId: string }` | A service was removed. |

> Bridged automatically from the `ServiceEventBus` via `EventBus.bridgeServiceEventBus(...)`.

---

## 3. Capability Runtime

| Event | Source | Payload | Meaning |
|---|---|---|---|
| `CapabilityRegistered` | `capability-runtime` | `{ capabilityId: string }` | A capability was registered. |
| `CapabilityResolved` | `capability-runtime` | `{ capabilityId: string }` | A capability was resolved/activated. |

> Bridged from a `CapabilityEventSource` via `EventBus.bridgeCapabilityRuntime(...)`.

---

## 4. Bootstrap Pipeline

| Event | Source | Payload | Meaning |
|---|---|---|---|
| `BootstrapStageStarted` | `bootstrap-pipeline` | `{ stageName: string; stageId?: string }` | A bootstrap stage began. |
| `BootstrapStageCompleted` | `bootstrap-pipeline` | `{ stageName: string; stageId?: string; durationMs?: number }` | A stage finished. |
| `BootstrapStageFailed` | `bootstrap-pipeline` | `{ stageName: string; stageId?: string; error?: string }` | A stage failed. |

> Bridged automatically from `BootstrapPipeline` diagnostics via `EventBus.bridgeBootstrapPipeline(...)`.

---

## 5. Configuration

| Event | Source | Payload | Meaning |
|---|---|---|---|
| `ConfigurationLoaded` | `platform-builder` | `{ config?: Record<string, unknown> }` | Platform configuration was loaded. |

---

## 6. Event Envelope (shared shape)

Every platform event carries:

```typescript
interface PlatformEvent<T> {
  eventId: string;     // auto-generated UUID when omitted
  type: string;        // one of the 12 types above (or a custom string)
  source: string;      // originating module
  payload: T;          // event-specific data
  timestamp: number;   // Date.now() when omitted
  metadata: Readonly<Record<string, unknown>>;
  correlationId?: string;
}
```

Handlers receive an `EventContext` exposing the same fields plus `cancel()` and
`timeoutMs` for dispatch control.
