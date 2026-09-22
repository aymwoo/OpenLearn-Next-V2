import type { Server } from 'socket.io';
import type { EventBusPort } from '../packages/core/event-bus/index.js';
import { SOCKET_ROUTES, createRouteDispatcher, type RouteDb } from './event-routing.js';

/**
 * Minimal structural view of the kernel database the realtime bridge needs.
 * Mirrors the `better-sqlite3`-style `prepare().get()/.run()` surface so the
 * bridge can be unit-tested with an in-memory mock (no real DB dependency).
 */
export interface BridgeDb {
  prepare(sql: string): {
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => unknown;
  };
}

export interface RealtimeBridgeDeps {
  eventBus: EventBusPort;
  io: Server;
  db: BridgeDb;
}

/**
 * Wires kernel domain events (published on `eventBus`) to Socket.IO realtime
 * pushes.
 *
 * All forwarding rules now live in the declarative table
 * `server/event-routing.ts` — this function only registers one dispatcher per
 * declared route. Adding a realtime event is therefore a one-line change in
 * the table, not a new `subscribe` block here.
 *
 * Characterization test: `server/__tests__/realtime-bridge.test.ts`.
 */
export function setupRealtimeBridge({ eventBus, io, db }: RealtimeBridgeDeps): void {
  const dispatch = createRouteDispatcher(SOCKET_ROUTES, { io, db: db as RouteDb });

  for (const route of SOCKET_ROUTES) {
    eventBus.subscribe(route.eventType, dispatch);
  }
}
