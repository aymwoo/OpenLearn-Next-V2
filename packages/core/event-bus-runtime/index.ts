/**
 * Platform Event Bus — barrel exports (PI-010).
 *
 * This module carries ONLY platform-infrastructure events. It is independent of
 * the pre-existing generic `packages/core/event-bus/` EventBus and the business
 * event systems (classroom messaging, plugin communication, etc.).
 */

export { EventBus, type EventBusOptions, PlatformEventType } from './EventBus.js';
export { EventPublisher } from './EventPublisher.js';
export { EventSubscriber, type EventSubscriberInit } from './EventSubscriber.js';
export { EventDispatcher } from './EventDispatcher.js';
export { EventRegistry } from './EventRegistry.js';
export { EventHandler } from './EventHandler.js';
export { PlatformEventObject } from './PlatformEvent.js';
export { EventDescriptor } from './EventDescriptor.js';
export { EventContext } from './EventContext.js';
export { EventError, type EventErrorCode } from './EventError.js';
export type {
  PlatformEventTypeValue,
  PlatformEvent,
  PlatformEventInit,
  EventDescriptorInit,
  EventHandlerOptions,
  EventHandlerMode,
  EventFilter,
  EventHandlerFn,
  HandlerStatus,
  HandlerResult,
  EventResult,
  CapabilityEventSource,
  BuilderIntegrationSource,
} from './types.js';
