/**
 * Activity Run Service — 把“活动定义”与“一次运行”分离后的运行态存储。
 *
 * provider 注册表（activity-ecosystem）仍只负责定义与生命周期；本服务负责：
 * - 为每次 start 生成稳定 runId；
 * - 记录 running / paused / finished 状态；
 * - 在 `activity_runs` 表存在时持久化，支持重启后展示运行中列表；
 * - 为旧 `/api/activities/:id/*` 路由提供“按 provider 找最近一次运行”的兼容能力。
 */

import crypto from 'crypto';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { ActivityContext, ActivityRegistry } from '../../packages/activity-ecosystem/index.js';
import type { ActivityRunState } from '../../packages/core/activity-contract/index.js';
import { makeActivityId } from '../../packages/core/activity-contract/index.js';
import type { EventBusPort } from '../../packages/core/event-bus/index.js';
import { publishActivityCompleted } from '../../packages/core/events/activity-events.js';

export interface ActivityRunRecord {
  runId: string;
  activityId: string;
  providerId: string;
  lessonId: string | null;
  classId: string | null;
  state: ActivityRunState;
  actorId: string | null;
  startedAt: number;
  endedAt: number | null;
  payload: Record<string, unknown> | null;
}

export interface StartActivityRunResult {
  runId: string;
  provider: string;
  dispatched: boolean;
  result: unknown;
}

interface RunRow {
  id: string;
  activity_id: string;
  provider_id: string;
  lesson_id: string | null;
  class_id: string | null;
  state: string;
  actor_id: string | null;
  started_at: number;
  ended_at: number | null;
  payload_json: string | null;
}

export class ActivityRunService {
  private readonly runs = new Map<string, ActivityRunRecord>();
  private readonly latestRunByProvider = new Map<string, string>();

  constructor(
    private readonly registry: ActivityRegistry,
    private readonly db?: BetterSqliteDatabase,
    private readonly eventBus?: EventBusPort,
  ) {
    this.restoreActiveRuns();
  }

  public async start(
    providerId: string,
    context: ActivityContext,
    payload: Record<string, unknown> | undefined,
    actorId: string | undefined,
    meta?: { lessonId?: string | null; classId?: string | null },
  ): Promise<StartActivityRunResult> {
    const started = await this.registry.startActivity(providerId, context, payload, actorId);
    const runId = `run_${crypto.randomUUID()}`;
    const record: ActivityRunRecord = {
      runId,
      activityId: makeActivityId('provider', providerId),
      providerId,
      lessonId: meta?.lessonId ?? null,
      classId: meta?.classId ?? null,
      state: 'running',
      actorId: actorId ?? null,
      startedAt: Date.now(),
      endedAt: null,
      payload: payload ?? null,
    };

    this.runs.set(runId, record);
    this.latestRunByProvider.set(providerId, runId);
    this.persist(record);

    return {
      runId,
      provider: started.provider,
      dispatched: started.dispatched,
      result: started.result,
    };
  }

  public getRun(runId: string): ActivityRunRecord | undefined {
    return this.runs.get(runId);
  }

  public list(filter?: { state?: ActivityRunState }): ActivityRunRecord[] {
    const all = Array.from(this.runs.values()).sort((a, b) => b.startedAt - a.startedAt);
    return filter?.state ? all.filter((run) => run.state === filter.state) : all;
  }

  public listRunning(): ActivityRunRecord[] {
    return this.list().filter((run) => run.state === 'running' || run.state === 'paused');
  }

  public latestActiveRun(providerId: string): ActivityRunRecord | undefined {
    const runId = this.latestRunByProvider.get(providerId);
    if (!runId) return undefined;
    const run = this.runs.get(runId);
    return run && (run.state === 'running' || run.state === 'paused') ? run : undefined;
  }

  public async pause(runId: string, context: ActivityContext): Promise<boolean> {
    return this.transition(runId, 'paused', context, (provider) => provider.pause(context));
  }

  public async resume(runId: string, context: ActivityContext): Promise<boolean> {
    return this.transition(runId, 'running', context, (provider) => provider.resume(context));
  }

