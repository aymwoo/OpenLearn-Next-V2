/**
 * 系统观测接口（Phase 2.0 / Phase 3 后续）。
 *
 * - 扩展点健康：最近一次启动对账的未知 slot；
 * - 活动完成覆盖：activity.completed 的三类来源聚合。
 *
 * 均只读、仅管理员可访问。
 */

import type { Request, Response } from 'express';
import { requireScopedAuth } from '../middleware/data-scope.js';
import {
  getUnknownExtensionSlots,
  resolveExtensionSlotMode,
} from '../../packages/core/extension-registry/extension-points.js';
import type { ServerContext } from '../context.js';
import type { ActivityCompletedTracker } from '../services/activity-completed-tracker.js';

export function registerExtensionPointRoutes(
  ctx: ServerContext,
  activityCompletedTracker: ActivityCompletedTracker,
): void {
  ctx.app.get('/api/system/extension-points', requireScopedAuth('admin'), (_req: Request, res: Response) => {
    const unknownSlots = getUnknownExtensionSlots();
    res.json({
      ok: true,
      mode: resolveExtensionSlotMode(),
      count: unknownSlots.length,
      unknownSlots,
    });
  });

  ctx.app.get('/api/system/activity-completions', requireScopedAuth('admin'), (_req: Request, res: Response) => {
    res.json({ ok: true, ...activityCompletedTracker.snapshot() });
  });
}
