/**
 * Worker Runtime subsystem barrel export.
 *
 * Provides:
 * - IWorkerTransport — cross-boundary message transport interface
 * - NodeWorkerTransport — node:worker_threads.Worker implementation
 * - BrowserWorkerTransport — Web Worker stub (Phase 9)
 * - WorkerMessage / MainThreadMessage — structured message protocol types
 * - PendingCall — RPC call tracking interface
 * - 5 type guard functions — isInvokeMessage, isSubscribeMessage, isResultMessage, isErrorMessage, isEventMessage
 * - ServiceProxy (createMethodProxy, createServicesProxy, EventBusProxy)
 * - ServiceHost — main-thread RPC handler with EventForwarder integration
 * - EventForwarder — main-thread event forwarding to Workers
 * - WorkerManager + WorkerRegistry — Worker lifecycle management
 * - WorkerRuntimeError and 5 error subclasses
 *
 * Ordering: core types -> transport -> service proxy -> service host ->
 *           event forwarder -> worker manager -> errors (same as esm-loader/index.ts)
 */

// Core types
export type { IWorkerTransport } from './types.js';
export type { WorkerMessage, MainThreadMessage, PendingCall } from './types.js';
export {
  isInvokeMessage,
  isSubscribeMessage,
  isResultMessage,
  isErrorMessage,
  isEventMessage,
} from './types.js';

// Transport implementations
export { NodeWorkerTransport } from './transport.js';
export { BrowserWorkerTransport } from './transport.js';

// Service proxy (Worker-side RPC + EventBusProxy)
export { createMethodProxy, createServicesProxy, EventBusProxy } from './service-proxy.js';
export type { ServicesProxyResult } from './service-proxy.js';

// Service host (main-thread RPC handler with EventForwarder)
export { ServiceHost } from './service-host.js';

// Event forwarding (main-thread EventBus -> Worker)
export { EventForwarder } from './event-forwarder.js';

// Worker manager + registry
export { WorkerManager, WorkerRegistry } from './worker-manager.js';

// Error classes
export {
  WorkerRuntimeError,
  WorkerTransportError,
  WorkerActivateError,
  WorkerTimeoutError,
  WorkerCapabilityError,
  WorkerNotSupportedError,
} from './errors.js';
