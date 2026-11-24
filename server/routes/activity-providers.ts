/**
 * Activity Provider / Run 路由（Phase 2 canonical 路由族）。
 *
 * 语义边界：
 * - `/api/activity-providers`      活动能力目录（定义）
 * - `/api/activity-runs`           一次运行（实例），start/pause/resume/finish
 * - `/api/lessons/:lessonId/activities/:activityId/*` 学案内容（见 lesson-activities.ts）
 *
 * 旧 `/api/activities/*` 仍保留为带 Deprecation 头的兼容别名。
 */

import type { Request, Response } from 'express';
import { createActivityContext } from '../../packages/activity-ecosystem/index.js';
import type { ActivityProviderDescriptor } from '../../packages/activity-ecosystem/index.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import type { ActivityRunState } from '../../packages/core/activity-contract/index.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { getActorId } from '../middleware/auth.js';
import { sendSafeError } from '../utils/error-handler.js';
import type { ServerContext } from '../context.js';
import type { ActivityRunRecord, ActivityRunService } from '../services/activity-run-service.js';

export function registerActivityProviderRoutes(ctx: ServerContext, runService: ActivityRunService): void {
  const { app, activityRegistry } = ctx;

  const buildContext = () =>
    createActivityContext({
      commandBus: kernelContainer.commandBus,
      eventBus: kernelContainer.eventBus,
      actionRegistry: kernelContainer.actionRegistry,
      capability: kernelContainer.capabilityGuard as never,
      ai: kernelContainer.aiService,
    });

  const decorate = (run: ActivityRunRecord) => {
    const descriptor = activityRegistry.getProvider(run.providerId)?.descriptor;
    return {
      ...run,
      provider: descriptor?.provider ?? run.providerId,
      name: descriptor?.name ?? run.providerId,
      icon: descriptor?.icon,
      category: descriptor?.category,
    };
  };

  app.get('/api/activity-providers', requireScopedAuth('authenticated'), (req: Request, res: Response) => {
    try {
      const role = (req.query.role as string) || 'all';
      const list: ActivityProviderDescriptor[] =
        role === 'all'
          ? activityRegistry.listDescriptors()
          : activityRegistry
              .listByRole(role as Parameters<typeof activityRegistry.listByRole>[0])
              .map((provider) => provider.descriptor);
      res.json({ activities: list });
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  app.post(
    '/api/activity-providers/:providerId/runs',
    requireScopedAuth('authenticated'),
    async (req: Request, res: Response) => {
      try {
        const { providerId } = req.params;
        const body = (req.body ?? {}) as {
          payload?: Record<string, unknown>;
          actorId?: string;
          lessonId?: string;
          classId?: string;
        };
        const actorId = getActorId(req) || body.actorId;
        const started = await runService.start(providerId, buildContext(), body.payload ?? {}, actorId, {
          lessonId: body.lessonId ?? null,
          classId: body.classId ?? null,
        });
        res.status(201).json({ ok: true, ...started });
      } catch (err: unknown) {
        const code =
          typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined;
        sendSafeError(res, err, code === 'PERMISSION_DENIED' ? 403 : 500);
      }
    },
  );

  app.get('/api/activity-runs', requireScopedAuth('authenticated'), (req: Request, res: Response) => {
    try {
      const state = typeof req.query.state === 'string' ? req.query.state : undefined;
      const activeOnly = req.query.active === '1' || req.query.active === 'true';
      const runs = (
        activeOnly
          ? runService.listRunning()
          : runService.list(state ? { state: state as ActivityRunState } : undefined)
      ).map(decorate);
      res.json({ runs });
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  for (const action of ['pause', 'resume', 'finish'] as const) {
    app.post(
      `/api/activity-runs/:runId/${action}`,
      requireScopedAuth('authenticated'),
      async (req: Request, res: Response) => {
        try {
          const { runId } = req.params;
          const run = runService.getRun(runId);
          if (!run) return res.status(404).json({ ok: false, error: 'Activity run not found' });

          const context = buildContext();
          const ok =
            action === 'pause'
              ? await runService.pause(runId, context)
              : action === 'resume'
                ? await runService.resume(runId, context)
                : await runService.finish(runId, context);

          if (!ok) {
            return res.status(409).json({ ok: false, error: `Cannot ${action} run in state "${run.state}"` });
          }
          res.json({ ok: true, run: decorate(runService.getRun(runId) ?? run) });
        } catch (err: unknown) {
          sendSafeError(res, err);
        }
      },
    );
  }
}
