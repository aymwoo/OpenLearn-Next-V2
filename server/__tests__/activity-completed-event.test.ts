import { describe, it, expect } from 'vitest';
import { EventBus } from '../../packages/core/event-bus/index.js';
import type { PlatformEvent } from '../../packages/core/event-bus/index.js';
import { publishActivityCompleted } from '../../packages/core/events/activity-events.js';
import {
  ActivityRegistry,
  type ActivityContext,
  type ActivityLifecycleState,
  type ActivityProvider,
} from '../../packages/activity-ecosystem/index.js';
import { ActivityRunService } from '../services/activity-run-service.js';

class FakeProvider implements ActivityProvider {
  readonly descriptor = {
    id: 'event_fake',
    name: 'Event Fake',
    category: 'assessment' as const,
    supportedRoles: ['teacher' as const],
    version: '1.0.0',
    provider: 'test',
  };
  state: ActivityLifecycleState = 'registered';
  startedAt?: number;

  async initialize(): Promise<void> {
    this.state = 'initialized';
  }
  async start(): Promise<unknown> {
    this.state = 'running';
    this.startedAt = Date.now();
    return { ok: true };
  }
  async finish(): Promise<void> {
    this.state = 'finished';
  }
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async dispose(): Promise<void> {}
}

const context = {
  commandBus: {},
  eventBus: {},
  actionRegistry: {},
  capability: { check: async () => true },
  ai: {},
} as unknown as ActivityContext;

const waitForDispatch = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('activity.completed 统一出口（Phase 2.2）', () => {
  it('eventBus 上可被订阅，payload 含 type/source/activityId', async () => {
    const bus = new EventBus();
    const seen: PlatformEvent[] = [];
    bus.subscribe('activity.completed', (event) => {
      seen.push(event);
    });

    publishActivityCompleted(bus, {
      source: 'lesson-engine',
      activityId: 'lesson-engine:quiz',
      lessonId: 'lesson-1',
      completedAt: 123,
    });
    await waitForDispatch();

    expect(seen).toHaveLength(1);
    expect(seen[0].payload).toMatchObject({
      type: 'activity.completed',
      source: 'lesson-engine',
      activityId: 'lesson-engine:quiz',
      lessonId: 'lesson-1',
      completedAt: 123,
    });
  });

  it('ecosystem：provider finish 时发布 source=ecosystem', async () => {
    const bus = new EventBus();
    const seen: PlatformEvent[] = [];
    bus.subscribe('activity.completed', (event) => {
      seen.push(event);
    });

    const registry = new ActivityRegistry();
    registry.registerProvider(new FakeProvider());
    const service = new ActivityRunService(registry, undefined, bus);

    const started = await service.start('event_fake', context, {}, 'teacher-1', { lessonId: 'lesson-2' });
    await service.finish(started.runId, context);
    await waitForDispatch();

    expect(seen).toHaveLength(1);
    expect(seen[0].payload).toMatchObject({
      source: 'ecosystem',
      activityId: 'provider:event_fake',
      lessonId: 'lesson-2',
    });
  });

  it('学案活动：source=lesson-activity 的个人完成事件可被发布', async () => {
    const bus = new EventBus();
    const seen: PlatformEvent[] = [];
    bus.subscribe('activity.completed', (event) => {
      seen.push(event);
    });

    publishActivityCompleted(bus, {
      source: 'lesson-activity',
      activityId: 'xuean:act-1',
      lessonId: 'lesson-3',
      studentId: 'stu-1',
    });
    await waitForDispatch();

    expect(seen[0].payload).toMatchObject({
      source: 'lesson-activity',
      activityId: 'xuean:act-1',
      studentId: 'stu-1',
    });
  });

  it('课堂内联：source=classroom-interaction 的完成事件可被发布', async () => {
    const bus = new EventBus();
    const seen: PlatformEvent[] = [];
    bus.subscribe('activity.completed', (event) => {
      seen.push(event);
    });

    publishActivityCompleted(bus, {
      source: 'classroom-interaction',
      activityId: 'classroom-legacy:exit-ticket',
      lessonId: 'lesson-4',
      sessionId: 'session-1',
      studentId: 'stu-1',
    });
    await waitForDispatch();

    expect(seen[0].payload).toMatchObject({
      source: 'classroom-interaction',
      activityId: 'classroom-legacy:exit-ticket',
      sessionId: 'session-1',
    });
  });
});
