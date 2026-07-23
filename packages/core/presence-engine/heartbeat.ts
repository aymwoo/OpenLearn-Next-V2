/**
 * OpenLearn Presence Engine - Heartbeat Manager Subsystem
 * Tracks unified heartbeats for Teacher, Student, Plugin, and AI; detects timeouts and handles reconnects.
 */

import { PresenceStore } from './presence-store.js';
import { PresenceEventBus } from './presence-event-bus.js';

export class PresenceHeartbeatManager {
  private store: PresenceStore;
  private eventBus: PresenceEventBus;
  private timer: ReturnType<typeof setInterval> | null = null;
  private timeoutThresholdMs = 30000; // 30 seconds default

  constructor(store: PresenceStore, eventBus: PresenceEventBus, timeoutMs = 30000) {
    this.store = store;
    this.eventBus = eventBus;
    this.timeoutThresholdMs = timeoutMs;
  }

  /**
   * Process a heartbeat ping from an entity.
   */
  public receiveHeartbeat(entityId: string): void {
    const existing = this.store.getPresence(entityId);
    if (existing) {
      this.store.updatePresence(entityId, {
        lastHeartbeat: Date.now(),
        connectionState: 'connected',
      });
    }
  }

  /**
   * Start heartbeat sweep daemon.
   */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.sweep();
    }, 5000);
  }

  /**
   * Stop heartbeat sweep daemon.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Perform timeout check sweep over all stored entities.
   */
  public sweep(): void {
    const now = Date.now();
    const entities = this.store.listAll();

    for (const entity of entities) {
      if (entity.connectionState === 'offline') continue;

      const elapsed = now - entity.lastHeartbeat;
      if (elapsed > this.timeoutThresholdMs) {
        // Mark as offline / timeout
        this.store.updatePresence(entity.id, {
          connectionState: 'offline',
          status: entity.type === 'student' ? 'Offline' : entity.status,
        });

        this.eventBus.publish('HeartbeatTimeout', {
          entityId: entity.id,
          lastHeartbeat: entity.lastHeartbeat,
          timestamp: now,
        });

        if (entity.type === 'student') {
          this.eventBus.publish('StudentOffline', {
            studentId: entity.id,
            timestamp: now,
          });
        }
      }
    }
  }
}