  public async finish(runId: string, context: ActivityContext): Promise<boolean> {
    return this.transition(runId, 'finished', context, (provider) => provider.finish(context));
  }

  public async pauseLatestByProvider(providerId: string, context: ActivityContext): Promise<boolean> {
    const run = this.latestActiveRun(providerId);
    if (!run) return false;
    return this.pause(run.runId, context);
  }

  public async resumeLatestByProvider(providerId: string, context: ActivityContext): Promise<boolean> {
    const run = this.latestActiveRun(providerId);
    if (!run) return false;
    return this.resume(run.runId, context);
  }

  public async finishLatestByProvider(providerId: string, context: ActivityContext): Promise<boolean> {
    const run = this.latestActiveRun(providerId);
    if (!run) return false;
    return this.finish(run.runId, context);
  }

  private async transition(
    runId: string,
    nextState: ActivityRunState,
    context: ActivityContext,
    action: (provider: NonNullable<ReturnType<ActivityRegistry['getProvider']>>) => Promise<void> | void,
  ): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run) return false;
    if (['finished', 'failed', 'cancelled', 'interrupted'].includes(run.state)) return false;

    const provider = this.registry.getProvider(run.providerId);
    if (!provider) return false;

    await action(provider);
    run.state = nextState;
    if (nextState === 'finished') {
      run.endedAt = Date.now();
      if (this.latestRunByProvider.get(run.providerId) === runId) {
        this.latestRunByProvider.delete(run.providerId);
      }
    }
    this.persist(run);

    if (nextState === 'finished') {
      publishActivityCompleted(this.eventBus, {
        source: 'ecosystem',
        activityId: run.activityId,
        lessonId: run.lessonId ?? '',
        classId: run.classId ?? undefined,
        completedAt: run.endedAt ?? Date.now(),
        raw: { runId: run.runId, providerId: run.providerId, actorId: run.actorId },
      });
    }
    return true;
  }

  private restoreActiveRuns(): void {
    if (!this.db) return;
    try {
      const rows = this.db
        .prepare(
          `SELECT id, activity_id, provider_id, lesson_id, class_id, state, actor_id,
                  started_at, ended_at, payload_json
             FROM activity_runs
            WHERE state IN ('running', 'paused')
            ORDER BY started_at DESC`,
        )
        .all() as RunRow[];

      for (const row of rows) {
        const record = this.fromRow(row);
        // provider 对象状态不持久化：重启后无法恢复 running/paused 的内存态。
        // 统一标记为 interrupted，避免 UI/API 伪造成“仍在运行”。
        if (record.state === 'running' || record.state === 'paused') {
          record.state = 'interrupted';
          this.persist(record);
        }
        this.runs.set(record.runId, record);
        // interrupted 不算活跃运行，不进入 latestRunByProvider。
      }
    } catch {
      /* activity_runs 表在最小测试库中可能不存在；运行态退化为纯内存。 */
    }
  }

  private fromRow(row: RunRow): ActivityRunRecord {
    let payload: Record<string, unknown> | null = null;
    if (row.payload_json) {
      try {
        payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      } catch {
        payload = null;
      }
    }
    return {
      runId: row.id,
      activityId: row.activity_id,
      providerId: row.provider_id,
      lessonId: row.lesson_id,
      classId: row.class_id,
      state: row.state as ActivityRunState,
      actorId: row.actor_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      payload,
    };
  }

  private persist(record: ActivityRunRecord): void {
    if (!this.db) return;
    try {
      this.db
        .prepare(
          `INSERT INTO activity_runs
             (id, activity_id, provider_id, lesson_id, class_id, state, actor_id,
              started_at, ended_at, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             state = excluded.state,
             ended_at = excluded.ended_at`,
        )
        .run(
          record.runId,
          record.activityId,
          record.providerId,
          record.lessonId,
          record.classId,
          record.state,
          record.actorId,
          record.startedAt,
          record.endedAt,
          record.payload ? JSON.stringify(record.payload) : null,
        );
    } catch {
      /* 表不存在时保持内存态；不阻断活动生命周期。 */
    }
  }
}
