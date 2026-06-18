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
 * - WorkerRuntimeError and 5 error subclasses
 *
 * Ordering: core types -> transport -> errors (same as esm-loader/index.ts)
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

// Error classes
export {
  WorkerRuntimeError,
  WorkerTransportError,
  WorkerActivateError,
  WorkerTimeoutError,
  WorkerCapabilityError,
  WorkerNotSupportedError,
} from './errors.js';
