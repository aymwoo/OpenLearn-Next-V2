# OpenLearn Platform Event Bus (平台事件总线)

> **Scope:** PI-010. The Platform Event Bus carries **ONLY platform-infrastructure
> events** (platform lifecycle, bootstrap pipeline stages, service-registry and
> capability-runtime notifications, configuration loading). It is deliberately
> separate from business event systems (classroom messaging, plugin
> communication, etc.) and from the pre-existing generic `packages/core/event-bus/`
> `EventBus`.

Module location: `packages/core/event-bus-runtime/`

---

## 1. Public API

### `EventBus`

Top-level orchestrator. Construct once and share it across the kernel.

```typescript
const bus = new EventBus({ logger?, verbose? });
```

| Method | Returns | Purpose |
|---|---|---|
| `publish(event)` | `Promise<EventResult>` | Async dispatch (awaits handlers). |
| `publishAsync(event)` | `Promise<EventResult>` | Alias of `publish`. |
| `publishSync(event)` | `EventResult` | Synchronous dispatch; async handlers started, not awaited. |
| `createEvent(init)` | `PlatformEvent` | Build an event (fills `eventId`/`timestamp`). |
| `subscribe(type, fn, options?)` | `EventSubscriber` | Register a handler. |
| `subscribeOnce(type, fn, options?)` | `EventSubscriber` | Register a handler removed after first run. |
| `unsubscribe(subOrId)` | `boolean` | Remove by `EventSubscriber` or handler id. |
| `clear()` | `void` | Remove all subscriptions. |
| `describe(type, source, description?)` | `EventDescriptor` | Introspection helper. |
| `subscriptionCount` | `number` | Active handler count. |

### Convenience publishers (the 12 supported types)

`publishPlatformStarting/Started/Stopping/Stopped`,
`publishServiceRegistered(serviceId, namespace?)`,
`publishServiceRemoved(serviceId)`,
`publishCapabilityRegistered(capabilityId)`,
`publishCapabilityResolved(capabilityId)`,
`publishBootstrapStageStarted/Completed/Failed(...)`,
`publishConfigurationLoaded(config?)`.

### Integration bridges

| Method | Integrates with |
|---|---|
| `bridgeServiceEventBus(ServiceEventBus)` | `ServiceRegistry` (`ServiceRegistered`/`ServiceRemoved`) |
| `bridgeBootstrapPipeline(BootstrapPipeline)` | `BootstrapPipeline` (`StageStarted`/`Completed`/`Failed`) |
| `bridgeCapabilityRuntime(CapabilityEventSource)` | `CapabilityRuntime` (registered/resolved) |
| `attachBuilder(BuilderIntegrationSource)` | `PlatformBuilder` (cross-referencing) |
| `disposeBridges()` | Tear down all active bridges |

---

## 2. Subscription Options (`EventHandlerOptions`)

| Option | Default | Meaning |
|---|---|---|
| `id` | auto | Stable handler id. |
| `priority` | `0` | Higher runs first. |
| `order` | `0` | Tie-breaker when priorities are equal (lower first). |
| `filter` | — | `(ctx) => boolean`; handler runs only if it returns `true`. |
| `mode` | `'async'` | `'sync'` runs inline; `'async'` is awaited. |
| `once` | `false` | Remove after first invocation. |
| `timeoutMs` | — | Per-handler timeout; on expiry recorded as `timeout`. |
| `metadata` | — | Free-form metadata. |

---

## 3. Event Context (`EventContext`)

Handlers receive an `EventContext` with: `eventId`, `timestamp`, `source`,
`payload`, `metadata`, `correlationId`, plus `cancel()` / `isCancelled` and
`timeoutMs`.

---

## 4. Dispatch Guarantees

- **Priority + ordered**: handlers sorted by `priority` desc, then `order` asc.
- **Error isolation**: a handler throw is captured in `EventResult.results`; it
  never terminates the platform or other handlers.
- **Cancellation**: a handler calling `ctx.cancel()` stops remaining handlers
  (recorded as `cancelled`).
- **Timeout**: per-handler `timeoutMs` enforced via `Promise.race`; timeout is
  recorded as a `timeout` result, not a throw.
- **`once`**: a consumed handler is removed from the registry automatically.

---

## 5. Event Result (`EventResult`)

```typescript
interface EventResult {
  eventId: string;
  type: string;
  correlationId?: string;
  dispatched: number;
  succeeded: number;
  failed: number;
  cancelled: boolean;
  durationMs: number;
  results: ReadonlyArray<HandlerResult>; // per-handler status: success | error | timeout | skipped | cancelled
}
```

---

## 6. Exports

`EventBus`, `EventPublisher`, `EventSubscriber`, `EventDispatcher`,
`EventRegistry`, `EventHandler`, `PlatformEventObject`, `EventDescriptor`,
`EventContext`, `EventError`, `PlatformEventType`, and the supporting types
(`PlatformEvent`, `PlatformEventInit`, `EventDescriptorInit`,
`EventHandlerOptions`, `EventResult`, `HandlerResult`, `CapabilityEventSource`,
`BuilderIntegrationSource`, …).
