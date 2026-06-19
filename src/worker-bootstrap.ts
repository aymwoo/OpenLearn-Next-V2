/**
 * Worker bootstrap for browser Web Worker context.
 *
 * This file defines the self-contained bootstrap code that runs inside
 * a Web Worker when a plugin is activated in `worker` execution mode.
 *
 * ## Design
 *
 * The bootstrap code is embedded as an inline string in
 * BrowserWorkerManager.buildWorkerBlobUrl(). This is necessary because
 * the Worker runs in an isolated context with no access to the main
 * module graph. The file exists as documentation and reference for the
 * bootstrap implementation — the actual runtime code is the string
 * literal in browser-worker-manager.ts.
 *
 * ## Protocol (Worker side)
 *
 * ### Main thread -> Worker:
 * - `activate` — Load plugin, create service proxies, call activate()
 * - `deactivate-request` — Deactivate plugin, clean up resources
 * - `result` — RPC call return value
 * - `error` — RPC call error
 * - `event` — Forwarded platform event
 *
 * ### Worker -> Main thread:
 * - `invoke` — RPC call to a service method
 * - `subscribe` — Subscribe to platform events
 * - `unsubscribe` — Unsubscribe from platform events
 * - `activated` — Plugin activation complete
 * - `deactivated` — Plugin deactivation complete
 *
 * ## Security
 *
 * - D-10: Worker plugins restricted to ServiceProxy RPC only
 * - No direct DOM access, no localStorage, no fetch
 * - All operations go through postMessage to main thread
 *
 * @module
 */

// NOTE: This file serves as reference documentation.
// The actual Worker bootstrap code is inlined in
// BrowserWorkerManager.buildWorkerBlobUrl() as a string literal.
// See that method for the authoritative implementation.

export {};
