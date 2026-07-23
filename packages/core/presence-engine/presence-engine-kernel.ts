/**
 * OpenLearn Presence Engine Kernel
 * Master orchestrator connecting Presence Store, EventBus, Heartbeat, Detector, Focus, Privacy, Timeline, and Sync.
 */

import { PresenceStore } from './presence-store.js';
import { PresenceEventBus } from './presence-event-bus.js';
import { PresenceTimelineLogger } from './presence-timeline.js';
import { PresencePrivacyManager } from './privacy-manager.js';
import { PresenceHeartbeatManager } from './heartbeat.js';
import { ActivityDetector } from './activity-detector.js';
import { FocusEngine } from './focus-engine.js';
import { GroupPresenceManager } from './group-presence.js';
import { PresenceSynchronizer } from './presence-synchronizer.js';
import { PresenceManager } from './presence-manager.js';
import { PresenceEntity } from './types.js';

export class PresenceEngineKernel {
  public readonly store: PresenceStore;
  public readonly eventBus: PresenceEventBus;
  public readonly timelineLogger: PresenceTimelineLogger;
  public readonly privacyManager: PresencePrivacyManager;
  public readonly heartbeatManager: PresenceHeartbeatManager;
  public readonly activityDetector: ActivityDetector;
  public readonly focusEngine: FocusEngine;
  public readonly groupManager: GroupPresenceManager;
  public readonly synchronizer: PresenceSynchronizer;
  public readonly presenceManager: PresenceManager;

  constructor() {
    this.store = new PresenceStore();
    this.eventBus = new PresenceEventBus();
    this.timelineLogger = new PresenceTimelineLogger();
    this.privacyManager = new PresencePrivacyManager();
    this.heartbeatManager = new PresenceHeartbeatManager(this.store, this.eventBus);
    this.activityDetector = new ActivityDetector(this.store);
    this.focusEngine = new FocusEngine(this.store, this.eventBus);
    this.groupManager = new GroupPresenceManager(this.store);
    this.synchronizer = new PresenceSynchronizer(this.store);

    this.presenceManager = new PresenceManager(
      this.store,
      this.eventBus,
      this.timelineLogger,
      this.privacyManager
    );
  }

  public start(): void {
    this.heartbeatManager.start();
  }

  public stop(): void {
    this.heartbeatManager.stop();
  }

  public registerEntity(entity: PresenceEntity): void {
    this.store.setPresence(entity);
  }

  public dispose(): void {
    this.stop();
    this.eventBus.clear();
    this.store.clear();
    this.timelineLogger.clear();
  }
}
