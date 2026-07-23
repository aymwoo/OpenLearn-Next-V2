/**
 * OpenLearn Presence Engine - Presence Manager API
 * Central facade providing getPresence, watchPresence, updatePresence, subscribePresence, queryPresence, and Dashboard metrics.
 */

import {
  PresenceEntity,
  PresenceDiff,
  PresenceDashboardMetrics,
  InteractionSignal,
  AIStatus,
  CustomPresenceDefinition,
} from './types.js';
import { PresenceStore } from './presence-store.js';
import { PresenceEventBus } from './presence-event-bus.js';
import { PresenceTimelineLogger } from './presence-timeline.js';
import { PresencePrivacyManager } from './privacy-manager.js';

export class PresenceManager {
  private store: PresenceStore;
  private eventBus: PresenceEventBus;
  private timelineLogger: PresenceTimelineLogger;
  private privacyManager: PresencePrivacyManager;
  private watchers = new Map<string, Set<(entity: PresenceEntity) => void>>();
  private customPresenceDefs = new Map<string, CustomPresenceDefinition>();

  constructor(
    store: PresenceStore,
    eventBus: PresenceEventBus,
    timelineLogger: PresenceTimelineLogger,
    privacyManager: PresencePrivacyManager
  ) {
    this.store = store;
    this.eventBus = eventBus;
    this.timelineLogger = timelineLogger;
    this.privacyManager = privacyManager;
  }

  // ── Public Presence APIs ───────────────────────────────────────────────

  public getPresence(id: string): PresenceEntity | undefined {
    const raw = this.store.getPresence(id);
    if (!raw) return undefined;
    return this.privacyManager.sanitizeEntity(raw);
  }

  public watchPresence(id: string, callback: (entity: PresenceEntity) => void): () => void {
    if (!this.watchers.has(id)) {
      this.watchers.set(id, new Set());
    }
    const set = this.watchers.get(id)!;
    set.add(callback);

    const initial = this.getPresence(id);
    if (initial) {
      callback(initial);
    }

    return () => {
      set.delete(callback);
    };
  }

  public updatePresence(id: string, partial: Partial<PresenceEntity>): PresenceDiff | null {
    if (!this.privacyManager.isCollectionAllowed()) return null;

    const previous = this.store.getPresence(id);
    const diff = this.store.updatePresence(id, partial);
    const current = this.store.getPresence(id);

    if (previous && current) {
      this.timelineLogger.logChange(id, previous.status, current.status, current.activity);

      this.eventBus.publish('PresenceChanged', {
        entityId: id,
        previous,
        current,
      });

      if (current.type === 'teacher' && previous.status !== current.status) {
        this.eventBus.publish('TeacherChanged', {
          teacherId: id,
          newStatus: current.status as any,
          timestamp: Date.now(),
        });
      }

      if (current.type === 'plugin' && previous.status !== current.status) {
        this.eventBus.publish('PluginRunning', {
          pluginId: id,
          status: current.status as any,
          timestamp: Date.now(),
        });
      }

      // Notify watchers
      const sanitized = this.privacyManager.sanitizeEntity(current);
      const watchersSet = this.watchers.get(id);
      if (watchersSet) {
        for (const watcher of watchersSet) {
          try {
            watcher(sanitized);
          } catch (err: unknown) {
            console.error(`[PresenceManager] Watcher error for ${id}:`, err);
          }
        }
      }
    }

    return diff;
  }

  public queryPresence(filter: (entity: PresenceEntity) => boolean): ReadonlyArray<PresenceEntity> {
    const rawList = this.store.queryPresence(filter);
    return Object.freeze(rawList.map((e) => this.privacyManager.sanitizeEntity(e)));
  }

  public subscribePresence(
    filter: (entity: PresenceEntity) => boolean,
    callback: (entities: ReadonlyArray<PresenceEntity>) => void
  ): () => void {
    const handler = () => {
      const matching = this.queryPresence(filter);
      callback(matching);
    };

    return this.eventBus.subscribe('PresenceChanged', () => {
      handler();
    });
  }

  // ── Interactions & Hand Raise ──────────────────────────────────────────

  public raiseHand(studentId: string, signal: InteractionSignal = 'Raise Hand'): void {
    this.updatePresence(studentId, {
      interactionSignal: signal,
      status: signal === 'Need Help' ? 'Need Help' : 'Online',
    });

    this.eventBus.publish('HandRaised', {
      studentId,
      signal,
      timestamp: Date.now(),
    });
  }

  public requestHelp(studentId: string, message?: string): void {
    this.raiseHand(studentId, 'Need Help');
    this.eventBus.publish('HelpRequested', {
      studentId,
      message,
      timestamp: Date.now(),
    });
  }

  // ── Plugin SDK Extension ───────────────────────────────────────────────

  public registerPresence(definition: CustomPresenceDefinition): void {
    this.customPresenceDefs.set(definition.type, definition);
  }

  public getCustomPresenceDefs(): ReadonlyArray<CustomPresenceDefinition> {
    return Object.freeze(Array.from(this.customPresenceDefs.values()));
  }

  // ── Dashboard Metrics Reservation ─────────────────────────────────────

  public getDashboardMetrics(): PresenceDashboardMetrics {
    const all = this.store.listAll();
    const students = all.filter((e) => e.type === 'student');
    const onlineStudents = students.filter((e) => e.connectionState === 'connected');
    const activeStudents = onlineStudents.filter((e) => e.focus === 'Focused' || e.status !== 'Idle');
    const focusedStudents = onlineStudents.filter((e) => e.focus === 'Focused');
    const handRaiseStudents = onlineStudents.filter((e) => e.interactionSignal === 'Raise Hand');
    const helpStudents = onlineStudents.filter((e) => e.interactionSignal === 'Need Help' || e.status === 'Need Help');
    const activePlugins = all.filter((e) => e.type === 'plugin' && e.status === 'Running');
    const aiEntity = all.find((e) => e.type === 'ai');

    return {
      onlineCount: onlineStudents.length,
      activeCount: activeStudents.length,
      focusCount: focusedStudents.length,
      handRaiseCount: handRaiseStudents.length,
      helpRequestCount: helpStudents.length,
      taskCompletionRate: students.length > 0 ? Math.round((activeStudents.length / students.length) * 100) : 0,
      aiWorkStatus: (aiEntity?.status as AIStatus) || 'Idle',
      activePluginCount: activePlugins.length,
      timestamp: Date.now(),
    };
  }
}
