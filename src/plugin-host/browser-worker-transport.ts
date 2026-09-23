/**
 * Frontend convenience re-export of BrowserWorkerTransport.
 *
 * Provides a clean frontend import path:
 *   import { BrowserWorkerTransport } from './browser-worker-transport'
 *
 * The actual implementation lives in the core worker-runtime package.
 * This file bridges the frontend module path with the core implementation.
 */
export { BrowserWorkerTransport } from '../../packages/core/worker-runtime/transport.js';
