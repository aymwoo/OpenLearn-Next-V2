/**
 * 扩展点健康接口（Phase 2.0）。
 *
 * 只读暴露最近一次启动对账的结果，供运维/管理后台排查第三方插件使用了
 * 哪些未在 manifest schema 中声明的 slot。仅管理员可读，避免泄露插件清单。
 */

import type { Request, Response } from 'express';
import { requireScopedAuth } from '../middleware/data-scope.js';
import {
  getUnknownExtensionSlots,
  resolveExtensionSlotMode,
} from '../../packages/core/extension-registry/extension-points.js';
import type { ServerContext } from '../context.js';

export function registerExtensionPointRoutes(ctx: ServerContext): void {
  ctx.app.get('/api/system/extension-points', requireScopedAuth('admin'), (_req: Request, res: Response) => {
    const unknownSlots = getUnknownExtensionSlots();
    res.json({
      ok: true,
      mode: resolveExtensionSlotMode(),
      count: unknownSlots.length,
      unknownSlots,
    });
  });
}
