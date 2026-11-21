import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ActivityRegistry,
  type ActivityContext,
  type ActivityLifecycleState,
  type ActivityProvider,
} from '../../packages/activity-ecosystem/index.js';
import { ActivityRunService } from '../services/activity-run-service.js';

class FakeProvider implements ActivityProvider {
  readonly descriptor = {
    id: 'fake_activity',
    name: 'Fake Activity',
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
  async pause(): Promise<void> {
    this.state = 'paused';
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async finish(): Promise<void> {
    this.state = 'finished';
  }
  async dispose(): Promise<void> {
    this.state = 'disposed';
  }
}

const context = {
  commandBus: {},
  eventBus: {},
  actionRegistry: {},
  capability: { check: async () => true },
  ai: {},
} as unknown as ActivityContext;

function createRunsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE activity_runs (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      lesson_id TEXT,
      class_id TEXT,
      state TEXT NOT NULL,
      actor_id TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      payload_json TEXT
    );
  `);
}

describe('ActivityRunService（Phase 3）', () => {
  let registry: ActivityRegistry;
  let db: Database.Database;
  let service: ActivityRunService;

  beforeEach(() => {
    registry = new ActivityRegistry();
    registry.registerProvider(new FakeProvider());
    db = new Database(':memory:');
    createRunsTable(db);
    service = new ActivityRunService(registry, db);
  });

  it('start 生成 runId 并记录 running；pause/resume/finish 驱动状态', async () => {
    const started = await service.start('fake_activity', context, { prompt: 'hi' }, 'teacher-1', {
      lessonId: 'L1',
      classId: 'C1',
    });

    expect(started.runId).toMatch(/^run_/);
    expect(service.listRunning()).toHaveLength(1);
    expect(service.getRun(started.runId)?.state).toBe('running');

    expect(await service.pause(started.runId, context)).toBe(true);
    expect(service.getRun(started.runId)?.state).toBe('paused');

    expect(await service.resume(started.runId, context)).toBe(true);
    expect(service.getRun(started.runId)?.state).toBe('running');

    expect(await service.finish(started.runId, context)).toBe(true);
    expect(service.getRun(started.runId)?.state).toBe('finished');
    expect(service.listRunning()).toHaveLength(0);
  });

  it('按 provider 找到最近一次活跃运行（旧路由兼容）', async () => {
    const started = await service.start('fake_activity', context, {}, 'teacher-1');
    expect(service.latestActiveRun('fake_activity')?.runId).toBe(started.runId);

    expect(await service.finishLatestByProvider('fake_activity', context)).toBe(true);
    expect(service.latestActiveRun('fake_activity')).toBeUndefined();
    expect(await service.pauseLatestByProvider('fake_activity', context)).toBe(false);
  });

  it('新实例可从 activity_runs 恢复 running/paused 运行', async () => {
    const running = await service.start('fake_activity', context, {}, 'teacher-1', { lessonId: 'L1' });
    await service.start('fake_activity', context, {}, 'teacher-1', { lessonId: 'L2' });

    const restored = new ActivityRunService(registry, db);
    const runningRuns = restored.listRunning();

    expect(runningRuns.length).toBe(2);
    expect(runningRuns.some((run) => run.runId === running.runId)).toBe(true);
  });
});
