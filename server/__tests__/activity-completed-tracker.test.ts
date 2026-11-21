import { describe, it, expect } from 'vitest';
import { EventBus } from '../../packages/core/event-bus/index.js';
import { publishActivityCompleted } from '../../packages/core/events/activity-events.js';
import { ActivityCompletedTracker } from '../services/activity-completed-tracker.js';

const waitForDispatch = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('ActivityCompletedTracker（activity.completed 消费者）', () => {
  it('按 source 与 activityId 命名空间聚合三类来源', async () => {
    const bus = new EventBus();
    const tracker = new ActivityCompletedTracker(bus);

    publishActivityCompleted(bus, {
      source: 'ecosystem',
      activityId: 'provider:official_quiz',
      lessonId: 'L1',
    });
    publishActivityCompleted(bus, {
      source: 'lesson-activity',
      activityId: 'xuean:act-1',
      lessonId: 'L1',
      studentId: 'stu-1',
    });
    publishActivityCompleted(bus, {
      source: 'classroom-interaction',
      activityId: 'classroom-legacy:exit-ticket',
      lessonId: 'L1',
      studentId: 'stu-1',
    });
    await waitForDispatch();

    const snapshot = tracker.snapshot();
    expect(snapshot.total).toBe(3);
    expect(snapshot.bySource).toEqual({
      ecosystem: 1,
      'lesson-activity': 1,
      'classroom-interaction': 1,
    });
    expect(snapshot.byKind).toEqual({
      provider: 1,
      xuean: 1,
      'classroom-legacy': 1,
    });
    expect(snapshot.lastEvent?.activityId).toBe('classroom-legacy:exit-ticket');
    expect(snapshot.recent).toHaveLength(3);

    tracker.dispose();
  });

  it('按课节聚合快照，未出现的课节返回零值形状', async () => {
    const bus = new EventBus();
    const tracker = new ActivityCompletedTracker(bus);

    publishActivityCompleted(bus, {
      source: 'classroom-interaction',
      activityId: 'classroom-legacy:exit-ticket',
      lessonId: 'L1',
      studentId: 'stu-1',
    });
    publishActivityCompleted(bus, {
      source: 'ecosystem',
      activityId: 'provider:official_quiz',
      lessonId: 'L2',
    });
    await waitForDispatch();

    const l1 = tracker.snapshotForLesson('L1');
    expect(l1).toMatchObject({ lessonId: 'L1', total: 1, lastCompletedAt: expect.any(Number) });
    expect(l1.bySource).toEqual({ 'classroom-interaction': 1 });
    expect(l1.byKind).toEqual({ 'classroom-legacy': 1 });
    expect(l1.recent).toHaveLength(1);

    // 分课节隔离：L2 的事件不进入 L1
    expect(tracker.snapshotForLesson('L2').total).toBe(1);
    expect(tracker.snapshotForLesson('L3')).toEqual({
      lessonId: 'L3',
      total: 0,
      bySource: {},
      byKind: {},
      lastCompletedAt: null,
      recent: [],
    });

    tracker.dispose();
  });

  it('dispose 后不再接收事件', async () => {
    const bus = new EventBus();
    const tracker = new ActivityCompletedTracker(bus);
    tracker.dispose();

    publishActivityCompleted(bus, {
      source: 'ecosystem',
      activityId: 'provider:x',
      lessonId: 'L1',
    });
    await waitForDispatch();

    expect(tracker.snapshot().total).toBe(0);
    expect(tracker.snapshot().recent).toEqual([]);
  });

  it('recent 只保留最近 20 条，避免内存无限增长', async () => {
    const bus = new EventBus();
    const tracker = new ActivityCompletedTracker(bus);

    for (let i = 0; i < 25; i += 1) {
      publishActivityCompleted(bus, {
        source: 'lesson-engine',
        activityId: `lesson-engine:quiz-${i}`,
        lessonId: 'L1',
      });
    }
    await waitForDispatch();

    const snapshot = tracker.snapshot();
    expect(snapshot.total).toBe(25);
    expect(snapshot.byKind['lesson-engine']).toBe(25);
    expect(snapshot.recent).toHaveLength(20);
    expect(snapshot.recent[snapshot.recent.length - 1]?.activityId).toBe('lesson-engine:quiz-24');

    tracker.dispose();
  });
});
